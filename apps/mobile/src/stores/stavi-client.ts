// WHAT: Stavi WebSocket RPC Client — connection management and public API.
// WHY:  Single point of entry for all server communication from mobile.
// HOW:  StaviClient handles auth (HTTP bearer → wsToken), WebSocket lifecycle,
//       and reconnect backoff. All RPC dispatch is delegated to RpcEngine
//       (rpc-engine.ts). createStaviClient() is the factory used by connection.ts.
//
// Wire format:
//   Client → Server: { _tag: "Request", id, tag, payload }
//   Server → Client: { _tag: "Chunk", requestId, values }   (streaming)
//                    { _tag: "Exit", requestId, exit }       (final)
//
// Auth flow (direct LAN):
//   1. POST /api/auth/ws-token with Bearer token → { token, expiresAt }
//   2. Connect ws://<host>:<port>/ws?wsToken=<token>
//
// Auth flow (relay tunnel):
//   Use connectViaTransport(RelayTransport) — skips the HTTP auth step;
//   the Noise NK handshake inside RelayTransport authenticates the server.
// SEE:  apps/mobile/src/stores/rpc-engine.ts,
//       apps/mobile/src/transports/LocalWebSocketTransport.ts

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

/** Any server message */
type ServerMessage = { _tag: string; [key: string]: unknown };
type WebSocketCloseLike = { code?: number; wasClean?: boolean };
type WebSocketMessageLike = { data?: string | ArrayBuffer };

// Transport interface (used by connectViaTransport for relay tunnels)
import type { Transport } from '../transports/LocalWebSocketTransport';
import { decodeJsonMessage } from '../transports/LocalWebSocketTransport';
import {
  RpcEngine,
  makeTransportEngine,
  generateId,
  type ActiveSubscription,
  type RpcChunk,
  type RpcExit,
} from './rpc-engine';

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
// StaviClient
// ----------------------------------------------------------

export class StaviClient {
  private ws: WebSocket | null = null;
  private config: StaviConnectionConfig | null = null;
  private state: StaviClientState = 'disconnected';
  private stateListeners = new Set<StateListener>();

  // RPC engine for the current connection (replaced on each reconnect)
  private engine: RpcEngine | null = null;

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

  // Transport abstraction (set when using connectViaTransport)
  private _transport: Transport | null = null;

  // ----------------------------------------------------------
  // Public API
  // ----------------------------------------------------------

  getState(): StaviClientState { return this.state; }

  onStateChange(listener: StateListener): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  async connect(config: StaviConnectionConfig): Promise<void> {
    this.config = config;
    this._transport = null;
    this.isIntentionalClose = false;
    this.reconnectAttempts = 0;
    await this._doConnect();
  }

  async connectViaTransport(transport: Transport): Promise<void> {
    this._transport = transport;
    this.config = null;
    this.isIntentionalClose = false;
    this.reconnectAttempts = 0;
    this._setState('connecting');

    const eng = makeTransportEngine(transport);
    this.engine = eng;

    transport.onStateChange((state, error) => {
      if (state === 'closed') {
        eng.drainPending('Transport closed');
        this.engine = null;
        if (!this.isIntentionalClose) {
          this._setState('reconnecting');
        } else {
          this._setState('disconnected');
        }
      } else if (state === 'error') {
        this._setState('disconnected', error);
      }
    });

    transport.onMessage((data) => {
      let msg: ServerMessage;
      try {
        msg = decodeJsonMessage(data) as ServerMessage;
      } catch {
        console.error('[StaviClient] Failed to parse transport message');
        return;
      }
      this._routeMessage(msg);
    });

    this._setState('connected');
    this._resubscribeAll();
  }

  disconnect(): void {
    this.isIntentionalClose = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.engine?.drainPending('Client disconnected');
    this.engine = null;
    this.registeredSubscriptions.clear();
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    if (this._transport) {
      this._transport.close();
      this._transport = null;
    }
    this._setState('disconnected');
  }

  async request<T = unknown>(
    tag: string,
    payload: Record<string, unknown> = {},
    timeoutMs = 30000,
  ): Promise<T> {
    if (!this.engine) throw new Error(`Not connected (state: ${this.state})`);
    return this.engine.sendRequest<T>(tag, payload, timeoutMs);
  }

  subscribe(
    tag: string,
    payload: Record<string, unknown>,
    onEvent: (event: unknown) => void,
    onError?: (error: Error) => void,
  ): () => void {
    const subId = generateId();
    const sub: ActiveSubscription = { tag, payload, onEvent, onError, requestId: '' };
    this.registeredSubscriptions.set(subId, sub);
    if (this.engine) this.engine.sendSubscription(sub);
    return () => {
      this.registeredSubscriptions.delete(subId);
      if (sub.requestId && this.engine) this.engine.removeActiveSubscription(sub.requestId);
    };
  }

