// ============================================================
// Transport Types — WebSocket connection, RPC, auth
// ============================================================

// ----------------------------------------------------------
// Connection
// ----------------------------------------------------------

export type ConnectionState =
  | 'idle'
  | 'connecting'
  | 'handshaking'
  | 'secure'
  | 'ready'
  | 'reconnecting'
  | 'closed'
  | 'error';

export interface ConnectionConfig {
  host: string;
  port: number;
  token: string;
  relayUrl?: string;
  useTls?: boolean;
}

export interface SavedConnection {
  id: string;
  label: string;
  config: ConnectionConfig;
  serverPublicKey?: string;
  lastConnected?: number;
  createdAt: number;
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
