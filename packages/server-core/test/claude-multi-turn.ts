// ============================================================
// test/claude-multi-turn.ts — Multi-turn resume integration test
// ============================================================
// WHAT: Verifies that ClaudeAdapter correctly transitions from
//       sessionId-based (first turn) to resume-based (subsequent turns).
// WHY:  plans/architecture-analysis.md and plans/recon-report.md claimed
//       multi-turn was broken. Verified 2026-04-14 that hasStarted IS set
//       at claude.ts:539 and read at :369. This test locks the behaviour in.
// HOW:  Uses a stub query() implementation so no real Claude binary is needed.
//       The stub records which options were passed on each call and yields a
//       synthetic 'result' SDKMessage.
// SEE:  packages/server-core/src/providers/claude.ts

import { test, expect, mock } from 'bun:test';

// ----------------------------------------------------------
// Stub SDK
// ----------------------------------------------------------

interface CapturedCall {
  options: Record<string, unknown>;
}

const capturedCalls: CapturedCall[] = [];

// Minimal synthetic turn: emits one text delta then a result.
async function* stubQueryRuntime() {
  yield {
    type: 'stream_event',
    event: {
      type: 'content_block_delta',
      delta: { type: 'text_delta', text: 'Hello from stub' },
    },
  };
  yield {
    type: 'result',
    session_id: 'stub-session-123',
    usage: { input_tokens: 5, output_tokens: 5 },
  };
}

// Intercept the SDK query() call.
mock.module('@anthropic-ai/claude-agent-sdk', () => ({
  query: (args: { options: Record<string, unknown> }) => {
    capturedCalls.push({ options: args.options });
    return stubQueryRuntime();
  },
}));

// ----------------------------------------------------------
// Tests
// ----------------------------------------------------------

// We need to import ClaudeAdapter after the mock is set up.
const { ClaudeAdapter } = await import('../src/providers/claude');

test('first turn uses sessionId, not resume', async () => {
  const adapter = new ClaudeAdapter(() => undefined);
  // Skip initialize() — binary check not relevant in test.
  (adapter as any).ready = true;

  const threadId = 'test-thread-1';
  const events = [];
  for await (const event of adapter.sendTurn({
    threadId,
    text: 'Turn 1',
    cwd: '/tmp',
  } as any)) {
    events.push(event);
  }

  const firstCall = capturedCalls[capturedCalls.length - 1]; // most recent
  expect(firstCall).toBeDefined();
  expect(firstCall.options).not.toHaveProperty('resume');
  expect(firstCall.options).toHaveProperty('sessionId');
});

test('second turn uses resume after first turn sets hasStarted', async () => {
  const adapter = new ClaudeAdapter(() => undefined);
  (adapter as any).ready = true;

  const threadId = 'test-thread-2';

  // First turn
  for await (const _ of adapter.sendTurn({ threadId, text: 'Turn 1', cwd: '/tmp' } as any)) {}

  // Verify session state
  const session = (adapter as any).sessions.get(threadId);
  expect(session).toBeDefined();
  expect(session.hasStarted).toBe(true);
  expect(session.sessionId).toBe('stub-session-123');
  expect(session.queryRuntime).toBeNull(); // Phase 0: nulled on success path

  // Second turn
  for await (const _ of adapter.sendTurn({ threadId, text: 'Turn 2', cwd: '/tmp' } as any)) {}

  const secondCall = capturedCalls[capturedCalls.length - 1];
  expect(secondCall.options).toHaveProperty('resume', 'stub-session-123');
  expect(secondCall.options).not.toHaveProperty('sessionId');
});
