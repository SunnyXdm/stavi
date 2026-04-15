// ============================================================
// test/codex-drain.test.ts — Drain loop unit test
// ============================================================
// WHAT: Verifies that the sendTurn drain loop yields all buffered
//       events in order and transitions session.status to 'ready'
//       only after the terminal event (turn-complete or turn-error).
// WHY:  Phase 8a rewrote the drain loop to be event-driven instead
//       of status-driven. This test locks in the correct behavior.
// HOW:  Constructs a CodexAdapter with a mock subprocess that
//       pre-buffers events, then asserts sendTurn yields them all.
// SEE:  packages/server-core/src/providers/codex.ts

import { test, expect } from 'bun:test';
import {
  textDelta,
  toolUseStart,
  toolUseDone,
  turnComplete,
  type ProviderEvent,
} from '../src/providers/types';
import { CodexAdapter } from '../src/providers/codex';

// ----------------------------------------------------------
// Helper: create an adapter with a rigged session
// ----------------------------------------------------------

function createRiggedAdapter(threadId: string, events: ProviderEvent[]) {
  const adapter = new CodexAdapter(() => '/fake/codex');
  (adapter as any).ready = true;

  // Manually inject a session in 'ready' state with pre-buffered events
  const session = {
    threadId,
    cwd: '/tmp',
    process: null,
    nextRequestId: 1,
    pending: new Map(),
    pendingApprovals: new Map(),
    providerThreadId: 'thread-abc',
    activeTurnId: null,
    status: 'ready' as const,
    eventBuffer: [] as ProviderEvent[],
    eventResolve: null as any,
  };
  (adapter as any).sessions.set(threadId, session);

  // Override sendRequest to resolve immediately and pre-load events into the buffer
  (adapter as any).sendRequest = async () => {
    // Simulate: all events arrive while we were "awaiting" the RPC response
    for (const event of events) {
      session.eventBuffer.push(event);
    }
    return { turn: { id: 'turn-123' } };
  };

  return { adapter, session };
}

// ----------------------------------------------------------
// Tests
// ----------------------------------------------------------

test('drain loop yields all pre-buffered events in order', async () => {
  const threadId = 'drain-test-1';
  const expectedEvents: ProviderEvent[] = [
    textDelta(threadId, 'Hello ', 'turn-123'),
    textDelta(threadId, 'world', 'turn-123'),
    toolUseStart(threadId, 'bash', 'tool-1', { command: 'ls' }, 'turn-123'),
    toolUseDone(threadId, 'tool-1', 'file.txt', 'turn-123'),
    turnComplete(threadId, 'turn-123'),
  ];

  const { adapter, session } = createRiggedAdapter(threadId, expectedEvents);

  const yielded: ProviderEvent[] = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'test',
    cwd: '/tmp',
  })) {
    yielded.push(event);
  }

  expect(yielded).toHaveLength(5);
  expect(yielded[0].type).toBe('text-delta');
  expect(yielded[1].type).toBe('text-delta');
  expect(yielded[2].type).toBe('tool-use-start');
  expect(yielded[3].type).toBe('tool-use-done');
  expect(yielded[4].type).toBe('turn-complete');

  // Verify text content
  expect(yielded[0].data.text).toBe('Hello ');
  expect(yielded[1].data.text).toBe('world');

  // Verify session.status is 'ready' after draining
  expect(session.status).toBe('ready');
  expect(session.activeTurnId).toBeNull();
});

test('drain loop handles turn-error as terminal event', async () => {
  const threadId = 'drain-test-2';
  const expectedEvents: ProviderEvent[] = [
    textDelta(threadId, 'partial', 'turn-123'),
    { type: 'turn-error', threadId, turnId: 'turn-123', data: { error: 'rate limited' } },
  ];

  const { adapter, session } = createRiggedAdapter(threadId, expectedEvents);

  const yielded: ProviderEvent[] = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'test',
    cwd: '/tmp',
  })) {
    yielded.push(event);
  }

  expect(yielded).toHaveLength(2);
  expect(yielded[0].type).toBe('text-delta');
  expect(yielded[1].type).toBe('turn-error');
  expect(session.status).toBe('ready');
  expect(session.activeTurnId).toBeNull();
});

test('drain loop yields events even after status is already ready', async () => {
  // This is the exact race condition scenario: events are buffered AND
  // session.status could theoretically be set to 'ready' by handleNotification
  // (though with the fix, handleNotification no longer does this).
  // The point is: the drain loop doesn't care about status anymore.
  const threadId = 'drain-test-3';
  const expectedEvents: ProviderEvent[] = [
    textDelta(threadId, 'text', 'turn-123'),
    turnComplete(threadId, 'turn-123'),
  ];

  const adapter = new CodexAdapter(() => '/fake/codex');
  (adapter as any).ready = true;

  const session = {
    threadId,
    cwd: '/tmp',
    process: null,
    nextRequestId: 1,
    pending: new Map(),
    pendingApprovals: new Map(),
    providerThreadId: 'thread-abc',
    activeTurnId: null,
    status: 'ready' as const,
    eventBuffer: [] as ProviderEvent[],
    eventResolve: null as any,
  };
  (adapter as any).sessions.set(threadId, session);

  (adapter as any).sendRequest = async () => {
    // Pre-buffer events
    for (const event of expectedEvents) {
      session.eventBuffer.push(event);
    }
    // Simulate the old race: status gets set to 'ready' during await
    // (this would happen if handleNotification still set status)
    // With the fix, handleNotification doesn't do this, but the drain
    // loop should work regardless.
    return { turn: { id: 'turn-123' } };
  };

  const yielded: ProviderEvent[] = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'test',
    cwd: '/tmp',
  })) {
    yielded.push(event);
  }

  expect(yielded).toHaveLength(2);
  expect(yielded[0].type).toBe('text-delta');
  expect(yielded[1].type).toBe('turn-complete');
});
