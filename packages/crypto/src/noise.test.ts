// WHAT: Unit tests for the Noise NK handshake and data-phase encrypt/decrypt.
// WHY:  Verifies that the pure-JS state machine in noise.ts produces correct,
//       interoperable results — full initiator↔responder round-trip in one process.
// HOW:  Uses nodePrimitives (node:crypto + @stablelib). No mocking.
//       Tests: full handshake, data encrypt/decrypt, replay rejection, nonce symmetry.
// SEE:  packages/crypto/src/noise.ts, packages/crypto/src/node-primitives.ts

import assert from 'node:assert';
import { test } from 'node:test';
import { nodePrimitives } from './node-primitives';
import {
  initiateHandshake,
  completeHandshake,
  respondHandshake,
  noiseEncrypt,
  noiseDecrypt,
} from './noise';

// ----------------------------------------------------------
// Full handshake round-trip
// ----------------------------------------------------------

test('Noise NK: full handshake establishes a session on both sides', () => {
  const serverKeypair = nodePrimitives.generateKeypair();

  // Initiator side: generate msg1
  const { msg1, state: initiatorState } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);

  assert.ok(msg1.length >= 48, `msg1 too short: ${msg1.length}`); // 32 pubkey + 16 tag

  // Responder side: process msg1, generate msg2
  const { msg2, session: serverSession } = respondHandshake(nodePrimitives, serverKeypair, msg1);

  assert.ok(msg2.length >= 48, `msg2 too short: ${msg2.length}`);
  assert.ok(serverSession.established, 'server session not established');
  assert.ok(serverSession.txKey, 'server txKey missing');
  assert.ok(serverSession.rxKey, 'server rxKey missing');

  // Initiator side: process msg2, derive session keys
  const mobileSession = completeHandshake(nodePrimitives, initiatorState, msg2);

  assert.ok(mobileSession.established, 'mobile session not established');
  assert.ok(mobileSession.txKey, 'mobile txKey missing');
  assert.ok(mobileSession.rxKey, 'mobile rxKey missing');

  // Keys must be symmetric: mobile.txKey == server.rxKey and vice versa
  assert.deepStrictEqual(
    Buffer.from(mobileSession.txKey!).toString('hex'),
    Buffer.from(serverSession.rxKey!).toString('hex'),
    'mobile.txKey !== server.rxKey',
  );
  assert.deepStrictEqual(
    Buffer.from(mobileSession.rxKey!).toString('hex'),
    Buffer.from(serverSession.txKey!).toString('hex'),
    'mobile.rxKey !== server.txKey',
  );
});

// ----------------------------------------------------------
// Data-phase round-trip
// ----------------------------------------------------------

test('Noise NK: mobile encrypts, server decrypts (data phase)', () => {
  const serverKeypair = nodePrimitives.generateKeypair();
  const { msg1, state } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2, session: serverSession } = respondHandshake(nodePrimitives, serverKeypair, msg1);
  const mobileSession = completeHandshake(nodePrimitives, state, msg2);

  const plaintext = new TextEncoder().encode('{"_tag":"Request","id":"1","tag":"test","payload":{}}');

  // Mobile encrypts
  const { ciphertext, nonce } = noiseEncrypt(mobileSession, nodePrimitives, plaintext);
  assert.strictEqual(nonce, 0, 'first nonce should be 0');
  assert.notDeepEqual(ciphertext, plaintext, 'ciphertext should differ from plaintext');

  // Server decrypts
  const decrypted = noiseDecrypt(serverSession, nodePrimitives, ciphertext, nonce);
  assert.deepStrictEqual(decrypted, plaintext, 'decrypted payload mismatch');

  // Nonces incremented
  assert.strictEqual(mobileSession.txNonce, 1, 'txNonce should be 1 after one encrypt');
  assert.strictEqual(serverSession.rxNonce, 1, 'rxNonce should be 1 after one decrypt');
});

test('Noise NK: server encrypts, mobile decrypts (data phase)', () => {
  const serverKeypair = nodePrimitives.generateKeypair();
  const { msg1, state } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2, session: serverSession } = respondHandshake(nodePrimitives, serverKeypair, msg1);
  const mobileSession = completeHandshake(nodePrimitives, state, msg2);

  const plaintext = new TextEncoder().encode('{"_tag":"Chunk","requestId":"1","values":[{"text":"hello"}]}');

  const { ciphertext, nonce } = noiseEncrypt(serverSession, nodePrimitives, plaintext);
  const decrypted = noiseDecrypt(mobileSession, nodePrimitives, ciphertext, nonce);

  assert.deepStrictEqual(decrypted, plaintext);
});

