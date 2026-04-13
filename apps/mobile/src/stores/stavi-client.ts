// ============================================================
// Stavi WebSocket RPC Client
// ============================================================
// Lightweight client that speaks the Stavi server's RPC wire format.
//
// Wire format:
//   Client → Server: { _tag: "Request", id, tag, payload }
//   Server → Client: { _tag: "Chunk", requestId, values }   (streaming)
//                    { _tag: "Exit", requestId, exit }       (final)
//
// Auth flow:
//   1. POST /api/auth/ws-token with Bearer token → { token, expiresAt }
//   2. Connect ws://<host>:<port>/ws?wsToken=<token>

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

/** Stavi server connection config */
export interface StaviConnectionConfig {
  host: string;
  port: number;
  bearerToken: string;
  /** Use TLS (wss:// and https://) */
  tls?: boolean;
}

/** Request message sent to Stavi server */
interface RpcRequest {
  _tag: 'Request';
  id: string;
  tag: string;
  payload: Record<string, unknown>;
}

/** Chunk message (streaming response) */
interface RpcChunk {
  _tag: 'Chunk';
  requestId: string;
  values: unknown[];
}

/** Exit message (final response) */
interface RpcExit {
  _tag: 'Exit';
  requestId: string;
  exit: {
    _tag: 'Success' | 'Failure';
    value?: unknown;
    cause?: {
      _tag: string;
      error?: unknown;
    };
  };
}

/** Any server message */
type ServerMessage = RpcChunk | RpcExit | { _tag: string; [key: string]: unknown };
type WebSocketCloseLike = { code?: number; wasClean?: boolean };
type WebSocketMessageLike = { data?: string | ArrayBuffer };

/** Pending one-shot request */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

/** Active streaming subscription */
interface ActiveSubscription {
  tag: string;
  payload: Record<string, unknown>;
  onEvent: (event: unknown) => void;
  onError?: (error: Error) => void;
  requestId: string;
}

/** Connection state */
export type StaviClientState =
  | 'disconnected'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'reconnecting';

/** State change listener */
export type StateListener = (state: StaviClientState, error?: string) => void;

// ----------------------------------------------------------
// UUID generator (no crypto dependency)
// ----------------------------------------------------------

