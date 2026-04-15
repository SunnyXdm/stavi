// WHAT: Noise NK handshake state machine for Stavi tunnel mode.
// WHY:  Provides E2E encryption between mobile and server over the relay pipe.
//       Noise NK is chosen because initiator (mobile) knows server's static public key
//       from the QR pairing payload — no TOFU or certificate pinning needed.
// HOW:  Implements the Noise NK pattern using @stablelib primitives (not custom crypto).
//       Exports initiateHandshake / completeHandshake (mobile/initiator side) and
//       respondHandshake (server/responder side), plus noiseEncrypt / noiseDecrypt for
//       the data phase.
// SEE:  packages/crypto/src/index.ts (types + frame helpers),
//       packages/crypto/src/node-primitives.ts,
//       packages/crypto/src/rn-primitives.ts,
//       https://noiseprotocol.org/noise.html#pattern-modifiers (NK pattern)
//
// ============================================================
// NONCE DIRECTION CONVENTION
// ============================================================
// After handshake completes, each side has two independent keys:
//   txKey — used to encrypt messages this side SENDS
//   rxKey — used to decrypt messages this side RECEIVES
//
// The keys are symmetric across the pair:
//   mobile.txKey == server.rxKey  (mobile→server direction)
//   mobile.rxKey == server.txKey  (server→mobile direction)
//
// Each direction has its own independent nonce counter starting at 0.
// On EVERY reconnect the handshake is run fresh — session state is NEVER reused.
// Receiving a nonce that does not equal the expected rxNonce is a hard error.
// ============================================================

import type { CryptoPrimitives, NoiseKeypair, NoiseSession } from './index';

// ----------------------------------------------------------
// Noise NK internal state types
// ----------------------------------------------------------

// Protocol identifier per the Noise spec.
const PROTOCOL_NAME = 'Noise_NK_25519_ChaChaPoly_SHA256';

// Intermediate handshake state held by the initiator between msg1 and msg2.
export interface HandshakeInitiatorState {
  /** Initiator's ephemeral keypair */
  ephemeralKeypair: NoiseKeypair;
  /** Handshake hash after sending msg1 */
  h: Uint8Array;
  /** Chaining key after sending msg1 */
  ck: Uint8Array;
}

// ----------------------------------------------------------
// MixKey: update ck and derive a temp key k using HKDF.
// Per Noise spec: HKDF(ck, input_key_material) → (ck', k)
// ----------------------------------------------------------
function mixKey(
  primitives: CryptoPrimitives,
  ck: Uint8Array,
  ikm: Uint8Array,
): { ck: Uint8Array; k: Uint8Array } {
  const out = primitives.hkdf(ikm, ck, new Uint8Array(0), 64);
  return { ck: out.slice(0, 32), k: out.slice(32, 64) };
}

// ----------------------------------------------------------
// MixHash: h = SHA256(h || data)
// ----------------------------------------------------------
function mixHash(primitives: CryptoPrimitives, h: Uint8Array, data: Uint8Array): Uint8Array {
  const combined = new Uint8Array(h.length + data.length);
  combined.set(h, 0);
  combined.set(data, h.length);
  return primitives.sha256(combined);
}

// ----------------------------------------------------------
// Split: derives final (txKey, rxKey) from the chaining key.
// Per Noise spec: HKDF(ck, "") → (k1, k2)
// Initiator uses k1 as txKey, k2 as rxKey.
// Responder uses k2 as txKey, k1 as rxKey.
// ----------------------------------------------------------
function split(
  primitives: CryptoPrimitives,
  ck: Uint8Array,
): { k1: Uint8Array; k2: Uint8Array } {
  const out = primitives.hkdf(new Uint8Array(0), ck, new Uint8Array(0), 64);
  return { k1: out.slice(0, 32), k2: out.slice(32, 64) };
}

// ----------------------------------------------------------
// AEAD helpers: encrypt/decrypt with handshake hash as AD.
// Nonce during handshake is always 0 (per Noise spec).
// ----------------------------------------------------------
const HANDSHAKE_NONCE = new Uint8Array(12); // 12 zero bytes

function encryptWithHash(
  primitives: CryptoPrimitives,
  k: Uint8Array,
  h: Uint8Array,
  plaintext: Uint8Array,
): Uint8Array {
  // The associated data (AD) for AEAD during the handshake is the current hash h.
  // @stablelib's ChaCha20Poly1305.seal(nonce, plaintext, associatedData) → ciphertext+tag
  return primitives.encrypt(k, HANDSHAKE_NONCE, plaintext, h);
}

function decryptWithHash(
  primitives: CryptoPrimitives,
  k: Uint8Array,
  h: Uint8Array,
  ciphertext: Uint8Array,
): Uint8Array | null {
  return primitives.decrypt(k, HANDSHAKE_NONCE, ciphertext, h);
}