test('Noise NK: multiple messages in sequence maintain correct nonces', () => {
  const serverKeypair = nodePrimitives.generateKeypair();
  const { msg1, state } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2, session: serverSession } = respondHandshake(nodePrimitives, serverKeypair, msg1);
  const mobileSession = completeHandshake(nodePrimitives, state, msg2);

  for (let i = 0; i < 5; i++) {
    const text = new TextEncoder().encode(`message-${i}`);
    const { ciphertext, nonce } = noiseEncrypt(mobileSession, nodePrimitives, text);
    assert.strictEqual(nonce, i, `expected nonce ${i}`);
    const dec = noiseDecrypt(serverSession, nodePrimitives, ciphertext, nonce);
    assert.deepStrictEqual(dec, text);
  }

  assert.strictEqual(mobileSession.txNonce, 5);
  assert.strictEqual(serverSession.rxNonce, 5);
});

// ----------------------------------------------------------
// Replay protection
// ----------------------------------------------------------

test('Noise NK: replay protection — out-of-order nonce throws', () => {
  const serverKeypair = nodePrimitives.generateKeypair();
  const { msg1, state } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2, session: serverSession } = respondHandshake(nodePrimitives, serverKeypair, msg1);
  const mobileSession = completeHandshake(nodePrimitives, state, msg2);

  const plaintext = new TextEncoder().encode('hello');
  const { ciphertext } = noiseEncrypt(mobileSession, nodePrimitives, plaintext);

  // Decrypt successfully once (nonce=0)
  noiseDecrypt(serverSession, nodePrimitives, ciphertext, 0);

  // Replay: nonce=0 again should throw
  assert.throws(
    () => noiseDecrypt(serverSession, nodePrimitives, ciphertext, 0),
    /expected nonce 1, got 0/i,
    'Expected replay protection error',
  );
});

test('Noise NK: wrong server key — completeHandshake throws', () => {
  const serverKeypair = nodePrimitives.generateKeypair();
  const wrongKeypair = nodePrimitives.generateKeypair();

  // Initiator thinks it's talking to wrongKeypair, but server has serverKeypair
  const { msg1, state } = initiateHandshake(nodePrimitives, wrongKeypair.publicKey);

  assert.throws(
    () => respondHandshake(nodePrimitives, serverKeypair, msg1),
    /msg1 authentication failed/i,
    'Expected handshake auth failure',
  );
});

test('Noise NK: keys differ for different server keypairs', () => {
  const serverA = nodePrimitives.generateKeypair();
  const serverB = nodePrimitives.generateKeypair();

  const { msg1: m1a, state: stA } = initiateHandshake(nodePrimitives, serverA.publicKey);
  const { msg1: m1b, state: stB } = initiateHandshake(nodePrimitives, serverB.publicKey);

  const { session: sessA } = respondHandshake(nodePrimitives, serverA, m1a);
  const { session: sessB } = respondHandshake(nodePrimitives, serverB, m1b);

  const mobA = completeHandshake(nodePrimitives, stA, respondHandshake(nodePrimitives, serverA, m1a).msg2);
  const mobB = completeHandshake(nodePrimitives, stB, respondHandshake(nodePrimitives, serverB, m1b).msg2);

  // Session keys must differ between sessions
  assert.notDeepEqual(
    Buffer.from(mobA.txKey!).toString('hex'),
    Buffer.from(mobB.txKey!).toString('hex'),
    'Different servers must produce different session keys',
  );
});

// ----------------------------------------------------------
// Fresh keys on reconnect
// ----------------------------------------------------------

test('Noise NK: two successive handshakes with the same responder keypair produce different session keys', () => {
  // This pins the "fresh keys every reconnect" invariant required by the master plan.
  // Same server static keypair, but each handshake generates a new initiator ephemeral
  // (inside initiateHandshake via generateKeypair()) — the resulting session keys MUST differ.
  // If this test fails, something is caching or reusing ephemeral or session state.
  const serverKeypair = nodePrimitives.generateKeypair();

  // First handshake
  const { msg1: msg1a, state: stateA } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2: msg2a } = respondHandshake(nodePrimitives, serverKeypair, msg1a);
  const sessionA = completeHandshake(nodePrimitives, stateA, msg2a);

  // Second handshake — simulates a reconnect. New RelayTransport would call
  // initiateHandshake again, generating a fresh ephemeral keypair.
  const { msg1: msg1b, state: stateB } = initiateHandshake(nodePrimitives, serverKeypair.publicKey);
  const { msg2: msg2b } = respondHandshake(nodePrimitives, serverKeypair, msg1b);
  const sessionB = completeHandshake(nodePrimitives, stateB, msg2b);

  assert.notDeepEqual(
    Buffer.from(sessionA.txKey!).toString('hex'),
    Buffer.from(sessionB.txKey!).toString('hex'),
    'Two successive handshakes must produce different txKeys (fresh ephemeral each time)',
  );
  assert.notDeepEqual(
    Buffer.from(sessionA.rxKey!).toString('hex'),
    Buffer.from(sessionB.rxKey!).toString('hex'),
    'Two successive handshakes must produce different rxKeys (fresh ephemeral each time)',
  );
});
