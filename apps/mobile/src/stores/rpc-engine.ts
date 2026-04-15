// WHAT: RPC engine — request/response machinery, subscription dispatch, timeout handling.
// WHY:  stavi-client.ts exceeded 400 lines; the RPC protocol layer is a clear seam
//       separate from connection management (auth, WebSocket open, reconnect).
// HOW:  RpcEngine is instantiated by StaviClient on each fresh connection.
//       All pending requests are drained (rejected) when the engine is destroyed.
//       Subscriptions are re-sent by StaviClient after reconnect via resubscribeAll().
// SEE:  apps/mobile/src/stores/stavi-client.ts,
//       apps/mobile/src/transports/LocalWebSocketTransport.ts

import { encodeJsonMessage } from '../transports/LocalWebSocketTransport';
import type { Transport } from '../transports/LocalWebSocketTransport';

// ----------------------------------------------------------
// Types (local to this module; re-exported by stavi-client.ts)
// ----------------------------------------------------------

/** Request message sent to Stavi server */
export interface RpcRequest {
  _tag: 'Request';
  id: string;
  tag: string;
  payload: Record<string, unknown>;
}

/** Chunk message (streaming response) */
export interface RpcChunk {
  _tag: 'Chunk';
  requestId: string;
  values: unknown[];
}

/** Exit message (final response) */
export interface RpcExit {
  _tag: 'Exit';
  requestId: string;
  exit: {
    _tag: 'Success' | 'Failure';
    value?: unknown;
    cause?: { _tag: string; error?: unknown };
  };
}

/** Active streaming subscription */
export interface ActiveSubscription {
  tag: string;
  payload: Record<string, unknown>;
  onEvent: (event: unknown) => void;
  onError?: (error: Error) => void;
  onComplete?: () => void;
  requestId: string;
}

/** Pending one-shot request */
interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}

type SendFn = (data: string | Uint8Array) => void;

// ----------------------------------------------------------
// UUID generator (counter-based, no crypto dependency)
// ----------------------------------------------------------

let _idCounter = 0;
export function generateId(): string {
  const ts = Date.now().toString(36);
  const counter = (++_idCounter).toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${counter}-${rand}`;
}

// ----------------------------------------------------------
// RpcEngine
// ----------------------------------------------------------

/**
 * Manages in-flight RPC requests and active subscriptions for a single connection.
 * Create a new instance for each connection; destroy on disconnect.
 */
export class RpcEngine {
  private pendingRequests = new Map<string, PendingRequest>();
  private activeSubscriptions = new Map<string, ActiveSubscription>();

  constructor(private send: SendFn) {}

  /** Send a one-shot request and return a promise for the response. */
  sendRequest<T>(
    tag: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    const id = generateId();
    const msg: RpcRequest = { _tag: 'Request', id, tag, payload };

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

      this._sendRaw(msg);
    });
  }

  /** Register a subscription request. Returns the assigned requestId. */
  sendSubscription(sub: ActiveSubscription): string {
    const requestId = generateId();
    sub.requestId = requestId;
    this.activeSubscriptions.set(requestId, sub);

    const msg: RpcRequest = {
      _tag: 'Request',
      id: requestId,
      tag: sub.tag,
      payload: sub.payload,
    };
    this._sendRaw(msg);
    return requestId;
  }

  /** Deregister an active subscription by its requestId. */
  removeActiveSubscription(requestId: string): void {
    this.activeSubscriptions.delete(requestId);
  }

  /** Handle an Exit message from the server. */
  handleExit(msg: RpcExit): void {
    const { requestId, exit } = msg;

    // One-shot request
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

    // Subscription exit — call onComplete or onError, then clean up
    const sub = this.activeSubscriptions.get(requestId);
    if (sub) {
      this.activeSubscriptions.delete(requestId);
      if (exit._tag === 'Failure') {
        const errorMsg = exit.cause?.error
          ? JSON.stringify(exit.cause.error)
          : 'Subscription failed';
        sub.onError?.(new Error(errorMsg));
      } else {
        sub.onComplete?.();
      }
    }
  }

  /** Handle a Chunk message from the server. */
  handleChunk(msg: RpcChunk): void {
    const sub = this.activeSubscriptions.get(msg.requestId);
    if (!sub) return;
    for (const value of msg.values) {
      try {
        sub.onEvent(value);
      } catch (err) {
        console.error('[RpcEngine] Event handler error:', err);
      }
    }
  }

  /** Drain all pending requests with an error (call on disconnect). */
  drainPending(reason: string): void {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pendingRequests.clear();
    this.activeSubscriptions.clear();
  }

  private _sendRaw(msg: RpcRequest): void {
    if (typeof this.send === 'function') {
      // Send as JSON string (plain WebSocket) or encoded bytes (transport)
      this.send(JSON.stringify(msg));
    }
  }
}

/** Build an RpcEngine that sends via a Transport (relay tunnel). */
export function makeTransportEngine(transport: Transport): RpcEngine {
  return new RpcEngine((msg) => {
    // msg is a JSON string here; encode to bytes for the transport
    transport.send(encodeJsonMessage(JSON.parse(msg as string) as RpcRequest));
  });
}