// ----------------------------------------------------------
// initiateHandshake — run on the mobile (initiator) side.
//
// Returns msg1 bytes to send over the relay, plus opaque state
// to pass to completeHandshake when msg2 arrives.
//
// msg1 layout: e.publicKey (32 bytes) || AEAD(empty, k, h) (16 bytes tag)
// ----------------------------------------------------------
export function initiateHandshake(
  primitives: CryptoPrimitives,
  remoteStaticPublicKey: Uint8Array,
): { msg1: Uint8Array; state: HandshakeInitiatorState } {
  // Initialize handshake state per Noise spec.
  const protocolBytes = new TextEncoder().encode(PROTOCOL_NAME);
  let h = primitives.sha256(protocolBytes);
  let ck = h;

  // MixHash(rs) — bind the known server static public key into the hash.
  h = mixHash(primitives, h, remoteStaticPublicKey);

  // Generate initiator ephemeral keypair.
  const ephemeralKeypair = primitives.generateKeypair();

  // MixHash(e.publicKey)
  h = mixHash(primitives, h, ephemeralKeypair.publicKey);

  // es = ECDH(e.secret, rs)  (ephemeral-static DH)
  const es = primitives.ecdh(ephemeralKeypair.secretKey, remoteStaticPublicKey);

  // MixKey(es) → new ck, temp key k
  const mixed = mixKey(primitives, ck, es);
  ck = mixed.ck;
  const k = mixed.k;

  // Encrypt empty plaintext (produces 16-byte auth tag).
  const encryptedEmpty = encryptWithHash(primitives, k, h, new Uint8Array(0));

  // MixHash(encryptedEmpty)
  h = mixHash(primitives, h, encryptedEmpty);

  // msg1 = e.publicKey || encryptedEmpty
  const msg1 = new Uint8Array(32 + encryptedEmpty.length);
  msg1.set(ephemeralKeypair.publicKey, 0);
  msg1.set(encryptedEmpty, 32);

  return {
    msg1,
    state: { ephemeralKeypair, h, ck },
  };
}

// ----------------------------------------------------------
// completeHandshake — run on the mobile side after receiving msg2.
//
// Returns a fully established NoiseSession ready for data transfer.
// Throws if the handshake auth tag fails (server identity mismatch).
//
// msg2 layout: re.publicKey (32 bytes) || AEAD(empty, k, h) (16 bytes tag)
// ----------------------------------------------------------
export function completeHandshake(
  primitives: CryptoPrimitives,
  state: HandshakeInitiatorState,
  msg2: Uint8Array,
): NoiseSession {
  if (msg2.length < 32 + 16) {
    throw new Error('Noise handshake: msg2 too short');
  }

  let { h, ck } = state;
  const { ephemeralKeypair } = state;

  // Parse responder's ephemeral public key from msg2.
  const re = msg2.slice(0, 32);
  const encryptedPayload = msg2.slice(32);

  // MixHash(re)
  h = mixHash(primitives, h, re);

  // ee = ECDH(e.secret, re.public)  (ephemeral-ephemeral DH)
  const ee = primitives.ecdh(ephemeralKeypair.secretKey, re);

  // MixKey(ee) → new ck, temp key k
  const mixed = mixKey(primitives, ck, ee);
  ck = mixed.ck;
  const k = mixed.k;

  // Decrypt and verify the auth tag (payload is empty).
  const plaintext = decryptWithHash(primitives, k, h, encryptedPayload);
  if (plaintext === null) {
    throw new Error('Noise handshake: msg2 authentication failed — server identity mismatch');
  }

  // MixHash(encryptedPayload)
  h = mixHash(primitives, h, encryptedPayload);

  // Split: derive final session keys.
  const { k1, k2 } = split(primitives, ck);

  // Initiator: txKey = k1 (mobile→server), rxKey = k2 (server→mobile)
  return {
    established: true,
    txKey: k1,
    rxKey: k2,
    txNonce: 0,
    rxNonce: 0,
  };
}

