// ============================================================
// test/claude-e2e.test.ts — Claude dispatch chain e2e test
// ============================================================
// WHAT: Verifies that events emitted by ClaudeAdapter.sendTurn()
//       are correctly yielded through the async generator. This
//       confirms the Phase 7a context.ts split (into context.ts,
//       subscriptions.ts, orchestration-helpers.ts, process-spawn.ts)
//       did not break the event dispatch chain.
// WHY:  Phase 8a plan identifies a risk that the Phase 7a split
//       could have broken Claude event delivery. This test locks in
//       the correct behavior: sendTurn yields text-delta and turn-complete.
// HOW:  Uses a stub SDK query() that emits stream_event(text_delta)
//       and result. Verifies ClaudeAdapter.sendTurn yields matching
//       ProviderEvents. This test does NOT test the server-level
//       broadcastOrchestrationEvent path — only the adapter itself.
// SEE:  packages/server-core/src/providers/claude.ts,
//       packages/server-core/src/context.ts,
//       packages/server-core/src/subscriptions.ts

import { test, expect, mock } from 'bun:test';

// ----------------------------------------------------------
// Stub SDK — intercepts @anthropic-ai/claude-agent-sdk
// ----------------------------------------------------------

const stubCalls: Array<{ options: Record<string, unknown> }> = [];

async function* stubQueryRuntime() {
  // Emit a content_block_start (text block)
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_start',
      content_block: { type: 'text', text: '' },
    },
  };
  // Emit text deltas
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello from Claude' },
    },
  };
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_stop',
    },
  };
  yield {
    type: 'stream_event',
    event: {
      type: 'message_stop',
    },
  };
  // Emit result (turn complete)
  yield {
    type: 'result',
    session_id: 'e2e-session-456',
    usage: { input_tokens: 10, output_tokens: 20 },
  };
}

mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> }) => {
    stubCalls.push({ options: args.options });
    return stubQueryRuntime();
  },
}));

// Import after mock is set up
const { ClaudeAdapter } = await import('../src/providers/claude');

// ----------------------------------------------------------
// Tests
// ----------------------------------------------------------

test('sendTurn yields text-delta and turn-complete events', async () => {
  const adapter = new ClaudeAdapter(() => undefined);
  (adapter as any).ready = true;

  const threadId = 'e2e-thread-1';
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  for await (const event of adapter.sendTurn({
    threadId,
    text: 'Hello',
    cwd: '/tmp',
  } as any)) {
    events.push(event);
  }

  // Must have at least a text-delta and a turn-complete
  const types = events.map((e) => e.type);
  expect(types).toContain('text-delta');
  expect(types).toContain('turn-complete');

  // Verify text-delta contains the stub text
  const textEvent = events.find((e) => e.type === 'text-delta');
  expect(textEvent).toBeDefined();
  expect(textEvent!.data.text).toBe('Hello from Claude');

  // Verify turn-complete has usage
  const turnCompleteEvent = events.find((e) => e.type === 'turn-complete');
  expect(turnCompleteEvent).toBeDefined();
  const usage = turnCompleteEvent!.data.usage as { inputTokens: number; outputTokens: number } | null;
  expect(usage).toBeDefined();
  expect(usage!.inputTokens).toBe(10);
  expect(usage!.outputTokens).toBe(20);

  // Verify session state after turn
  const session = (adapter as any).sessions.get(threadId);
  expect(session).toBeDefined();
  expect(session.hasStarted).toBe(true);
  expect(session.sessionId).toBe('e2e-session-456');
  expect(session.queryRuntime).toBeNull();
});

test('sendTurn yields text-done before turn-complete', async () => {
  const adapter = new ClaudeAdapter(() => undefined);
  (adapter as any).ready = true;

  const threadId = 'e2e-thread-2';
  const events: Array<{ type: string; data: Record<string, unknown> }> = [];

  for await (const event of adapter.sendTurn({
    threadId,
    text: 'Test',
    cwd: '/tmp',
  } as any)) {
    events.push(event);
  }

  const types = events.map((e) => e.type);

  // text-done should appear (emitted on message_stop)
  expect(types).toContain('text-done');

  // text-done must come before turn-complete in the sequence
  const textDoneIdx = types.indexOf('text-done');
  const turnCompleteIdx = types.indexOf('turn-complete');
  expect(textDoneIdx).toBeLessThan(turnCompleteIdx);

  // text-done should contain the full accumulated text
  const textDoneEvent = events.find((e) => e.type === 'text-done');
  expect(textDoneEvent!.data.text).toBe('Hello from Claude');
});

test('multi-turn: second turn uses resume, first uses sessionId', async () => {
  const adapter = new ClaudeAdapter(() => undefined);
  (adapter as any).ready = true;

  const threadId = 'e2e-thread-3';

  // First turn
  for await (const _ of adapter.sendTurn({
    threadId,
    text: 'Turn 1',
    cwd: '/tmp',
  } as any)) {}

  const firstCall = stubCalls[stubCalls.length - 1];
  expect(firstCall.options).toHaveProperty('sessionId');
  expect(firstCall.options).not.toHaveProperty('resume');

  // Second turn
  for await (const _ of adapter.sendTurn({
    threadId,
    text: 'Turn 2',
    cwd: '/tmp',
  } as any)) {}

  const secondCall = stubCalls[stubCalls.length - 1];
  expect(secondCall.options).toHaveProperty('resume', 'e2e-session-456');
  expect(secondCall.options).not.toHaveProperty('sessionId');
});
