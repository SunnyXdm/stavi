// WHAT: Node.js CryptoPrimitives implementation for apps/cli and packages/server-core.
// WHY:  The Noise NK handshake requires platform-specific crypto bindings;
//       this module provides the Node.js side using @stablelib pure-JS primitives
//       and node:crypto for randomBytes.
// HOW:  @stablelib/x25519 for X25519 keygen + ECDH,
//       @stablelib/chacha20poly1305 for AEAD encrypt/decrypt,
//       @stablelib/hkdf + @stablelib/sha256 for HKDF key derivation,
//       node:crypto randomBytes for secure randomness.
// SEE:  packages/crypto/src/index.ts (CryptoPrimitives interface),
//       packages/crypto/src/noise.ts (Noise NK state machine),
//       packages/crypto/src/rn-primitives.ts (React Native equivalent)

import { randomBytes as nodeRandomBytes } from 'node:crypto';
import { generateKeyPair, sharedKey } from '@stablelib/x25519';
import { ChaCha20Poly1305 } from '@stablelib/chacha20poly1305';
import { HKDF } from '@stablelib/hkdf';
import { SHA256, hash as sha256Hash } from '@stablelib/sha256';
import type { CryptoPrimitives, NoiseKeypair } from './index';

export const nodePrimitives: CryptoPrimitives = {
  generateKeypair(): NoiseKeypair {
    const kp = generateKeyPair();
    return { publicKey: kp.publicKey, secretKey: kp.secretKey };
  },

  ecdh(mySecret: Uint8Array, theirPublic: Uint8Array): Uint8Array {
    return sharedKey(mySecret, theirPublic);
  },

  encrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    plaintext: Uint8Array,
    associatedData?: Uint8Array,
  ): Uint8Array {
    const aead = new ChaCha20Poly1305(key);
    return aead.seal(nonce, plaintext, associatedData);
  },

  decrypt(
    key: Uint8Array,
    nonce: Uint8Array,
    ciphertext: Uint8Array,
    associatedData?: Uint8Array,
  ): Uint8Array | null {
    const aead = new ChaCha20Poly1305(key);
    return aead.open(nonce, ciphertext, associatedData) ?? null;
  },

  hkdf(ikm: Uint8Array, salt: Uint8Array, info: Uint8Array, length: number): Uint8Array {
    const hkdf = new HKDF(SHA256, ikm, salt, info);
    return hkdf.expand(length);
  },

  sha256(data: Uint8Array): Uint8Array {
    return sha256Hash(data);
  },

  randomBytes(length: number): Uint8Array {
    return new Uint8Array(nodeRandomBytes(length));
  },
};