// ----------------------------------------------------------
// respondHandshake — run on the server side.
//
// Receives msg1 from the initiator, verifies it, and returns
// msg2 to send back plus a fully established NoiseSession.
// ----------------------------------------------------------
export function respondHandshake(
  primitives: CryptoPrimitives,
  staticKeypair: NoiseKeypair,
  msg1: Uint8Array,
): { msg2: Uint8Array; session: NoiseSession } {
  if (msg1.length < 32 + 16) {
    throw new Error('Noise handshake: msg1 too short');
  }

  // Initialize handshake state — must mirror what the initiator did.
  const protocolBytes = new TextEncoder().encode(PROTOCOL_NAME);
  let h = primitives.sha256(protocolBytes);
  let ck = h;

  // MixHash(s.publicKey) — same as initiator's MixHash(rs)
  h = mixHash(primitives, h, staticKeypair.publicKey);

  // Parse initiator's ephemeral public key from msg1.
  const re = msg1.slice(0, 32);
  const encryptedPayload = msg1.slice(32);

  // MixHash(re)
  h = mixHash(primitives, h, re);

  // es = ECDH(s.secret, re)  (static-ephemeral DH, responder side)
  const es = primitives.ecdh(staticKeypair.secretKey, re);

  // MixKey(es) → new ck, temp key k
  const mixed1 = mixKey(primitives, ck, es);
  ck = mixed1.ck;
  const k1 = mixed1.k;

  // Verify auth tag from msg1.
  const verified = decryptWithHash(primitives, k1, h, encryptedPayload);
  if (verified === null) {
    throw new Error('Noise handshake: msg1 authentication failed');
  }

  // MixHash(encryptedPayload)
  h = mixHash(primitives, h, encryptedPayload);

  // Generate responder ephemeral keypair.
  const ephemeralKeypair = primitives.generateKeypair();

  // MixHash(e2.publicKey)
  h = mixHash(primitives, h, ephemeralKeypair.publicKey);

  // ee = ECDH(e2.secret, re)  (ephemeral-ephemeral DH)
  const ee = primitives.ecdh(ephemeralKeypair.secretKey, re);

  // MixKey(ee) → new ck, temp key k2
  const mixed2 = mixKey(primitives, ck, ee);
  ck = mixed2.ck;
  const k2 = mixed2.k;

  // Encrypt empty plaintext for msg2.
  const encryptedEmpty2 = encryptWithHash(primitives, k2, h, new Uint8Array(0));

  // MixHash(encryptedEmpty2)
  h = mixHash(primitives, h, encryptedEmpty2);

  // msg2 = e2.publicKey || encryptedEmpty2
  const msg2 = new Uint8Array(32 + encryptedEmpty2.length);
  msg2.set(ephemeralKeypair.publicKey, 0);
  msg2.set(encryptedEmpty2, 32);

  // Split: derive final session keys.
  const { k1: sk1, k2: sk2 } = split(primitives, ck);

  // Responder: txKey = k2 (server→mobile), rxKey = k1 (mobile→server)
  const session: NoiseSession = {
    established: true,
    txKey: sk2,
    rxKey: sk1,
    txNonce: 0,
    rxNonce: 0,
  };

  return { msg2, session };
}

// ----------------------------------------------------------
// noiseEncrypt — encrypt a plaintext for sending.
//
// Mutates session.txNonce (increments after use).
// Returns ciphertext and the nonce that was used (for the frame header).
// ----------------------------------------------------------
export function noiseEncrypt(
  session: NoiseSession,
  primitives: CryptoPrimitives,
  plaintext: Uint8Array,
): { ciphertext: Uint8Array; nonce: number } {
  if (!session.established || !session.txKey) {
    throw new Error('Noise session not established');
  }

  const nonce = session.txNonce;
  const nonceBytes = dataPhaseNonce(nonce);

  // No associated data in the data phase (empty AD).
  const ciphertext = primitives.encrypt(session.txKey, nonceBytes, plaintext, new Uint8Array(0));

  session.txNonce = nonce + 1;
  return { ciphertext, nonce };
}

// ----------------------------------------------------------
// noiseDecrypt — decrypt an incoming ciphertext.
//
// Verifies the nonce matches the expected rxNonce (replay protection).
// Throws on nonce mismatch or decryption failure.
// Mutates session.rxNonce (increments after successful decrypt).
// ----------------------------------------------------------
export function noiseDecrypt(
  session: NoiseSession,
  primitives: CryptoPrimitives,
  ciphertext: Uint8Array,
  nonce: number,
): Uint8Array {
  if (!session.established || !session.rxKey) {
    throw new Error('Noise session not established');
  }

  // Replay protection: nonce must be exactly the next expected value.
  if (nonce !== session.rxNonce) {
    throw new Error(
      `Noise replay protection: expected nonce ${session.rxNonce}, got ${nonce}`,
    );
  }

  const nonceBytes = dataPhaseNonce(nonce);
  const plaintext = primitives.decrypt(session.rxKey, nonceBytes, ciphertext, new Uint8Array(0));

  if (plaintext === null) {
    throw new Error('Noise decryption failed: authentication tag mismatch');
  }

  session.rxNonce = nonce + 1;
  return plaintext;
}

// ----------------------------------------------------------
// dataPhaseNonce — encode a counter as a 12-byte nonce.
// Same format as nonceFromCounter in index.ts; duplicated here
// to avoid circular imports. Little-endian 64-bit in first 8 bytes.
// ----------------------------------------------------------
function dataPhaseNonce(counter: number): Uint8Array {
  const nonce = new Uint8Array(12);
  const view = new DataView(nonce.buffer);
  view.setUint32(0, counter & 0xffffffff, true);
  view.setUint32(4, Math.floor(counter / 0x100000000), true);
  return nonce;
}
