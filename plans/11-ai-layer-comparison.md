# AI Layer Comparison: t3code vs Stavi

## Architecture Summary

### t3code (Reference Implementation)
- **Framework**: Effect-TS `Layer` system for DI + lifecycle management
- **Agent loop**: Fully delegated to Claude Agent SDK's `query()` — t3code does NOT run its own tool-dispatch loop
- **Streaming**: `Stream.fromAsyncIterable` → `Queue` → `PubSub` → multiple subscribers
- **State persistence**: `ProviderSessionDirectory` persists `resumeCursor`, `runtimePayload` to DB; sessions can recover from crashes
- **Event system**: 30+ canonical `ProviderRuntimeEvent` types, each with `eventId`, `provider`, `createdAt`, `threadId`, `turnId`, `itemId`
- **Approval system**: `Deferred<ProviderApprovalDecision>` — blocks SDK tool execution until resolved; auto-cancelled on session stop
- **Multi-provider**: `ProviderAdapterRegistry` → pluggable adapters (Claude, Codex), same orchestration
- **Session recovery**: `resumeCursor` persisted in DB → on reconnect, starts new SDK session with `resume: sessionId`

### Stavi (Our Implementation)
- **Framework**: Plain TypeScript classes + AsyncGenerators
- **Agent loop**: Also delegated to Claude Agent SDK `query()` — same pattern as t3code
- **Streaming**: `for await (const event of adapter.sendTurn())` — linear drain, single consumer
- **State persistence**: None for adapter sessions. Messages + threads in SQLite. On server restart, adapter sessions are lost.
- **Event system**: 10 event types (`text-delta`, `text-done`, `thinking-delta/done`, `tool-use-start/delta/done`, `approval-required`, `turn-complete`, `turn-error`)
- **Approval system**: `pendingApprovals: Map<requestId, {resolve, toolName, toolInput}>` — same deferred pattern but no auto-cancel on session stop
- **Multi-provider**: `ProviderRegistry` class → same pluggable pattern
- **Session recovery**: None. Server restart = all sessions lost. No resume cursor persisted.

---

## What Stavi Got Right

1. **Same core architecture**: Both delegate the agent loop to the underlying SDK. This is correct — don't reimplement what the SDK does.
2. **AsyncGenerator for streaming**: Clean, simple, works. t3code's Effect Stream pipeline is more complex but not functionally superior for a single-consumer use case.
3. **Approval deferred pattern**: Same approach as t3code — block tool execution with a Promise until user responds.
4. **Multi-provider abstraction**: `ProviderAdapter` interface is clean. Adding new providers (OpenCode, Ollama) follows the same shape.

---

## What's Broken or Missing

### Bug 1: Unexpected stream end treated as success (CRITICAL)
**File**: `packages/server-core/src/providers/claude.ts`, lines 568–574

```ts
// If we get here without a result, the stream ended unexpectedly
if (fullText) {
  yield textDone(input.threadId, fullText, turnId);
}
yield turnComplete(input.threadId, turnId);  // ← THIS IS WRONG
session.queryRuntime = null;
session.hasStarted = true;  // ← AND THIS
```

If the SDK stream ends without a `result` message (network drop, SDK crash, rate limit with no error event), stavi emits `turnComplete` as if the turn succeeded, AND sets `hasStarted = true`. The user sees a partial response as complete, and subsequent turns use `resume` on a potentially corrupted session.

**t3code's approach**: `handleStreamExit` checks `Exit.isFailure` → `completeTurn("failed")`. If success but turnState still active → `completeTurn("interrupted", "stream ended")`. The turn status DISTINGUISHES unexpected end from real completion.

**Fix**: 
```ts
// Stream ended without 'result' message — this is an error, not success
yield turnError(input.threadId, 'Stream ended unexpectedly without completion', turnId);
session.queryRuntime = null;
// DO NOT set hasStarted = true — the session may be corrupted
```

### Bug 2: `hasStarted` never reset on error (CRITICAL)
**File**: `claude.ts`, lines 539, 574

Once `hasStarted = true`, it stays true forever. If a turn errors or stream ends unexpectedly after the first successful turn, `hasStarted` remains true. On the next `sendTurn`, this means `queryOptions.resume = session.sessionId` is used — but the session may be in a bad state.

