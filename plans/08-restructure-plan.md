# Phase 8 — Restructure Plan

Authored by: Opus 4 (lead architect)
Grounded in: `plans/00-master-plan.md`, all Phase 0–7 outputs, competitive research from Litter (Codex multi-turn) and Lunel (RN shell patterns).
Executor: Sonnet 4.6, one sub-phase at a time.

## Executive Summary

Stavi shipped Phases 0–7 with a **server-centric, bottom-tab** shell layout. The resulting architecture is structurally wrong for the product vision: AI Chat is the primary surface but it's buried as one of six equal tabs; the home screen groups sessions by server when users think in terms of recent workspaces; `agentRuntime` is locked per-session when it should be per-chat. This plan restructures the app across 7 sub-phases without changing the server storage schema (column renames and new columns OK, table reshapes NOT OK).

### What's broken (in priority order)

1. **AI Chat flow is broken** — multi-turn conversations fail silently. The Codex adapter has a race condition where `turn/completed` fires during `await sendRequest('turn/start')`, setting `session.status = 'ready'` before the drain loop begins. Claude adapter appears structurally correct but may have regressed during Phase 7a splits.
2. **Agent runtime locked per-session** — `Session.agentRuntime` forces choosing Claude or Codex at workspace creation. Should be per-chat.
3. **Home screen is server-grouped** — `SessionsHomeScreen` renders `SessionsHomeServerSection` cards. Users want a flat recent-workspaces list.
4. **Workspace shell is bottom-tab** — six equal icons (AI, Editor, Terminal, Git, Explorer, Browser). AI should be the persistent center, tools in a sidebar.
5. **No way to start a new chat** — AI plugin panel shows a single thread. No visible "New Chat" affordance.
6. **Terminology is wrong** — "Session" should be "Workspace", "Thread" should be "Chat".

### What works (preserve these)

1. Multi-server connection, relay transport, Noise NK
2. Plugin registry and per-session tab state
3. Design tokens from Phase 7b (indigo accent, Inter font, dark theme)
4. Explorer with batch ops, system search
5. StateViews, telemetry, toast infrastructure

---

## Terminology Decision

> **Thread → Chat** (not "Conversation")

Rationale: "Chat" is 4 letters, fits in tab labels, matches the Cursor/Claude Code mental model ("start a new chat"). "Conversation" is 12 letters, doesn't fit in a tab chip, and implies something more formal than a coding turn. The wire protocol keeps `thread.*` RPC tags — only the UI layer renames.

> **Session → Workspace**

The server column stays `sessions`. The mobile UI says "Workspace" everywhere. The `Session` TypeScript interface on mobile gets a type alias `Workspace = Session` during the transition, then the alias becomes the primary type.

> **agentRuntime moves from Session to Thread (Chat)**

`sessions.agent_runtime` stays in the SQLite column but becomes optional (`DEFAULT 'claude'`). New threads get an `agent_runtime` column on the `threads` table. The mobile `NewSessionFlow` drops the agent picker entirely — agent is chosen per-chat via a model/provider popover in the chat composer.

---

## Phase Structure

| Phase | Name | Scope | Est. Hours |
|-------|------|-------|------------|
| 8a | Stop the Bleeding | Fix AI orchestration (Codex race, Claude regression check) | 2–3 |
| 8b | Terminology Rename | Session→Workspace, Thread→Chat in all UI strings and types | 2 |
| 8c | Agent Per-Chat | Move agentRuntime from Session to Thread, update NewSessionFlow | 2–3 |
| 8d | Home Screen Flat | Replace server-sectioned home with flat recent-Workspaces list | 2–3 |
| 8e | Workspace Sidebar | Replace bottom tabs + drawer with persistent sidebar shell | 3 |
| 8f | Chat-First Layout | AI Chat as default/persistent pane, "New Chat" affordance | 2 |
| 8g | Polish & Verify | End-to-end smoke tests, doc updates, followup close-out | 1–2 |

Each phase is independently shippable. Later phases may reference work from earlier ones but never require unreleased earlier-phase code (i.e., 8d can ship before 8c if needed, but the natural order is preferred).

---

## Phase 8a — Stop the Bleeding

### Goal

Fix multi-turn AI chat so both Claude and Codex can sustain a conversation. This phase touches ONLY the provider adapters and the orchestration subscription path. No UI changes, no renames.

### Root Cause Analysis

#### Codex: Race condition in `sendTurn` (CONFIRMED)

**File:** `packages/server-core/src/providers/codex.ts`, lines 334–415

The `sendTurn` method has a textbook async race:

```
1. session.status = 'running'          (line 351)
2. session.eventBuffer = []            (line 352)
3. await sendRequest('turn/start')     (line 368) — BLOCKS on JSON-RPC response
4. while (session.status === 'running') { drain events }   (line 379)
```