let _idCounter = 0;
function generateId(): string {
  const ts = Date.now().toString(36);
  const counter = (++_idCounter).toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${counter}-${rand}`;
}

// ----------------------------------------------------------
// StaviClient
// ----------------------------------------------------------

export class StaviClient {
  private ws: WebSocket | null = null;
  private config: StaviConnectionConfig | null = null;
  private state: StaviClientState = 'disconnected';
  private stateListeners = new Set<StateListener>();

  // Pending one-shot requests (id → callbacks)
  private pendingRequests = new Map<string, PendingRequest>();

  // Active streaming subscriptions (id → subscription)
  private activeSubscriptions = new Map<string, ActiveSubscription>();

  // All registered subscriptions (for resubscribe on reconnect)
  private registeredSubscriptions = new Map<string, ActiveSubscription>();

  // Reconnect state
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private maxReconnectAttempts = 7;
  private isIntentionalClose = false;

  // WS token + expiry
  private wsToken: string | null = null;
  private wsTokenExpiresAt: Date | null = null;

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  /** Current connection state */
  getState(): StaviClientState {
    return this.state;
  }

  /** Listen for state changes */
  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }

  /**
   * Connect to a Stavi server.
   * Handles the full auth flow: bearer → wsToken → WebSocket.
   */
  async connect(config: StaviConnectionConfig): Promise<void> {
    this.config = config;
    this.isIntentionalClose = false;
    this.reconnectAttempts = 0;

    await this._doConnect();
  }

  /**
   * Disconnect from the server.
   */
  disconnect(): void {
    this.isIntentionalClose = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Client disconnected'));
    }
    this.pendingRequests.clear();

    // Clear subscriptions
    this.activeSubscriptions.clear();
    this.registeredSubscriptions.clear();

    if (this.ws) {
      this.ws.onclose = null; // prevent stale onclose from firing after isIntentionalClose reset
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }

    this._setState('disconnected');
  }

  /**
   * Send a one-shot RPC request and wait for the response.
   */
  async request<T = unknown>(
    tag: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Not connected (state: ${this.state})`);
    }

    const id = generateId();
    const msg: RpcRequest = {
      _tag: 'Request',
      id,
      tag,
      payload,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${tag} (${timeoutMs}ms)`));
      }, timeoutMs);

      this.pendingRequests.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timeout,
      });

      this.ws!.send(JSON.stringify(msg));
    });
  }

  /**
   * Start a streaming subscription. Returns an unsubscribe function.
   *
   * Events arrive via `onEvent` callback. The subscription auto-resubscribes
   * on reconnect. Call the returned function to permanently unsubscribe.
   */
  subscribe(
    tag: string,
    payload: Record<string, unknown>,
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const subId = generateId();

    const sub: ActiveSubscription = {
      tag,
      payload,
      onEvent,
      onError,
      requestId: '', // set when we actually send
    };

    this.registeredSubscriptions.set(subId, sub);

    // If connected, start the subscription immediately
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this._sendSubscription(subId, sub);
    }

    // Return unsubscribe function
    return () => {
      this.registeredSubscriptions.delete(subId);
      if (sub.requestId) {
        this.activeSubscriptions.delete(sub.requestId);
      }
    };
  }

  // ----------------------------------------------------------
  // Internal: Connection
  // ----------------------------------------------------------

  private async _doConnect(): Promise<void> {
    const config = this.config;
    if (!config) throw new Error('No config');

    try {
      // Step 1: Get WS token (if needed)
      if (!this.wsToken || this._isTokenExpired()) {
        this._setState('authenticating');
        await this._fetchWsToken(config);
      }

      // Step 2: Open WebSocket
      this._setState('connecting');
      await this._openWebSocket(config);

      // Reset reconnect counter on success
      this.reconnectAttempts = 0;
      this._setState('connected');

      // Step 3: Resubscribe all registered subscriptions
      this._resubscribeAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StaviClient] Connect failed:', msg);

      // If this was a reconnect attempt, schedule another
      if (this.state === 'reconnecting' && !this.isIntentionalClose) {
        this._scheduleReconnect();
      } else {
        this._setState('disconnected', msg);
        throw err;
      }
    }
  }

  private async _fetchWsToken(config: StaviConnectionConfig): Promise<void> {
    const protocol = config.tls ? 'https' : 'http';
    const url = `${protocol}://${config.host}:${config.port}/api/auth/ws-token`;

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.bearerToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Auth failed (${resp.status}): ${body}`);
    }

    const data = (await resp.json()) as { token: string; expiresAt: string };
    this.wsToken = data.token;
    this.wsTokenExpiresAt = new Date(data.expiresAt);
  }

  private _isTokenExpired(): boolean {
    if (!this.wsTokenExpiresAt) return true;
    // Refresh 30s before expiry
    return Date.now() > this.wsTokenExpiresAt.getTime() - 30000;
  }

  private _openWebSocket(config: StaviConnectionConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = config.tls ? 'wss' : 'ws';
      const url = `${protocol}://${config.host}:${config.port}/ws?wsToken=${this.wsToken}`;

      // Close existing — nullify onclose BEFORE closing so the old
      // socket's close event doesn't fire our handler after isIntentionalClose
      // has been reset to false by a subsequent connect() call.
      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
        this.ws = null;
      }

      const ws = new WebSocket(url);
      (ws as WebSocket & { binaryType?: string }).binaryType = 'arraybuffer';

      let opened = false;

      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        this._handleMessage(event);
      };

      ws.onerror = (event) => {
        console.error('[StaviClient] WebSocket error:', event);
        if (!opened) {
          reject(new Error('WebSocket connection failed'));
        }
      };

      ws.onclose = (event: WebSocketCloseLike) => {
        this.ws = null;

        // Reject all pending one-shot requests
        for (const [id, pending] of this.pendingRequests) {
          clearTimeout(pending.timeout);
          pending.reject(new Error('Connection closed'));
        }
        this.pendingRequests.clear();
        this.activeSubscriptions.clear();

        if (!opened) {
          reject(new Error(`WebSocket closed before open (code: ${event.code ?? 'unknown'})`));
          return;
        }

        if (!this.isIntentionalClose && !event.wasClean) {
          // Unexpected disconnect — attempt reconnect
          this._setState('reconnecting');
          this._scheduleReconnect();
        } else if (!this.isIntentionalClose) {
          this._setState('disconnected');
        }
      };
    });
  }

  // ----------------------------------------------------------
  // Internal: Message handling
  // ----------------------------------------------------------

  private _handleMessage(event: WebSocketMessageLike): void {
    let msg: ServerMessage;
    try {
      if (event.data == null) {
        throw new Error('WebSocket message had no data');
      }
      const raw =
        typeof event.data === 'string'
          ? event.data
          : String.fromCharCode(...new Uint8Array(event.data));
      msg = JSON.parse(raw);
    } catch {
      console.error('[StaviClient] Failed to parse message');
      return;
    }

    switch (msg._tag) {
      case 'Exit':
        this._handleExit(msg as RpcExit);
        break;

      case 'Chunk':
        this._handleChunk(msg as RpcChunk);
        break;

      default:
        // ClientProtocolError, Defect, etc.
        console.warn('[StaviClient] Unhandled message type:', msg._tag);
        break;
    }
  }

  private _handleExit(msg: RpcExit): void {
    const { requestId, exit } = msg;

    // Check if it's a pending one-shot request
    const pending = this.pendingRequests.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      this.pendingRequests.delete(requestId);

      if (exit._tag === 'Success') {
        pending.resolve(exit.value);
      } else {
        const errorMsg = exit.cause?.error
          ? JSON.stringify(exit.cause.error)
          : 'RPC failed';
        pending.reject(new Error(errorMsg));
      }
      return;
    }

    // Check if it's a subscription exit
    const sub = this.activeSubscriptions.get(requestId);
    if (sub) {
      this.activeSubscriptions.delete(requestId);

      if (exit._tag === 'Failure') {
        const errorMsg = exit.cause?.error
          ? JSON.stringify(exit.cause.error)
          : 'Subscription failed';
        sub.onError?.(new Error(errorMsg));
      }

      // Subscriptions that exit need to be re-sent with a new request ID
      // Find the registration and re-subscribe
      for (const [subId, registered] of this.registeredSubscriptions) {
        if (registered.requestId === requestId) {
          // Re-subscribe with a new request ID
          if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this._sendSubscription(subId, registered);
          }
          break;
        }
      }
    }
  }

  private _handleChunk(msg: RpcChunk): void {
    const sub = this.activeSubscriptions.get(msg.requestId);
    if (!sub) return;

    for (const value of msg.values) {
      try {
        sub.onEvent(value);
      } catch (err) {
        console.error('[StaviClient] Event handler error:', err);
      }
    }
  }

  // ----------------------------------------------------------
  // Internal: Subscriptions
  // ----------------------------------------------------------

  private _sendSubscription(subId: string, sub: ActiveSubscription): void {
    const requestId = generateId();
    sub.requestId = requestId;
    this.activeSubscriptions.set(requestId, sub);

    const msg: RpcRequest = {
      _tag: 'Request',
      id: requestId,
      tag: sub.tag,
      payload: sub.payload,
    };

    this.ws!.send(JSON.stringify(msg));
  }

  private _resubscribeAll(): void {
    for (const [subId, sub] of this.registeredSubscriptions) {
      // Clear old requestId mapping
      if (sub.requestId) {
        this.activeSubscriptions.delete(sub.requestId);
      }
      this._sendSubscription(subId, sub);
    }
  }

  // ----------------------------------------------------------
  // Internal: Reconnect
  // ----------------------------------------------------------

  private _scheduleReconnect(): void {
    if (this.isIntentionalClose) return;

    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[StaviClient] Max reconnect attempts reached');
      this._setState('disconnected', 'Max reconnect attempts reached');
      return;
    }

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s, 32s, 64s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 64000);
    this.reconnectAttempts++;

    console.log(`[StaviClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      // Re-fetch wsToken on reconnect (it may have expired)
      this.wsToken = null;
      this._doConnect().catch(() => {
        // Error handled inside _doConnect
      });
    }, delay);
  }

  // ----------------------------------------------------------
  // Internal: State management
  // ----------------------------------------------------------

  private _setState(state: StaviClientState, error?: string): void {
    this.state = state;
    for (const listener of this.stateListeners) {
      try {
        listener(state, error);
      } catch (err) {
        console.error('[StaviClient] State listener error:', err);
      }
    }
  }
}

// ----------------------------------------------------------
// Singleton instance
// ----------------------------------------------------------

export const staviClient = new StaviClient();