**t3code's approach**: t3code doesn't have a `hasStarted` flag at all. It tracks `resumeCursor` (includes `sessionId` + `lastAssistantUuid`) and only sets it after a confirmed successful turn via `updateResumeCursor()`. The resume cursor is a richer, more reliable indicator.

**Fix**: Reset `hasStarted = false` in the `catch` block and in the unexpected-end path. Or: replace the boolean with a proper `resumeSessionId` that's only set on `result` message.

### Bug 3: Pending approvals not cancelled on session stop / turn interrupt
**File**: `claude.ts` `interruptTurn()` — lines 614–624

```ts
interruptTurn(threadId: string): void {
  const session = this.sessions.get(threadId);
  if (!session) return;
  session.aborted = true;
  if (session.interruptFn) session.interruptFn();
  // Reject all pending approvals
  for (const [id, approval] of session.pendingApprovals) {
    approval.resolve({ behavior: 'deny' });
    session.pendingApprovals.delete(id);
  }
}
```

This clears approvals on `interruptTurn`, but there's no cleanup on:
- Session close / disconnect (client navigates away)
- Turn error (SDK crashes mid-tool)
- Server shutdown

**t3code's approach**: `stopSessionInternal` resolves ALL pending approvals as "cancel" and emits `request.resolved` for each. The `Effect.addFinalizer` on the session scope ensures this runs even on unexpected termination.