Between steps 3 and 4, the `handleNotification` method (called from the stdout readline handler, which runs on the Node event loop during the `await`) processes `turn/completed` and sets `session.status = 'ready'` (line 607). When step 4 finally executes, the while-loop condition is false — the loop never runs and all buffered events (including the assistant's response) are silently dropped.

**Evidence from Litter:** `/Users/sunny/claude-code-remote/litter/shared/rust-bridge/codex-mobile-client/src/mobile_client/store_listener.rs` — Litter's `maybe_send_next_local_queued_follow_up()` fires AFTER `TurnCompleted` is fully processed. Event processing is completely decoupled from the turn-start call via async channels. The turn/start response and turn/completed notification are handled by separate listeners.

**Fix:** Decouple the drain loop from `session.status`. The loop should drain until it sees a `turn-complete` or `turn-error` event in the buffer, regardless of what `session.status` says. The status field becomes informational only, not a loop-control variable.

#### Claude: Likely correct, verify only

**File:** `packages/server-core/src/providers/claude.ts`, lines 369–602

Claude's `sendTurn` uses `for await (const message of session.queryRuntime)` — a pull-based async iterator that cannot race with notifications because there's only one consumer. The `hasStarted` / `resume` / `sessionId` logic is correct (verified in Phase 0 analysis). `queryRuntime` is nulled on all three exit paths (result at 540, abort at 562, error at 600).

**Risk:** Phase 7a split `context.ts` into four files and extracted `orchestration-helpers.ts`. If the event dispatch path was broken during the split, Claude messages could be emitted but never delivered to the mobile subscriber. This phase adds a targeted integration test.

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| MODIFIED | `packages/server-core/src/providers/codex.ts` | Rewrite `sendTurn` drain loop (lines 379–403). Replace `while (session.status === 'running')` with `while (true)` loop that breaks on `turn-complete`/`turn-error` event. Add `drainComplete` boolean flag. |
| MODIFIED | `packages/server-core/src/providers/codex.ts` | In `handleNotification` `turn/completed` case (lines 602–609): do NOT set `session.status = 'ready'` here. Instead, only emit the `turnComplete` event. Let the drain loop set status to `ready` after it yields the event. |
| NEW | `packages/server-core/test/codex-drain.test.ts` | Unit test: mock a `CodexSession` with pre-buffered events including a `turnComplete` at the end. Verify `sendTurn` yields all events in order. |
| NEW | `packages/server-core/test/codex-race.test.ts` | Race test: start `sendTurn`, have the mock process emit `turn/completed` BEFORE the `turn/start` response. Verify all events are still yielded. |
| MODIFIED | `packages/server-core/src/providers/codex.ts` | Harden `emitEvent`: if `eventResolve` is non-null, call it immediately (wake the drain loop) — this already works but add a comment. |
| NEW | `packages/server-core/test/claude-e2e.test.ts` | Integration test: create a mock orchestration context, subscribe, dispatch a Claude turn, verify events arrive at the subscriber. Uses stub SDK. Purpose: verify Phase 7a splits didn't break the dispatch chain. |

### Ordered steps

1. **Read the full `codex.ts` sendTurn + handleNotification + emitEvent.** Confirm the race condition matches the diagnosis above.
2. **Rewrite `sendTurn` drain loop.** Replace:
   ```typescript
   while (session.status === 'running') {
     if (session.eventBuffer.length > 0) {
       const event = session.eventBuffer.shift()!;
       yield event;
       if (event.type === 'turn-complete' || event.type === 'turn-error') {
         session.status = 'ready';
         break;
       }
     } else {
       await new Promise<void>((resolve) => { ... });
     }
   }
   ```
   With:
   ```typescript
   let drainDone = false;
   while (!drainDone) {
     if (session.eventBuffer.length > 0) {
       const event = session.eventBuffer.shift()!;
       yield event;
       if (event.type === 'turn-complete' || event.type === 'turn-error') {
         session.status = 'ready';
         session.activeTurnId = null;
         drainDone = true;
       }
     } else {
       await new Promise<void>((resolve) => {
         session!.eventResolve = () => {
           session!.eventResolve = null;
           resolve();
         };
         setTimeout(() => {
           if (session!.eventResolve) {
             session!.eventResolve = undefined as any;
             resolve();
           }
         }, 30_000);
       });
     }
   }
   ```
3. **Fix `handleNotification` `turn/completed`:** Remove `session.status = 'ready'` and `session.activeTurnId = null` from the `turn/completed` case. The drain loop now owns the status transition. Keep the `emitEvent(session, turnComplete(...))` call — that's what the drain loop watches for.
4. **Fix `handleNotification` `turn/aborted`:** Same treatment — don't set status here, let the drain loop handle it after yielding the `turnError`.
5. **Write `codex-drain.test.ts`:** Pre-buffer `[textDelta, textDelta, toolUseStart, toolUseDone, turnComplete]` into a session. Call the drain logic. Assert all 5 events are yielded in order and `session.status` ends as `'ready'`.
6. **Write `codex-race.test.ts`:** Simulate the race: mock `sendRequest` to resolve after a 10ms delay, but have `handleNotification('turn/completed')` fire at 5ms. Assert all events are still yielded.
7. **Write `claude-e2e.test.ts`:** Verify the full dispatch chain from `orchestration.ts` → `claude.ts` → subscriber. Stub the SDK's `query()` to yield `[stream_event(text_delta), result]`. Verify the subscriber receives `text-delta` and `turn-complete` events.
8. **Run all tests.** Fix any failures.

### Contracts

**Codex `sendTurn` post-conditions:**
- Every event emitted via `emitEvent` between turn start and turn completion is yielded by the generator
- `session.status` transitions to `'ready'` only AFTER the `turnComplete`/`turnError` event is yielded
- The generator terminates after yielding the terminal event
- The 30-second safety timeout still works (prevents infinite hang if Codex subprocess dies without sending turn/completed)

**Claude dispatch chain post-condition:**
- A `text-delta` event emitted by `claude.ts` via `yield textDelta(...)` reaches the mobile subscriber's `processEventInner` reducer within the same subscription scope

### Edges and gotchas

- **Do NOT change the wire protocol.** The Codex fix is purely internal to the adapter. The `ProviderEvent` types stay the same.
- **The `session.status` field is still useful** — `sendTurn` checks `session.status !== 'ready'` at entry (line 343) to reject concurrent turns. Keep that guard. The change is: only the drain loop sets status to `'ready'`, never `handleNotification`.
- **The `turn/started` notification** (line 597) still sets `session.status = 'running'` — this is fine because it fires before the drain loop starts (during the `sendRequest` await), and the drain loop doesn't check status anymore.
- **`session/ready`** notification (line 682) still sets `session.status = 'ready'` — only fires during initialization, not mid-turn. Leave it.

### Verification script

```
Phase 8a verification (target: 10 minutes)

Prereq:
- Server running: cd packages/server-core && bun src/server.ts
- Mobile app connected to server

1. Codex multi-turn
   - Create a new workspace (Codex runtime)
   - Open AI tab, send: "create a file called test.txt with the content 'hello'"
   - Wait for response + tool execution
   - Send: "now read test.txt and tell me what's in it"
   - PASS: response mentions "hello". FAIL: no response, hang, or error.

2. Codex rapid-fire
   - Send 3 messages in quick succession (don't wait for responses)
   - PASS: all 3 get responses (may queue). FAIL: hang after first.

3. Claude multi-turn
   - Create a new workspace (Claude runtime)
   - Send: "remember: my favorite color is indigo"
   - Send: "what is my favorite color?"
   - PASS: response mentions indigo. FAIL: no memory of first message.

4. Claude tool use
   - Send: "list the files in the current directory"
   - PASS: response shows file listing. FAIL: error or no tool execution.

5. Reconnect resilience
   - Kill the server mid-conversation. Restart.
   - Reconnect from mobile.
   - Send a new message.
   - PASS: new turn works. FAIL: stuck in 'running' state.
```

---

## Phase 8b — Terminology Rename

### Goal

Rename all user-facing strings: Session → Workspace, Thread → Chat. Update TypeScript type aliases on the mobile side. Do NOT rename server-side database columns or RPC tags.

### Strategy

- **Server side:** No changes. The wire protocol keeps `session.*` and `thread.*` RPC tags. The SQLite schema keeps `sessions` and `threads` tables. Types stay as-is.
- **Mobile side:** Create type alias `export type Workspace = Session;` in a new `types/workspace.ts` file. New code uses `Workspace`. Existing code is updated file-by-file. The `Thread` interface in `useOrchestration.ts` gets a parallel `export type Chat = Thread;` alias.
- **UI strings:** Every user-visible string containing "session" becomes "workspace". Every "thread" becomes "chat". Component names stay (e.g., `SessionsHomeScreen` keeps its name in this phase — renamed in 8d).

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| NEW | `apps/mobile/src/types/workspace.ts` | `export type { Session as Workspace } from '@stavi/shared'; export type { Thread as Chat } from '../plugins/workspace/ai/useOrchestration';` |
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | All user-facing strings: "Sessions" → "Workspaces", section headers, empty states. |
| MODIFIED | `apps/mobile/src/components/SessionsHomeServerSection.tsx` | Card labels: "session" → "workspace" |
| MODIFIED | `apps/mobile/src/components/NewSessionFlow.tsx` | Title: "New Session" → "New Workspace", step labels updated |
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Error messages: "Session not found" → "Workspace not found", "Session archived" → "Workspace archived" |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` | "Thread" → "Chat" in all user-visible text, dropdown labels, empty states |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/useOrchestration.ts` | Add `export type Chat = Thread;` alias. No logic changes. |
| MODIFIED | `apps/mobile/src/components/DrawerContent.tsx` | Menu items referencing "sessions" → "workspaces" |
| MODIFIED | `apps/mobile/src/services/telemetry.ts` | Event names: `session.opened` stays (machine-readable), but add comment noting UI says "workspace" |
| MODIFIED | `docs/MENTAL-MODEL.md` | Update terminology table and ASCII diagram |

### Ordered steps

1. Create `apps/mobile/src/types/workspace.ts` with the type aliases.
2. Sweep all `.tsx` files under `apps/mobile/src/` for user-visible strings containing "session" or "thread" (case-insensitive). Replace with "workspace" or "chat" respectively. Do NOT rename: import paths, variable names, RPC tag strings, store names, or navigation route names.
3. Update `docs/MENTAL-MODEL.md` terminology table.
4. Run `tsc --noEmit` to verify no type breakage.

### Edges and gotchas

- **Navigation route `'SessionsHome'` stays** — route names are internal, not user-visible. Renamed in Phase 8d.
- **Telemetry event names stay machine-readable** — `session.opened`, `session.created` etc. remain. Adding a UI-label/machine-name distinction is out of scope.
- **The type alias is one-way initially** — new code imports `Workspace`, old code still uses `Session`. Both work because they're the same type. Full migration happens organically as files are touched in later phases.

### Verification script

```
Phase 8b verification (target: 5 minutes)

1. Grep audit
   - rg -i "session" apps/mobile/src/ --type tsx | grep -v import | grep -v route | grep -v store | grep -v sessionId
   - PASS: No user-visible strings say "session". FAIL: missed strings.

2. Grep audit (threads)
   - rg -i "thread" apps/mobile/src/ --type tsx | grep -v import | grep -v threadId | grep -v activeThread
   - PASS: No user-visible strings say "thread". FAIL: missed strings.

3. Visual check
   - Open app, navigate to home screen
   - PASS: header/cards say "Workspaces", not "Sessions"
   - Open a workspace, open AI tab
   - PASS: any thread-related UI says "Chat"

4. Type check: tsc --noEmit passes
```

---

## Phase 8c — Agent Per-Chat

### Goal

Move `agentRuntime` from the Session (Workspace) level to the Thread (Chat) level. Each chat can independently use Claude or Codex. The `NewSessionFlow` drops the agent picker. A model/provider selector appears in the AI chat composer.

### Server-side changes (minimal, schema-safe)

The constraint is: do NOT reshape the schema. Allowed: new columns, column defaults, CHECK constraint changes.

**Migration `0002_agent_per_thread.sql`:**
```sql
-- Make session-level agent_runtime optional (default to 'claude' for legacy)
-- SQLite doesn't support ALTER COLUMN, so we change the CHECK via a new migration approach:
-- Actually, SQLite CHECK constraints are table-level and can't be altered.
-- Instead: the column stays as-is, but server code treats it as a DEFAULT/fallback.
-- New column on threads:
ALTER TABLE threads ADD COLUMN agent_runtime TEXT DEFAULT NULL;
-- When agent_runtime is NULL on a thread, fall back to the session's agent_runtime.
```

**Server handler changes:**
- `thread.create` command accepts optional `agentRuntime` field. If provided, written to `threads.agent_runtime`. If not, NULL (falls back to session's value).
- `thread.turn.start` reads `agentRuntime` from the thread row first, falls back to session row.
- `session.create` RPC: `agentRuntime` becomes optional, defaults to `'claude'`.

### Mobile-side changes

- `NewSessionFlow` Step 3: remove the agent runtime picker chips entirely. The title input remains. The `agentRuntime` param sent to `session.create` defaults to `'claude'`.
- AI plugin composer: add a provider/model selector button (already partially exists as `ModelPopover`). The popover should allow switching between Claude and Codex providers. When a new chat is started, the selected provider determines the `agentRuntime` sent in `thread.create`.
- The `Thread` type gains `agentRuntime?: 'claude' | 'codex'`.

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| NEW | `packages/server-core/src/db/migrations/0002_agent_per_thread.sql` | `ALTER TABLE threads ADD COLUMN agent_runtime TEXT DEFAULT NULL;` |
| MODIFIED | `packages/server-core/src/db/index.ts` (or migration runner) | Register migration 0002 |
| MODIFIED | `packages/server-core/src/server.ts` (or orchestration handler) | `thread.create`: accept `agentRuntime`, write to threads table. `thread.turn.start`: read thread's `agent_runtime`, fall back to session's. |
| MODIFIED | `packages/server-core/src/types.ts` | `Session.agentRuntime` stays but is marked as legacy fallback in comment. Add `agentRuntime?: AgentRuntime` to the thread type passed in events. |
| MODIFIED | `apps/mobile/src/components/NewSessionFlow.tsx` | Remove Step 3 agent picker. `agentRuntime` defaults to `'claude'`. Step 3 is now just title input + create button. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/useOrchestration.ts` | `Thread` type: add `agentRuntime?: 'claude' \| 'codex'`. `ensureActiveThread`: pass selected provider's runtime. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` | Provider selector in composer area. Reads available providers from server config. Selected provider stored in local state, passed to `ensureActiveThread`. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/hooks/useOrchestrationActions.ts` | `sendMessage`: include `agentRuntime` in `thread.create` command if a non-default provider is selected. |
| MODIFIED | `packages/shared/src/types.ts` (or wherever `Session` is defined for shared) | `agentRuntime` becomes optional: `agentRuntime?: AgentRuntime` |

### Ordered steps

1. Write migration `0002_agent_per_thread.sql`.
2. Update migration runner to apply it.
3. Modify `thread.create` handler to accept and store `agentRuntime`.
4. Modify turn-start handler to read thread's `agent_runtime` first, fall back to session's.
5. On mobile, remove agent picker from `NewSessionFlow` Step 3.
6. Add provider selector to AI composer (reuse/extend `ModelPopover`).
7. Wire selected provider through `ensureActiveThread` → `thread.create` command.
8. Update shared `Session` type to make `agentRuntime` optional.
9. Test: create workspace, open AI, switch provider in composer, send message. Verify correct provider handles the turn.

### Edges and gotchas

- **Existing sessions with `agent_runtime = 'codex'`** continue to work — threads without an explicit `agent_runtime` fall back to the session's value.
- **The `NewSessionFlow` becomes 2 effective steps** (pick server → pick folder + title). The 3-step UI can remain but Step 3 is simpler. Alternatively, merge steps 2+3 into a single screen. Decision: keep 3 steps for now, simplify in Phase 8g if warranted.
- **Provider availability depends on server config.** The composer should only show providers that are `installed && authenticated` per the server's `getConfig` response. If only one provider is available, hide the selector.
- **Model list per provider:** Already fetched by `useOrchestration` via `serverConfigRef`. The `ModelPopover` already reads this. Wire the provider switch to re-filter models.

### Verification script

```
Phase 8c verification (target: 10 minutes)

1. New workspace flow
   - Create a new workspace
   - PASS: No agent picker in creation flow. Workspace created as claude by default.

2. Per-chat provider switch
   - Open workspace, open AI tab
   - Start a chat (should default to Claude)
   - Send a message → PASS: Claude responds
   - Start a NEW chat
   - Switch provider to Codex in composer
   - Send a message → PASS: Codex responds

3. Provider persistence per chat
   - Switch between two chats
   - PASS: each chat remembers its provider selection

4. Legacy workspace compat
   - Open a pre-existing workspace that was created with agentRuntime='codex'
   - Start a new chat WITHOUT selecting a provider
   - PASS: falls back to codex (session-level default)
```

---

## Phase 8d — Home Screen: Flat Recent Workspaces

### Goal

Replace the server-grouped `SessionsHomeScreen` with a flat, chronologically-sorted list of recent workspaces. Servers become a secondary surface accessible via a "Servers" button.

### Design

**Pattern source:** Litter's `HomeDashboardView.swift` (`/Users/sunny/claude-code-remote/litter/apps/ios/Sources/Litter/Views/HomeDashboardView.swift`) — shows recent session cards sorted by `updatedAt` desc, with connected server tiles as a secondary section.

**Layout:**
```
┌────────────────────────────────┐
│  stavi            [Servers] [+] │
├────────────────────────────────┤
│  Search workspaces...          │
├────────────────────────────────┤
│  ┌──────────────────────────┐  │
│  │ my-app                   │  │
│  │ ~/projects/my-app        │  │
│  │ dev-machine · 3 min ago  │  │
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │ stavi                    │  │
│  │ ~/code/stavi             │  │
│  │ macbook · 1 hour ago     │  │
│  └──────────────────────────┘  │
│  ...                           │
└────────────────────────────────┘
```

Each card shows: workspace title, folder path, server name + relative time. Tap → navigate to WorkspaceScreen. Long-press → action sheet (archive, delete).

**Servers surface:** A "Servers" button in the header opens a modal/sheet listing saved servers with status dots, connect/disconnect, add server. This replaces the current server sections.

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | Complete rewrite of the render tree. Replace `ScrollView` + `SessionsHomeServerSection` map with `FlatList` of workspace cards sorted by `lastActiveAt` desc. Add search filter. Move server management to a sheet. |
| MODIFIED | `apps/mobile/src/components/SessionsHomeServerSection.tsx` | Repurpose or delete. The flat list doesn't need server sections. If kept, it becomes the server-management sheet's inner list. |
| NEW | `apps/mobile/src/components/WorkspaceCard.tsx` | Card component for a single workspace in the flat list. Shows title, folder, server name, relative time, status dot. |
| NEW | `apps/mobile/src/components/ServersSheet.tsx` | Bottom sheet listing all saved servers. Status dots, connect/disconnect, add/forget. Absorbs the connection menu logic currently in `SessionsHomeScreen`. |
| MODIFIED | `apps/mobile/src/stores/sessions-store.ts` | Add `getAllWorkspaces(): Workspace[]` selector that flattens `sessionsByServer` into a single list sorted by `lastActiveAt` desc. |
| MODIFIED | `apps/mobile/src/components/NewSessionFlow.tsx` | Update empty-state text to match new terminology. |

### Ordered steps

1. Add `getAllWorkspaces()` to `sessions-store.ts`: flatten all `sessionsByServer` values into one array, sort by `lastActiveAt` desc.
2. Create `WorkspaceCard.tsx`: simple Pressable card with title, folder (truncated), server name, relative time. Uses design tokens.
3. Create `ServersSheet.tsx`: Modal or bottom sheet with a FlatList of saved servers. Each row: name, status dot, connect/disconnect button, menu (forget). "Add Server" button at bottom.
4. Rewrite `SessionsHomeScreen.tsx`:
   - Header: "stavi" title, [Servers] button (opens `ServersSheet`), [+] button (opens `NewSessionFlow`).
   - Body: `FlatList` with `getAllWorkspaces()` data, rendered via `WorkspaceCard`.
   - Search: `TextInput` at top filters workspaces by title and folder.
   - Empty state: "No workspaces yet. Create one to get started."
   - `RefreshControl` pulls-to-refresh all connected servers.
5. Remove or repurpose `SessionsHomeServerSection.tsx`.
6. Keep the `ReconnectToast` at the top.
7. Update `NewSessionFlow` to open from the [+] button.

### Edges and gotchas

- **Multiple servers with same workspace folder:** The card shows the server name to disambiguate. The list is purely chronological, not grouped.
- **Disconnected servers' workspaces:** Show them with a dimmed style and "(offline)" badge. Don't hide them — users want to see their recent work even if a server is temporarily offline.
- **Search is client-side only:** Filter the already-loaded `getAllWorkspaces()` array. No server RPC needed.
- **The `Settings` button** (gear icon) currently lives in the header. Keep it — it navigates to the existing `SettingsScreen`.
- **Navigation route name stays `'SessionsHome'`** to avoid breaking deep links. Can be renamed later.

### Verification script

```
Phase 8d verification (target: 5 minutes)

1. Flat list
   - Open app with 2+ servers connected, each with workspaces
   - PASS: all workspaces appear in one flat list sorted by recency
   - FAIL: grouped by server

2. Server management
   - Tap "Servers" button
   - PASS: sheet shows all saved servers with status dots
   - PASS: can connect/disconnect from the sheet

3. Search
   - Type a workspace name in the search bar
   - PASS: list filters to matching workspaces

4. Empty state
   - Disconnect all servers, or use a fresh install
   - PASS: shows "No workspaces yet" empty state

5. Offline workspaces
   - Disconnect one server
   - PASS: its workspaces still show in the list, dimmed/labeled as offline
```

---

## Phase 8e — Workspace Sidebar Shell

### Goal

Replace the bottom-tab + left-drawer layout with a persistent sidebar that lists tools and active chats. The main content area shows the active plugin panel.

### Design

**Pattern source:** Lunel's workspace layout (`/Users/sunny/claude-code-remote/lunel/app/app/workspace/_layout.tsx`) — uses React Navigation Drawer with `drawerType: "slide"` and the sidebar content from `/Users/sunny/claude-code-remote/lunel/app/components/DrawerContent.tsx`.

**Also informed by:** T3 Code's persistent sidebar (from user's vision screenshots) — vertical icon rail + expandable panel.

**Layout (landscape-capable, portrait-primary):**
```
┌───┬──────────────────────────────┐
│   │  Chat: my-app AI             │
│ A │  ┌────────────────────────┐  │
│ I │  │ assistant message...    │  │
│   │  │ ...                    │  │
│ ─ │  │                        │  │
│ T │  └────────────────────────┘  │
│ E │                              │
│ R │  ┌────────────────────────┐  │
│ M │  │ > Type a message...    │  │
│   │  └────────────────────────┘  │
│ ─ │                              │
│ G │                              │
│ I │                              │
│ T │                              │
│   │                              │
│ ─ │                              │
│ ☰ │                              │
└───┴──────────────────────────────┘
```

On mobile (portrait): sidebar is a narrow icon rail (~52px) that can be swiped or tapped to expand to a full sidebar (~260px) showing tool labels + active chat list. Tapping an icon while collapsed navigates to that tool. The sidebar never fully hides — the icon rail is always visible.

**Sidebar sections:**
1. **Tools** (icon rail): AI (chat bubble), Terminal, Editor, Explorer, Git, Browser
2. **Active chats** (expanded only): list of open chats for this workspace, with "New Chat" button
3. **Bottom**: Home button (navigate to SessionsHome), Settings

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Replace drawer + bottom bar + scrim with new sidebar shell layout. Remove `Animated.View` drawer animation. Replace with flex-row: sidebar + content area. |
| DELETED | `apps/mobile/src/components/PluginBottomBar.tsx` | Bottom bar is replaced by sidebar. |
| MODIFIED | `apps/mobile/src/components/PluginHeader.tsx` | Simplify: remove hamburger menu button (no drawer). Keep title + action buttons. |
| MODIFIED | `apps/mobile/src/components/DrawerContent.tsx` | Repurpose as sidebar content. Remove navigation links (Home/Settings move to sidebar bottom). Add active-chats list section. |
| NEW | `apps/mobile/src/components/WorkspaceSidebar.tsx` | New component: icon rail (collapsed) + full sidebar (expanded). Manages collapsed/expanded state. Renders tool icons, active chats, Home/Settings buttons. |
| MODIFIED | `apps/mobile/src/stores/plugin-registry.ts` | No structural changes, but the tab activation API stays the same — sidebar calls `setActiveTab(sessionId, tabId)` just like the bottom bar did. |
| MODIFIED | `apps/mobile/src/components/PluginRenderer.tsx` | No changes needed — it already renders the active plugin panel based on `activeTabId`. The sidebar just changes which tab is active. |

### Ordered steps

1. Create `WorkspaceSidebar.tsx`:
   - Collapsed state: 52px wide icon rail with tool icons stacked vertically.
   - Expanded state: 260px wide panel with icons + labels + active chats list.
   - Toggle: tap the sidebar edge or swipe right to expand, tap outside or swipe left to collapse.
   - Tool icons: map `definitions` from plugin registry, render icon + optional badge.
   - Active chats: read from `useOrchestration` threads list for this session. Each shows title, truncated last message. Tap → switch to that chat's AI tab.
   - Bottom: Home icon (→ `SessionsHome`), Settings icon (→ `Settings`).
2. Rewrite `WorkspaceScreen.tsx` layout:
   - Remove all drawer animation code (`drawerAnim`, `openDrawer`, `closeDrawer`, scrim, `Animated.View`).
   - Remove `PluginBottomBar` import and render.
   - New layout: `<View style={{ flexDirection: 'row', flex: 1 }}>` containing `<WorkspaceSidebar>` and `<View style={{ flex: 1 }}>` (content area with `PluginHeader` + `PluginRenderer`).
3. Simplify `PluginHeader.tsx`: remove hamburger/drawer trigger. The header shows the active plugin name + any plugin-specific actions.
4. Delete `PluginBottomBar.tsx` (or mark as deprecated — delete in 8g).
5. Update `DrawerContent.tsx` to become the expanded sidebar content, or inline its logic into `WorkspaceSidebar`.
6. Test on portrait and landscape orientations.

### Edges and gotchas

- **The icon rail must be narrow enough for small phones** (320px logical width). 52px leaves 268px for content — tight but usable. On phones < 360px wide, consider hiding the rail entirely and using a swipe-from-left gesture.
- **Plugin renderer uses `opacity: 0 + position: absolute`** (from Lunel pattern at `/Users/sunny/claude-code-remote/lunel/app/components/PluginRenderer.tsx`) to hide inactive panels without unmounting. Verify Stavi's `PluginRenderer` does the same — if it unmounts, switching tabs will lose state.
- **`PluginBottomBar` handled `onHeightChange`** which set `bottomBarHeight` for content margin. The sidebar doesn't need this — content area is the full remaining width, full height. Remove `bottomBarHeight` state.
- **Android hardware back button:** Currently navigates to SessionsHome. Keep this behavior — the sidebar doesn't change back-button semantics.
- **Keyboard handling:** When the AI composer keyboard is open, the sidebar should remain visible (icon rail) but not expand. The keyboard avoidance applies only to the content area.

### Verification script

```
Phase 8e verification (target: 10 minutes)

1. Sidebar renders
   - Open a workspace
   - PASS: left icon rail visible with tool icons. No bottom bar.

2. Tool switching
   - Tap each icon in the sidebar
   - PASS: content area switches to that tool's panel

3. Sidebar expand/collapse
   - Swipe right on sidebar or tap its edge
   - PASS: sidebar expands to show labels + active chats

4. Active chats
   - Have 2+ chats in a workspace
   - Expand sidebar
   - PASS: both chats listed. Tap one → switches to it.

5. Home/Settings
   - Tap Home icon in sidebar bottom
   - PASS: navigates to SessionsHome

6. No bottom bar
   - PASS: no bottom tab bar visible anywhere
```

---

## Phase 8f — Chat-First Layout

### Goal

Make AI Chat the default and persistent pane. When a workspace opens, the AI Chat is visible. Other tools open as overlays or split panes, not full replacements.

### Design

When a workspace opens:
- The AI Chat panel is always visible in the main content area.
- Tapping a tool icon in the sidebar (Terminal, Editor, etc.) opens that tool as a panel that either:
  - (A) **Replaces** the chat (current behavior, simplest), or
  - (B) **Overlays** the chat as a slide-over panel (more complex, better UX)

**Decision: Option A for Phase 8f** (replace, with fast switching). Option B is a future enhancement. The key change is: AI Chat is the **default** tab when entering a workspace, and there's a prominent "New Chat" button.

### Changes

1. **Default tab on workspace entry:** When `initialize(sessionId)` is called in plugin-registry, if no active tab is set, default to the AI plugin tab (not the first registered plugin).
2. **"New Chat" button:** Add a floating action button or a prominent button in the AI panel's empty state and in the sidebar's chat section. Tapping it creates a new thread and switches to it.
3. **Chat list in sidebar:** The expanded sidebar shows all chats for this workspace. Each chat shows title and last message preview. Active chat is highlighted.
4. **Chat switching:** Tapping a different chat in the sidebar switches the AI panel to that chat's thread. This is the existing thread-switching mechanism, just exposed in the sidebar instead of a dropdown.

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| MODIFIED | `apps/mobile/src/stores/plugin-registry.ts` | `initialize(sessionId)`: if no `activeTabId` for this session, default to the AI plugin's tab ID. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` | Add "New Chat" button in the panel header or empty state. Wire to `ensureActiveThread` (with force-create flag). |
| MODIFIED | `apps/mobile/src/components/WorkspaceSidebar.tsx` | Chat list section: show chats for current workspace. "New Chat" button. Active chat highlight. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/useOrchestration.ts` | Add `createNewChat()` action that always creates a new thread (unlike `ensureActiveThread` which reuses). |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/hooks/useOrchestrationActions.ts` | Implement `createNewChat` — dispatches `thread.create` with a fresh threadId, sets it as active. |

### Ordered steps

1. Modify `plugin-registry.ts` `initialize`: after loading tabs, if `activeTabIdBySession[sessionId]` is undefined, find the AI plugin tab and set it as active.
2. Add `createNewChat()` to `useOrchestrationActions.ts`: always creates a new thread (no reuse check), binds it, sets as active.
3. Add "New Chat" button to `WorkspaceSidebar` chat section and to the AI panel header.
4. Wire chat list in sidebar: read threads from orchestration state, render as tappable rows, highlight active.
5. Test: open workspace → AI chat is the first thing visible. Can create new chats. Can switch between chats.

### Edges and gotchas

- **`ensureActiveThread` vs `createNewChat`:** `ensureActiveThread` reuses an existing thread if one is bound. `createNewChat` always creates. Both call `thread.create` RPC. The difference is intent: "send a message" vs "start fresh".
- **Thread/Chat lifecycle:** Creating many chats could clutter the list. Add a "close chat" action (archives the thread) in a future phase. For now, all chats persist.
- **The AI plugin currently uses `activeThreadId` to decide which thread to show.** This works — switching chats updates `activeThreadId`, and the message list re-renders for the new thread.
- **Empty workspace:** If no chats exist, the AI panel shows an empty state with a prompt to "Start a new chat" and a big input area. The first message auto-creates a chat.

### Verification script

```
Phase 8f verification (target: 5 minutes)

1. Default to AI
   - Create a new workspace and open it
   - PASS: AI Chat panel is visible immediately (not Terminal, not Editor)

2. New Chat
   - Tap "New Chat" button (sidebar or header)
   - PASS: new empty chat appears. Old chat preserved.

3. Chat switching
   - Create 2 chats with messages in each
   - Expand sidebar, tap between chats
   - PASS: content switches to show each chat's messages

4. First message auto-creates
   - Open workspace with no chats
   - Type and send a message
   - PASS: chat is auto-created, message sent, response received
```

---

## Phase 8g — Polish & Verify

### Goal

End-to-end verification, doc updates, and close-out of accumulated followups.

### Tasks

1. **Full smoke test** of all 6 phases' verification scripts back-to-back.
2. **Update `docs/MENTAL-MODEL.md`** to reflect new terminology, home screen layout, sidebar shell.
3. **Update `plans/followups.md`** to close items addressed by Phase 8.
4. **Delete dead code:**
   - `PluginBottomBar.tsx` if not already deleted in 8e.
   - Any remnants of the old drawer system in `WorkspaceScreen.tsx`.
5. **NewSessionFlow simplification:** If 3-step flow feels heavy now that agent picker is gone, merge folder selection + title into a single step. (Optional — only if time permits.)
6. **Performance check:** Verify the flat workspace list performs well with 50+ workspaces (use `FlatList` with `getItemLayout` for fixed-height cards).
7. **Accessibility:** Ensure sidebar icons have `accessibilityLabel` props. Workspace cards have `accessibilityRole="button"`.

### Files touched

| Status | Path | What changes |
|--------|------|-------------|
| MODIFIED | `docs/MENTAL-MODEL.md` | Full rewrite of terminology, layout diagrams, store architecture |
| MODIFIED | `plans/followups.md` | Close Phase 8 items |
| DELETED | `apps/mobile/src/components/PluginBottomBar.tsx` | Dead code (if not deleted in 8e) |
| MODIFIED | Various | Accessibility labels, performance optimizations |

### Verification script

```
Phase 8g verification (target: 15 minutes)

Run ALL verification scripts from 8a through 8f sequentially.
All must pass.

Additionally:
1. Cold start
   - Force-quit app, reopen
   - PASS: home screen loads, servers auto-connect, workspaces appear

2. Multi-server
   - Connect to 2 servers
   - PASS: both servers' workspaces in flat list. Each card shows correct server name.

3. Reconnect
   - Kill one server, wait for reconnect toast
   - PASS: toast appears. Server's workspaces show as offline.
   - Restart server
   - PASS: workspaces come back online.
```

---

## Appendix A: Answer to "Should AI Chat continue as the current Thread concept?"

**Yes, Chat = Thread.** The server-side `threads` table is the right storage model for chats. Each thread already has:
- `id` (chat ID)
- `session_id` (workspace binding)
- `title` (chat title)
- `model_selection` (JSON blob for provider/model prefs)
- `created_at`, `updated_at` (for sorting)

What's missing is `agent_runtime` (added in Phase 8c) and a UI that treats threads as first-class "chats" rather than an internal concept. The rename is purely cosmetic + exposing the thread list in the sidebar.

The `messages` table stores chat messages. The orchestration subscription (`subscribeOrchestrationDomainEvents`) already streams thread events. No new server infrastructure is needed — it's a UI restructure.

## Appendix B: Files Disposition Summary

| File | Disposition |
|------|-------------|
| `packages/server-core/src/providers/codex.ts` | MODIFIED (8a: fix race) |
| `packages/server-core/src/providers/claude.ts` | VERIFIED ONLY (8a: add test) |
| `packages/server-core/src/types.ts` | MODIFIED (8c: agentRuntime optional) |
| `packages/server-core/src/db/migrations/` | NEW file (8c: 0002 migration) |
| `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | REWRITTEN (8d: flat list) |
| `apps/mobile/src/navigation/WorkspaceScreen.tsx` | REWRITTEN (8e: sidebar) |
| `apps/mobile/src/components/PluginBottomBar.tsx` | DELETED (8e/8g) |
| `apps/mobile/src/components/PluginHeader.tsx` | SIMPLIFIED (8e) |
| `apps/mobile/src/components/DrawerContent.tsx` | REPURPOSED or DELETED (8e) |
| `apps/mobile/src/components/SessionsHomeServerSection.tsx` | REPURPOSED or DELETED (8d) |
| `apps/mobile/src/components/NewSessionFlow.tsx` | SIMPLIFIED (8c: remove agent picker) |
| `apps/mobile/src/plugins/workspace/ai/index.tsx` | MODIFIED (8c, 8f: provider selector, new chat) |
| `apps/mobile/src/plugins/workspace/ai/useOrchestration.ts` | MODIFIED (8b: type alias, 8c: agentRuntime, 8f: createNewChat) |
| `apps/mobile/src/stores/plugin-registry.ts` | MODIFIED (8f: default to AI tab) |
| `apps/mobile/src/stores/sessions-store.ts` | MODIFIED (8d: getAllWorkspaces) |
| `docs/MENTAL-MODEL.md` | REWRITTEN (8b, 8g) |

## Appendix C: What This Plan Does NOT Change

1. **Server storage schema shape** — no table drops, no table renames, no column drops. Only additive changes (new column, new migration).
2. **Wire protocol RPC tags** — `session.*`, `thread.*`, `terminal.*` etc. stay as-is.
3. **Noise NK / relay transport** — untouched.
4. **Design tokens** — Phase 7b tokens (indigo accent, Inter font) are preserved.
5. **Plugin registry architecture** — discriminated union, per-session tabs, GPI all stay.
6. **Explorer, Git, Terminal, Editor, Browser plugins** — internal logic untouched. Only their container (bottom bar → sidebar) changes.
7. **Multi-server support** — fully preserved. The flat home screen still shows workspaces from all servers.
