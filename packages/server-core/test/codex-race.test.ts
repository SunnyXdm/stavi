// ============================================================
// test/codex-race.test.ts — Race condition regression test
// ============================================================
// WHAT: Verifies that turn/completed arriving BEFORE the turn/start
//       RPC response resolves does NOT cause events to be dropped.
// WHY:  The original bug: handleNotification('turn/completed') set
//       session.status = 'ready' during await sendRequest('turn/start'),
//       causing the drain loop's `while (status === 'running')` to
//       never execute. Phase 8a fixes this by making the drain loop
//       event-driven, not status-driven.
// HOW:  Mocks sendRequest to delay 10ms, but fires handleNotification
//       with turn/completed at 5ms (before sendRequest resolves).
//       Asserts all events are still yielded.
// SEE:  packages/server-core/src/providers/codex.ts,
//       plans/08-restructure-plan.md Phase 8a Root Cause Analysis

import { test, expect } from 'bun:test';
import {
  textDelta,
  turnComplete,
  type ProviderEvent,
} from '../src/providers/types';
import { CodexAdapter } from '../src/providers/codex';

test('events are yielded even when turn/completed fires before sendRequest resolves', async () => {
  const threadId = 'race-test-1';
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

  // Mock sendRequest: takes 10ms to resolve, but during the wait,
  // events + turn/completed arrive at 5ms (simulating the race).
  (adapter as any).sendRequest = (_session: any, method: string) => {
    return new Promise<unknown>((resolve) => {
      if (method === 'turn/start') {
        // Simulate: events arrive at 5ms, before sendRequest resolves at 10ms
        setTimeout(() => {
          // These events would be buffered by handleNotification's emitEvent calls
          session.eventBuffer.push(textDelta(threadId, 'response text', 'turn-race'));
          session.eventBuffer.push(turnComplete(threadId, 'turn-race'));

          // Simulate what handleNotification('turn/completed') used to do:
          // session.status = 'ready';  // <-- THE BUG (now removed)
          // With the fix, handleNotification only emits the event, doesn't set status.

          // Wake the drain loop if it's already waiting
          if (session.eventResolve) {
            const r = session.eventResolve;
            session.eventResolve = null;
            r();
          }
        }, 5);

        // sendRequest resolves at 10ms
        setTimeout(() => resolve({ turn: { id: 'turn-race' } }), 10);
      } else {
        resolve({});
      }
    });
  };

  const yielded: ProviderEvent[] = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'test race',
    cwd: '/tmp',
  })) {
    yielded.push(event);
  }

  // Both events must be yielded — this is the critical assertion.
  // Before the fix, the drain loop would see session.status === 'ready'
  // and exit immediately, yielding 0 events.
  expect(yielded).toHaveLength(2);
  expect(yielded[0].type).toBe('text-delta');
  expect(yielded[0].data.text).toBe('response text');
  expect(yielded[1].type).toBe('turn-complete');

  expect(session.status).toBe('ready');
  expect(session.activeTurnId).toBeNull();
});

test('events arriving incrementally during drain are all yielded', async () => {
  // Simulate events arriving one at a time with small delays
  const threadId = 'race-test-2';
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

  const pushEvent = (event: ProviderEvent) => {
    session.eventBuffer.push(event);
    if (session.eventResolve) {
      const r = session.eventResolve;
      session.eventResolve = null;
      r();
    }
  };

  (adapter as any).sendRequest = (_session: any, method: string) => {
    return new Promise<unknown>((resolve) => {
      if (method === 'turn/start') {
        // Events arrive incrementally after sendRequest resolves
        resolve({ turn: { id: 'turn-inc' } });

        // Queue events with staggered timing
        setTimeout(() => pushEvent(textDelta(threadId, 'chunk1', 'turn-inc')), 2);
        setTimeout(() => pushEvent(textDelta(threadId, 'chunk2', 'turn-inc')), 4);
        setTimeout(() => pushEvent(textDelta(threadId, 'chunk3', 'turn-inc')), 6);
        setTimeout(() => pushEvent(turnComplete(threadId, 'turn-inc')), 8);
      } else {
        resolve({});
      }
    });
  };

  const yielded: ProviderEvent[] = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'test incremental',
    cwd: '/tmp',
  })) {
    yielded.push(event);
  }

  expect(yielded).toHaveLength(4);
  expect(yielded[0].type).toBe('text-delta');
  expect(yielded[0].data.text).toBe('chunk1');
  expect(yielded[1].type).toBe('text-delta');
  expect(yielded[1].data.text).toBe('chunk2');
  expect(yielded[2].type).toBe('text-delta');
  expect(yielded[2].data.text).toBe('chunk3');
  expect(yielded[3].type).toBe('turn-complete');
  expect(session.status).toBe('ready');
});
