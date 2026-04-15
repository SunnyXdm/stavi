// WHAT: Relay transport — connects to the zero-knowledge relay and runs Noise NK.
// WHY:  Provides E2E encrypted access to a Stavi server over the public relay pipe
//       when a direct LAN connection is not available (e.g. remote access from mobile).
// HOW:  1. Opens WebSocket to relayUrl/room/{roomId}?role=mobile&token={bearerToken}
//          2. Waits for "peer_connected" signal from relay
//          3. Runs Noise NK initiator handshake (mobile knows server static public key)
//          4. After handshake: wraps/unwraps DATA frames with noiseEncrypt/noiseDecrypt
//          5. Emits decrypted JSON payloads via onMessage callback
//
//       On WebSocket close: emits 'closed' state — caller (connection.ts) is responsible
//       for reconnect. Each reconnect runs a fresh handshake (session never reused).
//
//       Frame format (from @stavi/crypto): ST magic + version + type + 8B nonce LE + payload
//       HANDSHAKE frames: payload = raw msg bytes (no encryption during handshake)
//       DATA frames: payload = AEAD(plaintext) with per-direction nonce counter
// SEE:  apps/mobile/src/transports/LocalWebSocketTransport.ts (Transport interface),
//       packages/crypto/src/noise.ts (Noise NK state machine),
//       apps/relay/src/index.ts (relay server — zero-knowledge pipe)

import {
  buildFrame,
  parseFrameHeader,
  FrameType,
  initiateHandshake,
  completeHandshake,
  noiseEncrypt,
  noiseDecrypt,
  type NoiseSession,
  type HandshakeInitiatorState,
} from '@stavi/crypto';
import { rnPrimitives } from '@stavi/crypto/rn-primitives';
import type { Transport, TransportState } from './LocalWebSocketTransport';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface RelayTransportConfig {
  /** Full URL of the relay server, e.g. wss://relay.stavi.app */
  relayUrl: string;
  /** Room identifier returned by the server in the PairingPayload */
  roomId: string;
  /** Server's static X25519 public key, base64-encoded */
  serverPublicKey: string;
  /** Bearer token — used as the relay room access token */
  bearerToken: string;
}

// ----------------------------------------------------------
// RelayTransport
// ----------------------------------------------------------

export class RelayTransport implements Transport {
  private ws: WebSocket | null = null;
  private noiseSession: NoiseSession | null = null;
  private _onMessageCb: ((data: Uint8Array) => void) | null = null;
  private _onStateCb: ((state: TransportState, error?: string) => void) | null = null;
  private _closed = false;

  constructor(private config: RelayTransportConfig) {}

  onMessage(cb: (data: Uint8Array) => void): void {
    this._onMessageCb = cb;
  }

  onStateChange(cb: (state: TransportState, error?: string) => void): void {
    this._onStateCb = cb;
  }

  async connect(): Promise<void> {
    this._closed = false;
    this._emitState('connecting');

    const { relayUrl, roomId, bearerToken } = this.config;
    const wsUrl = `${relayUrl}/room/${roomId}?role=mobile&token=${bearerToken}`;

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(wsUrl);
      (ws as WebSocket & { binaryType?: string }).binaryType = 'arraybuffer';

      let handshakeState: HandshakeInitiatorState | null = null;
      let peerConnected = false;

      ws.onopen = () => {
        // WebSocket open — wait for relay to signal peer_connected
      };

      ws.onerror = () => {
        if (!peerConnected) {
          reject(new Error('RelayTransport: WebSocket connection failed'));
        }
      };

      ws.onclose = (event) => {
        this.ws = null;
        if (!this._closed) {
          this._emitState('closed');
        }
        // If we were still in handshake, reject the connect promise.
        if (!this.noiseSession) {
          reject(
            new Error(
              `RelayTransport: closed during handshake (code: ${(event as { code?: number }).code ?? 'unknown'})`,
            ),
          );
        }
      };

      ws.onmessage = (event) => {
        const data: ArrayBuffer | string = (event as { data: ArrayBuffer | string }).data;

        // Relay signals (JSON text) — before peer is connected
        if (typeof data === 'string') {
          let msg: { type: string };
          try {
            msg = JSON.parse(data) as { type: string };
          } catch {
            return;
          }

          if (msg.type === 'peer_connected') {
            peerConnected = true;
            // Start Noise NK handshake
            try {
              const serverPubKey = _base64ToBytes(this.config.serverPublicKey);
              const { msg1, state } = initiateHandshake(rnPrimitives, serverPubKey);
              handshakeState = state;
              ws.send(buildFrame(FrameType.HANDSHAKE, 0, msg1));
            } catch (err) {
              reject(err);
              ws.close();
            }
          } else if (msg.type === 'peer_disconnected') {
            this._emitState('closed');
            ws.close();
          }
          return;
        }

        // Binary frame from server
        const bytes = new Uint8Array(data);
        const frame = parseFrameHeader(bytes);
        if (!frame) {
          console.warn('[RelayTransport] Received unrecognised frame, ignoring');
          return;
        }

        if (frame.type === FrameType.HANDSHAKE && handshakeState && !this.noiseSession) {
          // msg2 from server — complete handshake
          try {
            this.noiseSession = completeHandshake(rnPrimitives, handshakeState, frame.payload);
            this.ws = ws;
            this._emitState('open');
            resolve();
          } catch (err) {
            reject(err);
            ws.close();
          }
          return;
        }

        if (frame.type === FrameType.DATA && this.noiseSession) {
          // Decrypt and deliver
          try {
            const plaintext = noiseDecrypt(
              this.noiseSession,
              rnPrimitives,
              frame.payload,
              frame.nonce,
            );
            this._onMessageCb?.(plaintext);
          } catch (err) {
            console.error('[RelayTransport] Decrypt failed:', err);
            this._emitState('error', err instanceof Error ? err.message : String(err));
            ws.close();
          }
        }
      };
    });
  }

  send(data: Uint8Array): void {
    if (!this.ws || !this.noiseSession) {
      throw new Error('RelayTransport: not established');
    }
    const { ciphertext, nonce } = noiseEncrypt(this.noiseSession, rnPrimitives, data);
    this.ws.send(buildFrame(FrameType.DATA, nonce, ciphertext));
  }

  close(): void {
    this._closed = true;
    this.noiseSession = null;
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

  private _emitState(state: TransportState, error?: string): void {
    try {
      this._onStateCb?.(state, error);
    } catch {}
  }
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function _base64ToBytes(b64: string): Uint8Array {
  // Support both standard base64 and base64url
  const std = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return bytes;
}