**Fix**: Add approval cleanup to wherever sessions are destroyed (which is currently... nowhere explicitly, since there's no `stopSession` method).

### Bug 4: `stopSession` exists but is never called (CLEANUP GAP)
`stopSession` IS implemented at line **669** of `claude.ts` — it sets `aborted=true`, calls `closeFn`, rejects pending approvals, and deletes from sessions map. However, it is never called when:
- Client disconnects from workspace
- User navigates away from AI
- Server is shutting down

Sessions accumulate in the `sessions` Map indefinitely.

**Fix**: Wire `stopSession()` calls to client disconnect events and server shutdown.

### Bug 5: Codex `turn/completed` with `status='error'` emits wrong event
**File**: `codex.ts` `handleNotification()`

When Codex sends `turn/completed` with `status: 'error'`, stavi emits `turnComplete` (success) instead of `turnError`. The user sees a "completed" turn that actually failed.

**t3code's Codex adapter**: Checks the status field and emits the appropriate event type.

**Fix**: Check `params.status` in the `turn/completed` notification handler.

### Bug 6: No resume cursor / session recovery (ARCHITECTURE GAP)
On server restart, all `ClaudeSession` and `CodexSession` objects are destroyed. If the user reconnects to the same workspace, they can view old messages (persisted in SQLite) but cannot continue the conversation — the next `sendTurn` will create a new session with no history context.

**t3code's approach**: `ProviderSessionDirectory` persists `resumeCursor` (session ID + last assistant UUID) in DB. On reconnect, `recoverSessionForThread` calls `adapter.startSession` with the cursor, resuming the SDK session from where it left off.

**Fix (future)**: Persist `session.sessionId` and last assistant UUID to SQLite after each successful turn. On reconnect, use `resume` option in `query()`. This is the biggest missing feature but not a bug — it's a feature gap.

### Bug 7: `textDone` emitted twice for Claude
**File**: `claude.ts`, lines 489–493 (message_stop handler) and 530–532 (result handler)

Both emit `textDone`. The client receives two `text-done` events. Currently harmless because the orchestration handler ignores `text-done`, but it's incorrect and will cause issues if any consumer relies on it as a terminal event.

**Fix**: Only emit `textDone` in one place — the `result` handler is the authoritative one.

### Bug 8: Codex `interruptTurn` race with drain loop
**File**: `codex.ts`

`interruptTurn()` sends `turn/interrupt` RPC, sets `status='ready'` and `activeTurnId=null`. But the drain loop in `sendTurn` is still `await`ing the next event. If `turn/aborted` notification never arrives (Codex bug or process stall), the loop hangs for 30 seconds.

**Fix**: After sending `turn/interrupt`, also push a synthetic `turnError('interrupted')` into the event buffer to wake the drain loop.

### Bug 9: `(message as any)` type assertions (8 occurrences)
**File**: `claude.ts` — lines 429, 498, 526, 527, 536, 537, 547, 548

8 casts (not 20+ as originally claimed). The SDK types aren't properly imported/used.

**Fix**: Import and use the proper SDK message types. If the SDK doesn't export them, create adapter types that match the actual shape.

---

## Feature Comparison

| Feature | t3code | Stavi | Gap |
|---------|--------|-------|-----|
| Agent loop delegation | ✅ SDK-driven | ✅ SDK-driven | None |
| Event taxonomy | 30+ types, rich metadata | 10 types, minimal | Missing: task progress, hook events, file persistence, rate limits |
| Session recovery | ✅ Resume cursor in DB | ❌ Lost on restart | Major |
| Session cleanup | ✅ stopSessionInternal | ❌ None | Major |
| Approval auto-cancel | ✅ On session stop | ❌ Only on interrupt | Moderate |
| Turn status distinction | ✅ completed/failed/interrupted/cancelled | ❌ Only complete/error | Moderate |
| Event logging (NDJSON) | ✅ Optional trace logs | ❌ None | Minor (debugging aid) |
| Rollback (undo turns) | ✅ rollbackThread | ❌ None | Nice to have |
| Multi-consumer streams | ✅ PubSub fan-out | ❌ Single consumer | Minor |
| Type safety | ✅ Effect types + SDK types | ❌ `(message as any)` everywhere | Moderate |
| User input (AskUserQuestion) | ✅ Full flow with deferred | ❌ Not implemented | Moderate |
| Plan mode (ExitPlanMode) | ✅ Captures plan, denies tool | ❌ Not implemented | Nice to have |
| TodoWrite interception | ✅ Emits plan updates | ❌ Not implemented | Nice to have |
| Effort/thinking controls | ✅ Passed to SDK | ✅ Passed to SDK | None |

---

## Priority Fixes

### Immediate (these are bugs causing incorrect behavior):
1. **Unexpected stream end → emit turnError, not turnComplete** (lines 568-574)
2. **Don't set `hasStarted=true` on error/unexpected end** (lines 539, 574)
3. **Codex `turn/completed` with `status='error'` → emit turnError** (codex.ts)
4. **Remove duplicate `textDone` emission** (lines 489-493 vs 530-532)
5. **Add approval cleanup to session destruction**

### Near-term (architecture gaps — server must be the brain):
6. **Persist resume cursor to SQLite** — after each successful turn, save `session.sessionId` + last assistant UUID to the `threads` table (add `resume_cursor` column). On server restart, `recoverSessionForThread` resumes the SDK session. This is how t3code does it via `ProviderSessionDirectory`. Without this, server restart = AI can show old messages but can't continue the conversation.
7. **Add `stopSession()` method** to both adapters — clean up SDK resources, cancel approvals, emit exit events
8. **Wake Codex drain loop on interrupt** (synthetic event push)

**Server persistence status (verified)**:
- ✅ Messages: written to SQLite on every append, coalesced writes for streaming updates (50ms batch)
- ✅ Threads: written immediately to SQLite
- ✅ Sessions (workspaces): written to SQLite
- ✅ Boot rehydration: `createServerContext()` loads all threads + messages from DB into memory Maps
- ❌ AI adapter sessions: in-memory only — `session.sessionId` in Claude, `providerThreadId` in Codex — NOT persisted. Server restart = can view old messages, can't continue conversation.

**Key principle**: The server is the single source of truth. The mobile app is a dumb display. The app's `sessions-store` persist is a cache for instant display on reconnect — the server is always authoritative. On reconnect, the app syncs from the server and shows exactly where the user left off.

### Future (feature gaps vs t3code):
10. Implement `AskUserQuestion` flow (user input deferred)
11. Implement `ExitPlanMode` / plan mode
12. Add NDJSON event tracing for debugging
13. Type the SDK message types properly
14. Add rollback (undo turns) support
15. Rich event taxonomy (task progress, hooks, rate limits)
