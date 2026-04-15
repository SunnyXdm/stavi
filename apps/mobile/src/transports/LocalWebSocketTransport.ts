// WHAT: Transport interface + LocalWebSocketTransport (direct LAN connection).
// WHY:  Abstracts send/receive so StaviClient can use either a direct WebSocket
//       or a Noise-encrypted relay tunnel — without duplicating RPC logic.
// HOW:  Transport defines three methods: send, onMessage, onStateChange, close.
//       LocalWebSocketTransport wraps the existing bearer→wsToken→WebSocket auth flow
//       and emits text messages as Uint8Array (UTF-8). Behaviour is identical to
//       the pre-Phase-6 StaviClient direct path.
// SEE:  apps/mobile/src/transports/RelayTransport.ts (tunnel variant),
//       apps/mobile/src/stores/stavi-client.ts

// ----------------------------------------------------------
// Transport interface
// ----------------------------------------------------------

export type TransportState = 'connecting' | 'open' | 'closed' | 'error';

export interface Transport {
  /** Send raw bytes over the transport. */
  send(data: Uint8Array): void;

  /** Register a callback invoked for every incoming message. */
  onMessage(cb: (data: Uint8Array) => void): void;

  /** Register a callback invoked on transport state transitions. */
  onStateChange(cb: (state: TransportState, error?: string) => void): void;

  /** Close the transport. */
  close(): void;
}

// ----------------------------------------------------------
// LocalWebSocketTransport
// ----------------------------------------------------------

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

export interface LocalTransportConfig {
  host: string;
  port: number;
  bearerToken: string;
  tls?: boolean;
}

/**
 * Direct LAN WebSocket transport.
 * Auth flow: POST /api/auth/ws-token → ws://<host>:<port>/ws?wsToken=<token>
 * Messages are JSON text — encoded as UTF-8 Uint8Array for the Transport interface.
 */
export class LocalWebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private _onMessageCb: ((data: Uint8Array) => void) | null = null;
  private _onStateCb: ((state: TransportState, error?: string) => void) | null = null;
  private wsToken: string | null = null;

  constructor(private config: LocalTransportConfig) {}

  onMessage(cb: (data: Uint8Array) => void): void {
    this._onMessageCb = cb;
  }

  onStateChange(cb: (state: TransportState, error?: string) => void): void {
    this._onStateCb = cb;
  }

  async connect(): Promise<void> {
    this._emitState('connecting');
    await this._fetchWsToken();
    await this._openWs();
    this._emitState('open');
  }

  send(data: Uint8Array): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error('LocalWebSocketTransport: not open');
    }
    // Server expects JSON text; data is already UTF-8-encoded JSON.
    this.ws.send(TEXT_DECODER.decode(data));
  }

  close(): void {
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.close(1000, 'transport closed');
      this.ws = null;
    }
    this._emitState('closed');
  }

  // ----------------------------------------------------------
  // Internal
  // ----------------------------------------------------------

  private async _fetchWsToken(): Promise<void> {
    const { host, port, bearerToken, tls } = this.config;
    const protocol = tls ? 'https' : 'http';
    const resp = await fetch(`${protocol}://${host}:${port}/api/auth/ws-token`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bearerToken}`,
        'Content-Type': 'application/json',
      },
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      throw new Error(`Auth failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { token: string };
    this.wsToken = data.token;
  }

  private _openWs(): Promise<void> {
    return new Promise((resolve, reject) => {
      const { host, port, tls } = this.config;
      const protocol = tls ? 'wss' : 'ws';
      const url = `${protocol}://${host}:${port}/ws?wsToken=${this.wsToken}`;

      const ws = new WebSocket(url);
      (ws as WebSocket & { binaryType?: string }).binaryType = 'arraybuffer';

      ws.onopen = () => {
        this.ws = ws;
        resolve();
      };

      ws.onmessage = (event) => {
        if (!this._onMessageCb) return;
        const raw: string =
          typeof event.data === 'string'
            ? event.data
            : TEXT_DECODER.decode(event.data as ArrayBuffer);
        this._onMessageCb(TEXT_ENCODER.encode(raw));
      };

      ws.onerror = () => {
        reject(new Error('WebSocket connection failed'));
      };

      ws.onclose = () => {
        this.ws = null;
        this._emitState('closed');
      };
    });
  }

  private _emitState(state: TransportState, error?: string): void {
    try {
      this._onStateCb?.(state, error);
    } catch {}
  }
}

/** Encode a JSON-serialisable object as UTF-8 bytes for Transport.send. */
export function encodeJsonMessage(msg: unknown): Uint8Array {
  return TEXT_ENCODER.encode(JSON.stringify(msg));
}

/** Decode Transport-received bytes back to a JSON-parsed object. */
export function decodeJsonMessage(data: Uint8Array): unknown {
  return JSON.parse(TEXT_DECODER.decode(data));
}
