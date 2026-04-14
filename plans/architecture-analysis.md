# Stavi Architecture Analysis & Problems
_Written: 2026-04-12_

## What Stavi Is

A React Native mobile app that connects to a local server to run AI coding agents (Claude Code, Codex).
Forked from t3code's server patterns, inspired by lunel.

## Architecture Overview

```
Mobile (RN) ──WebSocket RPC──► Server (Bun/Node) ──subprocess──► Claude/Codex CLI
   useOrchestration.ts            server.ts                          claude.ts / codex.ts
   ConfigSheet.tsx                ProviderRegistry                   @anthropic-ai/claude-agent-sdk
```

### Data flow
1. Mobile sends `orchestration.dispatchCommand` with `thread.turn.start`
2. Server routes to the correct provider adapter (claude or codex)
3. Adapter streams events back via `ProviderEvent` generator
4. Server translates events → orchestration domain events and broadcasts to all subscribers
5. Mobile `useOrchestration` hook receives events → updates `AIMessage` state → renders

---

## Core Problems

### 1. BROKEN: Multi-turn Claude sessions (most likely root cause of "super bad AI")

In `packages/server-core/src/providers/claude.ts`, the `sendTurn()` generator:

```ts
// If no query running, start one
if (!session.queryRuntime) {
  const q = query({ prompt: promptIterable, options });
  session.queryRuntime = q;
}
// Push the user message
session.promptQueue.push(userMessage);

// Then iterate
for await (const message of session.queryRuntime) { ... }
```

**The bug**: After the first turn, when we hit `result`, we `return` from the generator.
On the next `sendTurn()`, `session.queryRuntime` is still set (not null), so we skip
creating a new query. We push to `promptQueue` and then do a second
`for await (const message of session.queryRuntime)` — but `session.queryRuntime` is
the *same* AsyncIterable we already exhausted. Most async iterables can only be
consumed once. This means **turn 2+ silently fails**.

**Fix options:**
- Option A (Simple): Make each turn start a fresh `query()` call (no persistent session).
  This loses conversation context but is simple and reliable. Claude agent SDK handles
  context via `sessionId` anyway.
- Option B (Correct): After each `result`, set `session.queryRuntime = null` so the
  next turn creates a fresh iterator from the same prompt queue. Test whether the SDK
  supports this pattern.
- Option C (Rebuild): Replace the PromptQueue approach entirely with per-turn
  subprocess invocations.

**Recommended**: Option B first, then fallback to Option C if SDK doesn't support it.

### 2. BROKEN: thread.created event never broadcast

When mobile calls `thread.create` command, the server creates the thread in-memory but
**never broadcasts `thread.created`**. The `processEventInner` in `useOrchestration.ts`
handles `thread.created` events but they never arrive. The `ensureActiveThread()` on
mobile manually adds the thread to state, but server subscriptions are never notified.

**Fix**: In `server.ts`, when `type === 'thread.create'`, broadcast:
```ts
broadcastOrchestrationEvent({ type: 'thread.created', payload: thread });
```

### 3. WRONG: Server always uses `thread-local` thread

In server.ts line 1010:
```ts
const threadId = String(command?.threadId || defaultThread.threadId);
```
This falls back to `thread-local` even when the mobile sends a real threadId.
Since mobile uses `ensureActiveThread()` which generates `thread-${Date.now()}-xxx`,
the server creates that thread but the provider may run on the wrong context.

Actually the threadId is passed correctly, so the session started in ClaudeAdapter
is keyed by the right threadId. But the `cwd` for the session is hardcoded to `'.'`
in `startSession(threadId, '.')` — not the project workspace root!

**Fix**: Pass `workspaceRoot` as `cwd` when calling `adapter.startSession()`.

### 4. MISSING: No project CWD for Claude sessions

In `server.ts` around the sendTurn call:
```ts
const stream = adapter.sendTurn({ threadId, text, modelSelection, interactionMode });
```
The `cwd` is never passed from `thread.worktreePath` to the adapter. Claude agent SDK
needs to know which directory to operate in.

**Fix**: Pass `cwd: thread.worktreePath ?? workspaceRoot` in `SendTurnInput`.

