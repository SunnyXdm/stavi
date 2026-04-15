// ============================================================
// Transport Types — WebSocket connection, RPC, auth
// ============================================================
// WHAT: Canonical transport / connection types shared across mobile, cli, relay.
// WHY:  Single source of truth — Phase 5 unifies the mobile-only SavedConnection
//       shape into this file and removes the diverged mobile definition.
// HOW:  Exports SavedConnection (mobile canonical shape), legacy shims, RPC types.
// SEE:  apps/mobile/src/stores/connection.ts, packages/server-core/src/context.ts

// ----------------------------------------------------------
// Connection
// ----------------------------------------------------------

export type ConnectionState =
  | 'idle'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disconnected';

/**
 * Canonical SavedConnection shape — adopted from the mobile store in Phase 5.
 * The old @stavi/shared shape (label/config/serverPublicKey) is removed because
 * no server-side code consumed it (grep confirmed zero server-side consumers).
 *
 * serverId is optional until the first successful connect, at which point
 * it is locked to the value returned by server.getConfig.serverId.
 */
export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  bearerToken: string;
  tls?: boolean;
  createdAt: number;
  lastConnectedAt?: number;
  /** Bound after first successful connect via server.getConfig.serverId. */
  serverId?: string;
  /** Relay server URL — set when connection was created via QR pairing. */
  relayUrl?: string;
  /** Server's static X25519 public key (base64) — required when relayUrl is set. */
  serverPublicKey?: string;
  /** Relay room ID — required when relayUrl is set. */
  roomId?: string;
}

/** @deprecated Use SavedConnection. Kept for reference during Phase 6 relay work. */
export interface ConnectionConfig {
  host: string;
  port: number;
  token: string;
  relayUrl?: string;
  useTls?: boolean;
}

// ----------------------------------------------------------
// RPC Protocol — namespaced messages
// ----------------------------------------------------------

export interface RpcMessage {
  /** Protocol version */
  v: 1;

  /** Correlation ID — matches request to response */
  id: string;

  /** Namespace — which service handles this */
  ns: RpcNamespace;

  /** Action within the namespace */
  action: string;

  /** Payload data */
  payload: Record<string, unknown>;
}

export interface RpcResponse extends RpcMessage {
  /** Whether the request succeeded */
  ok: boolean;

  /** Error info if ok=false */
  error?: { code: string; message: string };
}

export type RpcNamespace =
  | 'orchestration'
  | 'terminal'
  | 'fs'
  | 'git'
  | 'process'
  | 'system'
  | 'server'
  | 'auth';

// ----------------------------------------------------------
// Streaming subscription — server pushes events to client
// ----------------------------------------------------------

export interface SubscriptionMessage {
  v: 1;
  ns: RpcNamespace;
  action: string;
  payload: Record<string, unknown>;

  /** Monotonic sequence number for replay on reconnect */
  seq: number;
}

// ----------------------------------------------------------
// Auth / Pairing
// ----------------------------------------------------------

export interface PairingPayload {
  /** Relay server URL (or empty for LAN-direct) */
  relay?: string;

  /** Room ID for relay routing */
  roomId: string;

  /** Server's static X25519 public key (base64) */
  serverPublicKey: string;

  /** One-time auth token */
  token: string;

  /** Server's LAN address (for direct connection) */
  lanHost?: string;

  /** Server's port */
  port: number;
}
