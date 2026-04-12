// ============================================================
// @stavi/crypto — Noise NK encryption types and interfaces
// ============================================================
// Platform-specific implementations live in:
//   - apps/server (Node.js built-in crypto)
//   - apps/mobile (react-native-quick-crypto)
// This package defines the shared interface and pure-JS helpers.

// ----------------------------------------------------------
// Noise NK handshake types
// ----------------------------------------------------------

export interface NoiseKeypair {
  publicKey: Uint8Array; // 32 bytes X25519
  secretKey: Uint8Array; // 32 bytes X25519
}

export interface NoiseSession {
  /** Whether the handshake is complete */
  established: boolean;

  /** Encryption key for outgoing messages (client→server or server→client) */
  txKey: Uint8Array | null;

  /** Decryption key for incoming messages */
  rxKey: Uint8Array | null;

  /** Nonce counter for outgoing messages */
  txNonce: number;

  /** Expected nonce counter for incoming messages */
  rxNonce: number;
}

export type HandshakeState =
  | 'idle'
  | 'awaiting_server_hello'
  | 'awaiting_client_confirm'
  | 'established'
  | 'failed';

// ----------------------------------------------------------
// Wire format for encrypted frames
// ----------------------------------------------------------

// Binary frame layout:
// [0x53, 0x54] (magic: "ST" for Stavi)
// [0x01]       (version)
// [type: 1B]   (0x01=handshake, 0x02=data, 0x03=ping, 0x04=close)
// [nonce: 8B]  (little-endian uint64 counter)
// [payload]    (ciphertext for data frames, plaintext for handshake)

export const FRAME_MAGIC = new Uint8Array([0x53, 0x54]); // "ST"
export const FRAME_VERSION = 0x01;

export enum FrameType {
  HANDSHAKE = 0x01,
  DATA = 0x02,
  PING = 0x03,
  CLOSE = 0x04,
}

export const FRAME_HEADER_SIZE = 2 + 1 + 1 + 8; // magic(2) + version(1) + type(1) + nonce(8) = 12 bytes

// ----------------------------------------------------------
// Crypto primitive interface (platform-specific implementations)
// ----------------------------------------------------------

export interface CryptoPrimitives {
  /** Generate an X25519 keypair */
  generateKeypair(): NoiseKeypair;

  /** Compute X25519 ECDH shared secret */
  ecdh(mySecret: Uint8Array, theirPublic: Uint8Array): Uint8Array;

  /** Encrypt with ChaCha20-Poly1305 */
  encrypt(key: Uint8Array, nonce: Uint8Array, plaintext: Uint8Array): Uint8Array;

  /** Decrypt with ChaCha20-Poly1305 */
  decrypt(key: Uint8Array, nonce: Uint8Array, ciphertext: Uint8Array): Uint8Array | null;

  /** HKDF-SHA256 key derivation */
  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array;

  /** SHA-256 hash */
  sha256(data: Uint8Array): Uint8Array;

  /** Cryptographically secure random bytes */
  randomBytes(length: number): Uint8Array;
}

// ----------------------------------------------------------
// Pure-JS helpers (no platform deps)
// ----------------------------------------------------------

/** Encode nonce counter as 12-byte Uint8Array (for ChaCha20-Poly1305, 96-bit nonce) */
export function nonceFromCounter(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  // Write as little-endian 64-bit integer in the first 8 bytes
  const view = new DataView(nonce.buffer);
  view.setUint32(0, counter & 0xffffffff, true);
  view.setUint32(4, Math.floor(counter / 0x100000000), true);
  return nonce;
}

/** Build a binary frame */
export function buildFrame(type: FrameType, nonce: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(FRAME_HEADER_SIZE + payload.length);
  frame.set(FRAME_MAGIC, 0);
  frame[2] = FRAME_VERSION;
  frame[3] = type;

  const view = new DataView(frame.buffer);
  view.setUint32(4, nonce & 0xffffffff, true);
  view.setUint32(8, Math.floor(nonce / 0x100000000), true);

  frame.set(payload, FRAME_HEADER_SIZE);
  return frame;
}

/** Parse a binary frame header */
export function parseFrameHeader(data: Uint8Array): { type: FrameType; nonce: number; payload: Uint8Array } | null {
  if (data.length < FRAME_HEADER_SIZE) return null;
  if (data[0] !== FRAME_MAGIC[0] || data[1] !== FRAME_MAGIC[1]) return null;
  if (data[2] !== FRAME_VERSION) return null;

  const type = data[3] as FrameType;
  const view = new DataView(data.buffer, data.byteOffset);
  const nonceLow = view.getUint32(4, true);
  const nonceHigh = view.getUint32(8, true);
  const nonce = nonceLow + nonceHigh * 0x100000000;

  const payload = data.slice(FRAME_HEADER_SIZE);
  return { type, nonce, payload };
}