### 5. UI: ConfigSheet is a full-screen modal instead of a compact popover

t3code's model picker is a compact context menu (see screenshots) that slides up from
the composer chip. Our ConfigSheet uses a `Modal` with slide animation covering 70% of
screen, which is heavier and less polished.

The content is actually fine — providers, models, effort, thinking toggle all present.
The problem is presentation. Also: we don't show provider icons.

### 6. UI: No provider icons or "COMING SOON" state

t3code shows colored icons per provider and "COMING SOON" for unsupported ones.
Our ConfigSheet shows status dots (green/red) which is less visual.

---

## t3code vs Stavi Architecture Comparison

| Concern | t3code | Stavi |
|---------|--------|-------|
| Orchestration | Event-sourced, SQLite-backed, 47KB ProjectionPipeline | In-memory Maps, lost on restart |
| Provider routing | ProviderCommandReactor (28KB), effect-based | Simple if/else in server.ts |
| Streaming ingestion | ProviderRuntimeIngestion (42KB) | Inline in server.ts switch |
| Thread persistence | SQLite checkpointing | None |
| Multi-turn | Managed session with resume | Broken (see above) |
| Auth | JWT + session tokens | Bearer token, WS tokens |
| UI model picker | Compact popover menu | Full bottom sheet |

**Lesson**: t3code's sophistication is not needed for MVP. But we DO need the basics
to work: multi-turn conversations, correct CWD, proper event broadcasting.

---

## Priority Fix List

1. ~~**P0 - Fix multi-turn**~~ ✅ **FIXED** — Each `sendTurn()` now creates a fresh `query()` per turn, uses `sessionId`/`resume` for context continuity via the SDK. `session.queryRuntime` is reset after every turn.

2. ~~**P0 - Fix CWD**~~ ✅ **FIXED** — `server.ts:1153` passes `cwd: thread.worktreePath ?? workspaceRoot` to `adapter.sendTurn()`.

3. ~~**P1 - Broadcast thread.created**~~ ✅ **FIXED** — `server.ts:1074` now broadcasts `thread.created` after `thread.create` command.

4. **P1 - Fix streaming**: Verified working. `thread.message-sent` streaming events flow correctly. The streaming cursor shows while `streaming: true`. Minor gap: `tool-use-delta` events are broadcast from server but `activityPayloadToAIPart` in `useOrchestration.ts` doesn't handle them — partial tool input JSON silently dropped on mobile.

5. ~~**P2 - UI: Compact model picker**~~ ✅ **DONE** — `ModelPopover.tsx` replaces full-screen ConfigSheet with a contextual popover.

6. ~~**P2 - UI: Provider icons**~~ ✅ **DONE** — `ProviderIcon.tsx` added.

7. **P3 - Add OpenCode support**: Still planned. No adapter exists yet.

---

## Remaining Known Issues (as of 2026-04-13)

### `tool-use-delta` dropped on mobile
Server broadcasts `thread.activity-appended` with `type: 'tool-use-delta'` (partial JSON input). `activityPayloadToAIPart()` in `useOrchestration.ts` only handles `reasoning`, `tool-use`, `tool-result`. Delta events are silently ignored.

**Fix**: Add `tool-use-delta` case to `activityPayloadToAIPart` — merge partial input into the matching tool-call part by `toolId`.

### `permissionMode` gap
`approval-required` runtime mode maps to `permissionMode: undefined` in `claude.ts:336`. The SDK's default may not match the `canUseTool` callback approach exactly.

### `low` effort skips thinking
`effort: 'low'` maps to `thinkingBudgetMap['low'] = null` → `thinkingConfig` stays `undefined`. Low effort effectively disables thinking silently.

---

## What Actually Works Today

- WebSocket connection + auth (bearer token → WS token)
- Terminal sessions (Bun.spawn with PTY)
- Git operations (status, stage, commit, diff, log, branches)
- File system (search, read, write, list)
- Provider detection (claude binary probe, codex binary probe)
- Multi-turn Claude conversations (fixed — uses sessionId/resume)
- CWD passed correctly to Claude adapter
- Approval request flow (mobile → server → adapter → mobile round-trip)
- Event subscription model (orchestration domain events)
- Streaming text, reasoning, tool-use events