  /** Streaming RPC → Promise. Resolves on Exit.Success, rejects on Failure. */
  subscribeAsync(
    tag: string,
    payload: Record<string, unknown>,
    onChunk: (event: unknown) => void,
  ): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const subId = generateId();
      const sub: ActiveSubscription = {
        tag, payload, onEvent: onChunk, requestId: '',
        onError:    (err) => { this.registeredSubscriptions.delete(subId); reject(err); },
        onComplete: ()    => { this.registeredSubscriptions.delete(subId); resolve(); },
      };
      this.registeredSubscriptions.set(subId, sub);
      if (this.engine) {
        this.engine.sendSubscription(sub);
      } else {
        this.registeredSubscriptions.delete(subId);
        reject(new Error(`Not connected (state: ${this.state})`));
      }
    });
  }
  // Internal: Connection
  // ----------------------------------------------------------

  private async _doConnect(): Promise<void> {
    const config = this.config;
    if (!config) throw new Error('No config');

    try {
      if (!this.wsToken || this._isTokenExpired()) {
        this._setState('authenticating');
        await this._fetchWsToken(config);
      }
      this._setState('connecting');
      await this._openWebSocket(config);
      this.reconnectAttempts = 0;
      this._setState('connected');
      this._resubscribeAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[StaviClient] Connect failed:', msg);
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
    return Date.now() > this.wsTokenExpiresAt.getTime() - 30000;
  }

  private _openWebSocket(config: StaviConnectionConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const protocol = config.tls ? 'wss' : 'ws';
      const url = `${protocol}://${config.host}:${config.port}/ws?wsToken=${this.wsToken}`;

      if (this.ws) {
        this.ws.onclose = null;
        this.ws.close();
        this.ws = null;
      }

      const ws = new WebSocket(url);
      (ws as WebSocket & { binaryType?: string }).binaryType = 'arraybuffer';
      let opened = false;

      // Create a new RPC engine for this connection, sending via the WebSocket
      const eng = new RpcEngine((msg) => ws.send(msg as string));
      this.engine = eng;

      ws.onopen = () => {
        opened = true;
        this.ws = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        this._handleRawMessage(event);
      };

      ws.onerror = (event) => {
        console.error('[StaviClient] WebSocket error:', event);
        if (!opened) reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = (event: WebSocketCloseLike) => {
        this.ws = null;
        eng.drainPending('Connection closed');
        if (this.engine === eng) this.engine = null;

        if (!opened) {
          reject(new Error(`WebSocket closed before open (code: ${event.code ?? 'unknown'})`));
          return;
        }
        if (!this.isIntentionalClose && !event.wasClean) {
          this._setState('reconnecting');
          this._scheduleReconnect();
        } else if (!this.isIntentionalClose) {
          this._setState('disconnected');
        }
      };
    });
  }

  // ----------------------------------------------------------
  // Internal: Message routing
  // ----------------------------------------------------------

  private _handleRawMessage(event: WebSocketMessageLike): void {
    let msg: ServerMessage;
    try {
      if (event.data == null) throw new Error('WebSocket message had no data');
      const raw =
        typeof event.data === 'string'
          ? event.data
          : String.fromCharCode(...new Uint8Array(event.data as ArrayBuffer));
      msg = JSON.parse(raw);
    } catch {
      console.error('[StaviClient] Failed to parse message');
      return;
    }
    this._routeMessage(msg);
  }

  private _routeMessage(msg: ServerMessage): void {
    if (!this.engine) return;
    switch (msg._tag) {
      case 'Exit': this.engine.handleExit(msg as unknown as RpcExit); break;
      case 'Chunk': this.engine.handleChunk(msg as unknown as RpcChunk); break;
      default: console.warn('[StaviClient] Unhandled message type:', msg._tag);
    }
  }

  // ----------------------------------------------------------
  // Internal: Subscriptions + Reconnect
  // ----------------------------------------------------------

  private _resubscribeAll(): void {
    if (!this.engine) return;
    for (const [, sub] of this.registeredSubscriptions) {
      if (sub.requestId) {
        this.engine.removeActiveSubscription(sub.requestId);
        sub.requestId = '';
      }
      this.engine.sendSubscription(sub);
    }
  }

  private _scheduleReconnect(): void {
    if (this.isIntentionalClose) return;
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[StaviClient] Max reconnect attempts reached');
      this._setState('disconnected', 'Max reconnect attempts reached');
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 64000);
    this.reconnectAttempts++;
    console.log(`[StaviClient] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.wsToken = null;
      this._doConnect().catch(() => {});
    }, delay);
  }

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
// Factory
// ----------------------------------------------------------

export function createStaviClient(config?: StaviConnectionConfig): StaviClient {
  const client = new StaviClient();
  if (config) void client.connect(config);
  return client;
}
