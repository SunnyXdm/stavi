# Stavi Master Plan — Phase 0 through Phase 7

Authored by: Opus 4.6 (lead architect)
Grounded in: `plans/recon-report.md` (2026-04-13), `plans/architecture-analysis.md`, `plans/bugs-and-features.md`, `plans/00-prompt.md` corrections 1–5.
Executor: Sonnet 4.6, one phase at a time.

## Executive Summary

Stavi today conflates "where the CLI launched" with "the project." The app is single-server, single-folder, and loses all state when the server restarts. This plan restructures Stavi into a **viewer of Sessions** (workspace instances) running across **one or more Servers**, persists Sessions and Threads in SQLite, splits plugins into `workspace` and `server` scope, replaces the read-only editor with an Acode-style IDE surface, promotes the relay scaffolding to a working tunnel transport, and ends with a polish pass plus the bulk file manager. Phase 0 is a cleanup pass (five bugs + the directory rename) that every later phase depends on. Phases 1 and 2 introduce the Session on the server and the Sessions Home on mobile. Phase 3 makes the Workspace Session-bound. Phase 4 builds the Editor. Phase 5 finishes multi-server parity. Phase 6 implements Noise NK and the relay transport. Phase 7 closes loops. No phase requires design judgment from the executor.

## Mental Model

```
Server (host daemon; 0..N per user)
  └── Connection (transport: LAN WebSocket OR relay-tunneled Noise)
        └── Session = Workspace instance = (serverId, folder, title, agentRuntime, status, lastActiveAt)
              ├── Thread (AI conversation; 0..N per Session — NOT auto-created)
              │     └── Message (append-only; streams while generating)
              ├── Terminal tab (0..N; cwd defaults to session.folder)
              ├── Editor tab (0..N; open files from session.folder)
              ├── Git context (working tree of session.folder)
              └── Browser tab (0..N in-app previews)

Mobile surfaces:
  App
    ├── SessionsHomeScreen (root)
    │     ├── Connected Server section[s]  →  Sessions list  +  Tools button
    │     └── Saved Server section[s]
    ├── Add Server sheet (formerly ConnectScreen)
    ├── New Session flow (pick server → pick folder → title+agent)
    ├── PairServerScreen (QR scanner, Phase 6)
    └── WorkspaceScreen (one Session; AI/Editor/Terminal/Git/Browser/Tools)
          ├── Bottom bar: workspace-scoped plugin tabs + Tools button
          ├── Drawer: per-tool sub-tabs (AI threads, terminal tabs)
          └── Tools sheet: server-scoped plugins (Processes/Ports/Monitor/SystemSearch)

Plugin scope:
  workspace   — AI, Editor, Terminal, Git, Browser, Explorer, workspace-search
  server      — Processes, Ports, Monitor, system-search
```

Folder is selected **once** at Session creation. Plugins never prompt for a folder.

---

## Phase 0 — Cleanup & Truth

### Goal

Remove five concrete bugs that will sabotage later phases, and rename the mobile plugin directories so every later phase can reference the new paths without an "old vs new layout" footnote. This is the only phase that touches multiple unrelated areas. No user-visible features.

### Files touched

| Status | Path | What changes |
|---|---|---|
| MODIFIED | `apps/mobile/src/navigation/ConnectScreen.tsx` | Fix `pingServer()` URL from `/api/health` to `/health`. |
| MODIFIED | `packages/server-core/src/providers/claude.ts` | Null `session.queryRuntime` on the success return path (line ~541, the `case 'result':` branch) for symmetry with the abort/error branches. **Do NOT touch `hasStarted`** — it is already set correctly (lines 539 and 573) and read at line 369 to switch between `sessionId` (first turn) and `resume` (subsequent turns). The recon was wrong; multi-turn already works. Keep this edit minimal. |
| MODIFIED | `apps/mobile/src/plugins/core/ai/hooks/useOrchestrationActions.ts` → moved to `apps/mobile/src/plugins/workspace/ai/hooks/useOrchestrationActions.ts` | Replace module-level `instanceThreadBindings: Map` with a Zustand store (`stores/ai-bindings-store.ts`). Reconcile on snapshot and clear on disconnect. |
| NEW | `apps/mobile/src/stores/ai-bindings-store.ts` | Bindings store (see contract below). |
| MODIFIED | `packages/server-core/src/handlers/terminal.ts` | Per-subscription filter on `subscribeTerminalEvents` (filter by `threadId` and optional `terminalId`). |
| MODIFIED | `packages/server-core/src/context.ts` | Reject empty `threadId` in terminal key composition; type-level requirement. |
| MODIFIED | `packages/server-core/src/types.ts` | `TerminalSession.threadId: string` stays, but handlers validate non-empty. |
| MOVED | `apps/mobile/src/plugins/core/` → `apps/mobile/src/plugins/workspace/` | `ai`, `editor`, `terminal`, `git`, `browser` move. |
| MOVED | `apps/mobile/src/plugins/extra/processes` → `apps/mobile/src/plugins/server/processes` | Stays under `server/`. |
| MOVED | `apps/mobile/src/plugins/extra/ports` → `apps/mobile/src/plugins/server/ports` | Stays under `server/`. |
| MOVED | `apps/mobile/src/plugins/extra/monitor` → `apps/mobile/src/plugins/server/monitor` | Stays under `server/`. |
| MOVED | `apps/mobile/src/plugins/extra/explorer` → `apps/mobile/src/plugins/shared/explorer` | `shared/` is a new directory for plugins that *could* run in either scope. Explorer is workspace-scoped today. |
| MOVED + RENAMED | `apps/mobile/src/plugins/extra/search` → `apps/mobile/src/plugins/workspace/workspace-search` | Rename the existing search plugin. Its `PluginDefinition.id` becomes `workspace-search`. |
| NEW | `apps/mobile/src/plugins/server/system-search/index.tsx` | Stub that registers `system-search`, renders "Coming in Phase 7." |
| MODIFIED | `apps/mobile/src/plugins/load.ts` | Update imports and registration. |
| MODIFIED | `apps/mobile/src/stores/plugin-registry.ts` | Hydration migration: old persisted tab ids `search` → `workspace-search`; if a persisted tab references a plugin id no longer registered, drop it. |

### Order of operations

1. **Create `stores/ai-bindings-store.ts`** with the contract below. Keep it empty-on-disconnect and reconciled-on-snapshot.
2. **Fix ConnectScreen `/health` path.** One-line change at the fetch URL in `pingServer()`.
3. **Claude queryRuntime cleanup.** In `sendTurn()`'s `case 'result':` branch (currently line ~541), add `session.queryRuntime = null;` immediately before the `return;` so the three exit paths (result / abort / error) all leave the session in the same shape. **Do NOT modify `hasStarted`.** It is already written at line 539 (success) and line 573 (stream end) and read at line 369 to pick `resume` vs `sessionId`. The `plans/architecture-analysis.md` and `plans/recon-report.md` claims that multi-turn is broken were mistaken — verified 2026-04-14 by reading `claude.ts` directly. Add one integration assertion in `packages/server-core/test/claude-multi-turn.ts` (Bun test) that sends two turns and verifies the second turn sees `session.hasStarted === true` and the SDK options contain `resume: session.sessionId`. Use a stub SDK (document in test header) since the real SDK cannot be driven offline.
4. **Terminal subscription filter.** In `handlers/terminal.ts`, change `subscribeTerminalEvents` payload to `{ threadId?, terminalId? }`. The handler records `{ ws, threadId, terminalId }` per subscription and, on each emit, filters subscribers whose `(threadId, terminalId?)` match the event's terminal. Default behavior: if the subscribe payload omits `threadId`, the subscription receives nothing and the handler logs a warning — DO NOT fall back to global broadcast.
5. **Terminal key collision.** In `context.ts` where `${threadId}:${terminalId}` is composed, throw `new Error('threadId is required')` if `threadId` is an empty string. Add the same guard in every `terminal.*` handler.
6. **Directory rename.** Use `git mv` for every file under `core/`, `extra/explorer`, `extra/processes`, `extra/ports`, `extra/monitor`, `extra/search`. Update every `import` path. Verify with `tsc --noEmit` at the root.
7. **Move `ai/hooks/useOrchestrationActions.ts`** to the new `workspace/ai/hooks/` path as part of step 6, and replace the `instanceThreadBindings` Map reference with the new store.
8. **Stub `server/system-search/index.tsx`.** See the stub contract below.
9. **Update `load.ts`** imports and register-order.
10. **Plugin registry migration.** In `plugin-registry.ts`'s `persist.migrate` (add one if absent — zustand persist version bump to `2`), rewrite persisted `openTabs[*].pluginId` from `search` → `workspace-search`. On hydrate, drop any tab whose `pluginId` is not registered.
11. Run `tsc --noEmit`, the app's existing Metro bundle (`npx react-native start --reset-cache`), and a smoke test against the running server to verify the five bug fixes.

### Contracts and shapes

**`apps/mobile/src/stores/ai-bindings-store.ts`** (new file):

```typescript
// WHAT: Binds plugin tab instanceId ↔ server threadId, per (serverId, sessionId).
// WHY: Replaces the module-level instanceThreadBindings Map that leaked across reconnects.
// HOW: Zustand store with reconciliation on snapshot and explicit clear on disconnect.

export interface AiBindingKey { serverId: string; sessionId: string; instanceId: string; }

export interface AiBindingsState {
  bindings: Record<string, string>; // key = `${serverId}::${sessionId}::${instanceId}` → threadId
  bind(key: AiBindingKey, threadId: string): void;
  unbind(key: AiBindingKey): void;
  reconcile(serverId: string, sessionId: string, validThreadIds: Set<string>): void;
  clearServer(serverId: string): void; // on disconnect
  getBoundThreadId(key: AiBindingKey): string | undefined;
}
```

**Terminal subscription payload change:**

```typescript
// Request: subscribeTerminalEvents { threadId: string; terminalId?: string }
// Chunk: { type: 'output'|'exited'|'resized'; threadId: string; terminalId: string; data?: string; ... }
// Guarantee: chunks are only emitted to subscribers whose (threadId, terminalId?) matches the source terminal.
```

**`apps/mobile/src/plugins/server/system-search/index.tsx`** (stub, Phase 0 — uses the pre-split `PluginDefinition` shape):

```typescript
// WHAT: System-wide search stub. Placeholder until Phase 7.
// WHY:  Phase 0 introduces the new `plugins/server/` directory; this stub populates it so `load.ts` has something to register under the server scope folder.
// HOW:  Uses the current (pre-Phase-2) `PluginDefinition` shape — no `scope` field. Phase 2 Part B upgrades this file along with every other plugin definition.
// SEE:  apps/mobile/src/plugins/load.ts, packages/shared/src/plugin-types.ts

import type { PluginDefinition } from '@stavi/shared';
import { Search } from 'lucide-react-native';
import { View, Text } from 'react-native';

const SystemSearchPanel = () => (
  <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
    <Text style={{ color: '#888' }}>Coming in Phase 7</Text>
  </View>
);

// TODO(Phase 2): add `scope: 'server'` when PluginDefinition becomes a discriminated union.
export const systemSearchPlugin: PluginDefinition = {
  id: 'system-search',
  name: 'System Search',
  description: 'Search across the entire host machine.',
  kind: 'extra',
  icon: Search,
  component: SystemSearchPanel,
};
```

Do **not** import `ServerPluginDefinition` in Phase 0 — that type does not exist until Phase 2 Part B. Using the current `PluginDefinition` shape keeps Phase 0 type-clean; Phase 2 upgrades this file along with every other plugin.

### Edges and gotchas

- **`hasStarted` is load-bearing, not dead.** Verified 2026-04-14: `claude.ts` writes it at lines 539 and 573, and reads it at line 369 to choose `resume` vs `sessionId`. Do not delete the field, do not add a second write, do not "clean it up." The only Phase 0 edit to `claude.ts` is nulling `queryRuntime` on the success return path for symmetry. The `architecture-analysis.md` and `recon-report.md` bug descriptions were both wrong on this point; update those docs in the same PR to reflect reality.
- **`git mv` preserves history** and is required — do not use plain `mv`+`git add`.
- **`persist.migrate` will be called on every legacy install.** Guard it with a check that `state?.openTabs` exists; if a user has no persisted state, return `state` unchanged.
- **The stub system-search must not subscribe to anything.** It's literally a "Coming soon" card.
- Do NOT change the public wire protocol in Phase 0. The terminal subscribe payload gains an optional field; existing clients that already send `{}` log a warning and receive nothing, which is safer than continuing the global broadcast.

### Verification script (contents of `plans/0-verify.md`)

```
Phase 0 verification (target: 5 minutes)

Prereq:
- Kill any running stavi server and any mobile app instance.

1. Health endpoint
   - Start the server: cd packages/server-core && bun src/server.ts
   - From the mobile app, view the server list and wait 5s.
   - PASS: each saved server shows "online" (green dot). FAIL: offline.

2. Claude multi-turn
   - Inside a workspace with a Claude AI tab, send: "remember my favorite color is teal"
   - Send: "what is my favorite color?"
   - PASS: response mentions teal. FAIL: model has no memory.

3. Instance thread bindings
   - Open AI tab, create a thread, send one message.
   - Kill the server. Restart the server.
   - Reconnect from mobile.
   - PASS: the AI panel shows an empty thread list (stale binding dropped), NOT a broken pointer to the old threadId. Confirm in Flipper/console: `getBoundThreadId` returns undefined.

4. Terminal subscription isolation
   - Open two terminal tabs in two different threads (tab A with threadId T1, tab B with T2).
   - In tab A run `echo hello-from-A`.
   - PASS: tab B's output area does NOT show "hello-from-A".

5. Terminal key collision
   - In a dev console, call `terminal.open({ terminalId: 'x' })` (no threadId).
   - PASS: server responds with Exit.Failure "threadId is required".

6. Directory rename
   - Run `grep -rn "plugins/core/" apps/mobile/src | grep -v node_modules`.
   - Run `grep -rn "plugins/extra/" apps/mobile/src | grep -v node_modules`.
   - PASS: both greps return zero matches.
   - Run `tsc --noEmit` from repo root.
   - PASS: zero errors.

7. Persistence migration
   - Before upgrade, ensure the test device has a persisted tab with pluginId="search".
   - Upgrade and relaunch.
   - PASS: tab's pluginId is rewritten to "workspace-search", the tab still opens.
```

---

## Phase 1 — Server-side Session model (foundation, no UI)

### Goal

Introduce `Session` as a first-class server object, persisted in `bun:sqlite`. Threads gain a `session_id` foreign key. The server exposes a `session.*` RPC family. Mobile types get the new `Session` shape but the UI is unchanged in this phase.

### Files touched

| Status | Path | What changes |
|---|---|---|
| NEW | `packages/server-core/src/db/index.ts` | Opens `~/.stavi/userdata/stavi.db`, runs migrations, exports singleton. |
| NEW | `packages/server-core/src/db/migrations/runner.ts` | Forward-only migration runner with `_migrations` table. |
| NEW | `packages/server-core/src/db/migrations/0001_initial.sql` | Sessions/threads/messages schema. |
| NEW | `packages/server-core/src/repositories/session-repo.ts` | CRUD. |
| NEW | `packages/server-core/src/repositories/thread-repo.ts` | CRUD + `listForSession`. |
| NEW | `packages/server-core/src/repositories/message-repo.ts` | Append + list + replace. |
| NEW | `packages/server-core/src/handlers/session.ts` | `session.*` + `subscribeSessions`. |
| MODIFIED | `packages/server-core/src/types.ts` | Add `Session` interface. |
| MODIFIED | `packages/server-core/src/context.ts` | Warm the in-memory `threads` Map from `thread-repo` on boot; make it a write-through cache. |
| MODIFIED | `packages/server-core/src/server.ts` | Read/generate `serverId`, wire session handlers into the flat-tag switch. |
| MODIFIED | `packages/server-core/src/handlers/orchestration/index.ts` | `thread.create` command accepts `sessionId`, writes through to `thread-repo`. Broadcasts `thread.created`. |
| MODIFIED | `packages/server-core/src/handlers/orchestration/turn-start.ts` | On turn start, update parent Session's `status='running'` and `lastActiveAt=Date.now()` via `session-repo.touch`. On turn end, set `status='idle'`. |
| MODIFIED | `packages/shared/src/domain-types.ts` | Add `Session` type (shared between server and mobile). |
| MODIFIED | `~/.stavi/userdata/credentials.json` shape | Extend with `serverId: string`. If missing at boot, generate and write. |

### Order of operations

1. **Generate `serverId`.** On server boot, load `credentials.json`. If it lacks `serverId`, generate `crypto.randomUUID()`, merge, and write atomically. Expose `ctx.serverId`.
2. **Open `db/index.ts`.** Path: `~/.stavi/userdata/stavi.db` (same dir as credentials). Use `new Database(path, { create: true })` from `bun:sqlite`.
3. **Migration runner.** On boot, run every `migrations/*.sql` file whose version is greater than the max applied. Record in `_migrations`.
4. **Write `0001_initial.sql`** (see SQL below).
5. **Implement repositories** (see contracts below). Each returns plain objects; raw rows never leak.
6. **Warm caches from disk.** In `context.ts`, populate `ctx.threads` and `ctx.messages` Maps by calling `thread-repo.listAll()` + `message-repo.listAll()` on boot.
7. **Implement `handlers/session.ts`.** One handler per tag. Broadcast via the same fan-out helpers used by other subscriptions.
8. **Wire tags into `server.ts`** flat-tag switch. No changes to wire protocol.
9. **Modify `thread.create`** in `orchestration/index.ts`: accept a new `sessionId` field on the command payload; reject if it's missing AND no legacy default Session exists; write the thread through to `thread-repo`; include `session_id` in the DB row.
10. **Modify `turn-start.ts`** to touch the parent Session on turn start/end.
11. **Add `Session` shape** to `packages/shared/src/domain-types.ts`. Re-export from `packages/shared/src/index.ts`.
12. **Do NOT auto-create a default Session on boot.** If no Sessions exist, `session.list` returns `[]`. This is correct — Phase 2's mobile Sessions Home is responsible for the first creation.

### Contracts and shapes

**`packages/server-core/src/db/migrations/0001_initial.sql`:**

```sql
CREATE TABLE IF NOT EXISTS _migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  server_id TEXT NOT NULL,
  folder TEXT NOT NULL,
  title TEXT NOT NULL,
  agent_runtime TEXT NOT NULL CHECK (agent_runtime IN ('claude', 'codex')),
  status TEXT NOT NULL CHECK (status IN ('idle', 'running', 'errored', 'archived')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_active_at INTEGER NOT NULL,
  metadata TEXT
);

CREATE INDEX IF NOT EXISTS idx_sessions_server_lastactive
  ON sessions(server_id, last_active_at DESC);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  runtime_mode TEXT NOT NULL,
  interaction_mode TEXT NOT NULL,
  branch TEXT NOT NULL,
  worktree_path TEXT,
  model_selection TEXT,  -- JSON-encoded ModelSelection
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_session ON threads(session_id);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  text TEXT NOT NULL,
  turn_id TEXT,
  streaming INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  sequence INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_thread_seq ON messages(thread_id, sequence);
```

**`Session` type (packages/shared/src/domain-types.ts):**

```typescript
export type SessionStatus = 'idle' | 'running' | 'errored' | 'archived';
export type AgentRuntime = 'claude' | 'codex';

export interface Session {
  id: string;
  serverId: string;
  folder: string;           // absolute path
  title: string;
  agentRuntime: AgentRuntime;
  status: SessionStatus;
  createdAt: number;        // epoch ms
  updatedAt: number;
  lastActiveAt: number;
  metadata?: Record<string, unknown>;
}

export interface SessionWithThreads {
  session: Session;
  threads: OrchestrationThread[]; // may be empty
}
```

**Repository contracts** (all async, all return plain objects):

```typescript
// session-repo.ts
createSession(input: { folder: string; title: string; agentRuntime: AgentRuntime }): Session;
listSessions(opts?: { includeArchived?: boolean }): Session[];
getSession(id: string): Session | undefined;
updateSession(id: string, patch: Partial<Pick<Session,'title'|'status'|'metadata'|'lastActiveAt'>>): Session;
archiveSession(id: string): void;   // sets status='archived'
deleteSession(id: string): void;    // hard delete, cascades
touchSession(id: string, status?: SessionStatus): void; // updates lastActiveAt and optional status

// thread-repo.ts
createThread(input: { sessionId: string; /* … same fields as today … */ }): OrchestrationThread;
listThreadsForSession(sessionId: string): OrchestrationThread[];
getThread(id: string): OrchestrationThread | undefined;
updateThread(id: string, patch: Partial<OrchestrationThread>): OrchestrationThread;
deleteThread(id: string): void;
listAll(): OrchestrationThread[]; // for cache warm-up

// message-repo.ts
appendMessage(m: OrchestrationMessage): void;
listMessagesForThread(threadId: string): OrchestrationMessage[];
replaceMessage(id: string, next: OrchestrationMessage): void; // used by streaming updater
```

**`session.*` RPC payloads (flat-tag, unchanged wire protocol):**

```typescript
// Request: session.create
//   payload: { folder: string; title?: string; agentRuntime?: AgentRuntime }
//   Exit.Success.value: Session
//
// Request: session.list
//   payload: { includeArchived?: boolean }
//   Exit.Success.value: { sessions: Session[] }
//
// Request: session.get
//   payload: { sessionId: string }
//   Exit.Success.value: SessionWithThreads
//
// Request: session.rename
//   payload: { sessionId: string; title: string }
//   Exit.Success.value: { session: Session }
//
// Request: session.archive
//   payload: { sessionId: string }
//   Exit.Success.value: { ok: true }
//
// Request: session.delete
//   payload: { sessionId: string }
//   Exit.Success.value: { ok: true }
//
// Request: session.touch
//   payload: { sessionId: string }
//   Exit.Success.value: { ok: true }
//
// Request: subscribeSessions
//   payload: {}
//   Chunk: { type: 'created'|'updated'|'archived'|'deleted'; session: Session }
//
// Request: server.getConfig (MODIFIED in this phase)
//   Exit.Success.value: { cwd, providers, serverId }   // serverId added
```

Document each in `docs/PROTOCOL.md` (create the file if missing) in the same commit.

### Edges and gotchas

- **Default Session legacy compatibility:** Some existing callers may send `orchestration.dispatchCommand { type: 'thread.create' }` without a `sessionId`. Reject with a clear error (`'thread.create requires sessionId starting Phase 1'`) rather than silently falling back — the mobile side in Phase 2 is the one caller that changes.
- **Cache/DB coherence:** Every write goes through the repository; the repository updates the DB and then the in-memory Map. Never the other way around. `turn-start.ts`'s `session-repo.touch()` is allowed to run synchronously on the hot path — `bun:sqlite` writes are ≤1ms in practice.
- **Message streaming replacement:** Streaming turns currently replace an in-memory message object's `text` in place. The repo contract exposes `replaceMessage(id, next)` to mirror that in SQL. Call it at most once per ~50ms to avoid write amplification — RAF coalescing on the server is reasonable.
- **`server-runtime.json`** continues to exist for host/port/pid. Do not merge it with `credentials.json`.
- **Migration on empty DB:** `CREATE TABLE IF NOT EXISTS` + `_migrations` row insert is idempotent; the runner can be called unconditionally.
- **Existing in-memory threads:** there are none at boot after server restart today. No data migration needed.
- **JSON columns:** `metadata` and `model_selection` are stored as JSON strings. The repository serializes on write and parses on read. If parse fails (corrupt row), log and return `undefined` for the field rather than throwing.
- **Do NOT add a namespaced protocol migration here.** `@stavi/protocol` remains unused dead code.

### Verification script (contents of `plans/1-verify.md`)

```
Phase 1 verification

1. Empty DB on first boot
   - Delete ~/.stavi/userdata/stavi.db.
   - Start server. Confirm file is created and the _migrations table has one row (version=1).

2. session.create round-trip
   - Use a scratch ws client to send session.create { folder: '/tmp', title: 'demo' }.
   - PASS: response is a Session with non-empty id, serverId matches credentials.json, status='idle'.

3. Persistence
   - Kill the server. Restart it.
   - Send session.list {}.
   - PASS: previous session is returned.

4. Empty Threads list
   - session.get { sessionId: <id> } → { session, threads: [] }.
   - PASS: threads is []. No default Thread auto-created.

5. Create Thread via orchestration
   - Send orchestration.dispatchCommand { command: { type:'thread.create', sessionId: <id>, projectId, title, runtimeMode, interactionMode, branch, worktreePath } }.
   - Restart server.
   - session.get { sessionId: <id> } → threads has one entry.
   - PASS.

6. Cascade delete
   - session.delete { sessionId }. Restart server. thread-repo.getThread(oldId) → undefined.
   - PASS.

7. session.touch updates lastActiveAt
   - Record lastActiveAt. Wait 1s. session.touch. lastActiveAt increased.

8. Migration idempotency
   - Re-run the server twice. _migrations still has exactly one row for version=1.
```

---

## Phase 2 — Mobile Sessions Home + plugin scope split

### Goal

Replace the ConnectScreen-as-root with a Sessions Home that lists Sessions grouped by Server, and introduce the `PluginDefinition.scope: 'workspace' | 'server'` infrastructure plus a per-server store for server-scoped plugin state. These changes are bundled because the Sessions Home exposes the Tools button that requires the server-scope machinery.

### Part A — Sessions Home, multi-connection scaffolding

#### Files touched

| Status | Path | What changes |
|---|---|---|
| NEW | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | New app root. |
| NEW | `apps/mobile/src/components/NewSessionFlow.tsx` | Bottom sheet: server → folder → title+agent. |
| NEW | `apps/mobile/src/stores/sessions-store.ts` | `sessionsByServer: Map<serverId, Session[]>`. |
| MODIFIED | `apps/mobile/src/navigation/ConnectScreen.tsx` | Repurposed as "Add Server" sheet; no longer the app root. |
| MODIFIED | `apps/mobile/src/App.tsx` | Root navigator: `SessionsHome` (initial) → `Workspace` → `Settings`. |
| MODIFIED | `apps/mobile/src/stores/connection.ts` | Multi-connection: `connectionsById: Map<serverId, ConnectionState>`. Remove the `activeConnection` singleton assumption. |
| MODIFIED | `apps/mobile/src/stores/stavi-client.ts` | Make `StaviClient` instantiable per-server. Export a `createStaviClient(config): StaviClient` factory. Remove the `export const staviClient = new StaviClient()` singleton. Callers obtain a client via `useConnectionStore.getState().getClientForServer(serverId)`. |
| MODIFIED | every file importing `staviClient` | Replace with `getClientForServer(serverId)` — scoped by the Session's serverId for workspace plugins, by the `serverId` prop for server plugins. |

#### Order of operations — Part A

1. **Factory `createStaviClient(config)`** in `stavi-client.ts`. Preserve the existing WebSocket behavior; the only change is no singleton.
2. **Multi-connection store rewrite.** `ConnectionState` per server: `{ serverId, savedConnection, clientState, client, error }`. Actions: `addServer`, `connectServer(id)`, `disconnectServer(id)`, `getClientForServer(id): StaviClient | undefined`, `getServerStatus(id)`, `forgetServer(id)`.
3. **sessions-store.** Subscribes to `subscribeSessions` for every connected server. Reconciles on connect/disconnect/snapshot. Exposes `getSessionsForServer(serverId): Session[]` and `getSession(sessionId): Session | undefined`.
4. **`SessionsHomeScreen.tsx`** layout:
   ```
   ┌───────────────────────────────────┐
   │  stavi             ⚙  +           │   topbar: title, settings, new session
   ├───────────────────────────────────┤
   │  ▼  laptop · local   ● · 🧰       │   server header: name, status, Tools button
   │     demo project          2m ago  │
   │     auth refactor         12m ago │
   ├───────────────────────────────────┤
   │  ▼  workstation · tunnel  ○ · 🧰  │
   │     (no sessions yet)             │
   ├───────────────────────────────────┤
   │  Saved servers                    │
   │     home-pi   (disconnected) [Connect]
   └───────────────────────────────────┘
   ```
   Uses FlashList for the sessions inside each server section. Pull-to-refresh re-requests `session.list`.
5. **NewSessionFlow** sheet: three-step form (stepper UI). Confirmed data path: `getClientForServer(serverId).request('session.create', …)` → navigate to Workspace with `{ sessionId }`.
6. **ConnectScreen** becomes `AddServerSheet.tsx` (rename) — same form, different shell. Remove all navigation calls out of this file; it now resolves via `onComplete` callback.
7. **App.tsx** new navigator stack.
8. **Grep and replace** every `import { staviClient }` in the mobile app. Each call site either has a `session` prop (workspace plugin), a `serverId` prop (server plugin), or is in a screen that owns a `sessionId`/`serverId` in route params. Pass that id through to `getClientForServer`.

#### Contracts — Part A

```typescript
// apps/mobile/src/stores/connection.ts
export interface PerServerConnection {
  serverId: string;
  saved: SavedConnection;
  state: 'idle'|'authenticating'|'connecting'|'connected'|'reconnecting'|'error'|'disconnected';
  error: string | null;
  client: StaviClient | null;
}

export interface ConnectionStore {
  connectionsById: Record<string, PerServerConnection>;
  savedConnections: SavedConnection[]; // unchanged persistence
  addServer(saved: SavedConnection): void;
  connectServer(id: string): Promise<void>;
  disconnectServer(id: string): void;
  forgetServer(id: string): void;
  getClientForServer(id: string): StaviClient | undefined;
  getStatusForServer(id: string): PerServerConnection['state'];
}
```

```typescript
// apps/mobile/src/stores/sessions-store.ts
export interface SessionsStore {
  sessionsByServer: Record<string, Session[]>;
  isLoadingByServer: Record<string, boolean>;
  errorByServer: Record<string, string | null>;
  refreshForServer(serverId: string): Promise<void>;
  getSessionsForServer(serverId: string): Session[];
  getSession(sessionId: string): Session | undefined;
  startSubscription(serverId: string): () => void; // returns unsubscribe
}
```

### Part B — Plugin scope split

#### Files touched — Part B

| Status | Path | What changes |
|---|---|---|
| MODIFIED | `packages/shared/src/plugin-types.ts` | Add `scope: 'workspace'\|'server'` discriminated union. |
| MODIFIED | `apps/mobile/src/stores/plugin-registry.ts` | `openTabsBySession: Record<sessionId, PluginInstance[]>`. Server-scoped plugins NOT persisted as tabs. |
| NEW | `apps/mobile/src/stores/server-plugins-store.ts` | Ref-counted per-server subscriptions for Processes/Ports/Monitor. |
| NEW | `apps/mobile/src/components/ServerToolsSheet.tsx` | Shared sheet for server-scoped plugins. |
| MODIFIED | `apps/mobile/src/components/PluginBottomBar.tsx` | Only `scope:'workspace'` plugins render as tabs; Tools button opens ServerToolsSheet. |
| MODIFIED | `apps/mobile/src/components/PluginRenderer.tsx` | Branches on `definition.scope` to pass `session` vs `serverId`. |
| MODIFIED | every `PluginDefinition` in the **post-Phase-0** plugin tree: `apps/mobile/src/plugins/workspace/{ai,editor,terminal,git,browser,workspace-search}/index.tsx`, `apps/mobile/src/plugins/server/{processes,ports,monitor,system-search}/index.tsx`, `apps/mobile/src/plugins/shared/explorer/index.tsx` | Adds `scope` field (`'workspace'` or `'server'`). Paths assume Phase 0's `git mv` has already happened — do not look under `plugins/core/` or `plugins/extra/`. |

#### Order of operations — Part B

1. **Rewrite `PluginDefinition`** as a discriminated union (see contract below). `tsc --noEmit` will break — that's the point; fix every plugin definition in order.
2. **Set scope on every existing plugin.**
   - workspace: `ai`, `editor`, `terminal`, `git`, `browser`, `explorer`, `workspace-search`
   - server: `processes`, `ports`, `monitor`, `system-search`
3. **`server-plugins-store.ts`** — a Zustand store keyed by `serverId`. Each plugin holds ref count; store subscribes via `getClientForServer(serverId).subscribe(…)` when count goes 0→1 and tears down when count goes 1→0.
4. **`ServerToolsSheet.tsx`** — a bottom sheet with a tab header (Processes / Ports / Monitor / System Search). Takes a `serverId` prop. Can be opened from two surfaces: SessionsHomeScreen's server header button AND WorkspaceScreen's bottom-bar Tools button (the latter passes `serverId = session.serverId`).
5. **`PluginBottomBar.tsx`** — filter to `scope==='workspace'`. The Tools button opens ServerToolsSheet with the current Session's serverId.
6. **`PluginRenderer.tsx`** — on render, read `definition.scope` and pass the matching props shape (`session` vs `serverId`).
7. **`plugin-registry.ts` rework.**
   - Rename `openTabs` → `openTabsBySession: Record<sessionId, PluginInstance[]>`.
   - Rename `activeTabId` → `activeTabIdBySession: Record<sessionId, string | null>`.
   - Reject `openTab` on a server-scoped plugin (those don't have tabs).
   - Persist a version bump; migrate old state by dropping it (one-time reset is acceptable — users lose their tabs layout once).

#### Contracts — Part B

```typescript
// packages/shared/src/plugin-types.ts
export type PluginScope = 'workspace' | 'server';

export interface WorkspacePluginPanelProps {
  scope: 'workspace';
  instanceId: string;
  isActive: boolean;
  session: Session;
  bottomBarHeight: number;
  initialState?: Record<string, unknown>;
}

export interface ServerPluginPanelProps {
  scope: 'server';
  instanceId: string;
  isActive: boolean;
  serverId: string;
  bottomBarHeight: number;
  initialState?: Record<string, unknown>;
}

export type PluginPanelProps = WorkspacePluginPanelProps | ServerPluginPanelProps;

interface PluginDefinitionBase {
  id: string;
  name: string;
  description: string;
  kind: PluginKind;
  icon: ComponentType<{ size?: number; color?: string }>;
  navOrder?: number;
  navLabel?: string;
  allowMultipleInstances?: boolean;
  permissions?: PluginPermission[];
  api?: () => PluginAPI;
  onActivate?: (instanceId: string) => void;
  onDeactivate?: (instanceId: string) => void;
}

export interface WorkspacePluginDefinition extends PluginDefinitionBase {
  scope: 'workspace';
  component: ComponentType<WorkspacePluginPanelProps>;
}

export interface ServerPluginDefinition extends PluginDefinitionBase {
  scope: 'server';
  component: ComponentType<ServerPluginPanelProps>;
}

export type PluginDefinition = WorkspacePluginDefinition | ServerPluginDefinition;
```

```typescript
// apps/mobile/src/stores/server-plugins-store.ts
export interface PerServerPluginState {
  processes: { list: ManagedProcess[]; subscribersCount: number };
  ports: { list: PortInfo[]; subscribersCount: number };
  monitor: { stats: SystemStats | null; subscribersCount: number };
}

export interface ServerPluginsStore {
  byServer: Record<string, PerServerPluginState>;
  subscribeProcesses(serverId: string): () => void;
  subscribePorts(serverId: string): () => void;
  subscribeMonitor(serverId: string): () => void;
}
```

### Edges and gotchas — Phase 2

- **Singleton removal ripple:** `staviClient` is imported in many places today. Search results in Phase 0 recon found it in `editor/index.tsx`, `ai/hooks/useOrchestrationActions.ts`, etc. Every one of those call sites must be rewritten. If the component is a workspace plugin, it receives `session` and can compute `serverId = session.serverId`. If it's a server plugin, it receives `serverId` directly.
- **App cold start:** SessionsHome calls `connectServer(id)` for every saved server automatically OR waits for user to tap. **Decision:** auto-connect on app launch (better UX), but never block the UI — servers render in "connecting" state and promote to "connected" when ready.
- **Ref counting:** the server-plugins-store must increment on mount of both SessionsHomeScreen's visible Tools sheet AND WorkspaceScreen's Tools sheet simultaneously. When both close, the count goes to zero and the underlying subscription is torn down.
- **PluginInstance migration:** a one-time `persist.migrate` bumps to version `3` and resets `openTabsBySession = {}`. Users lose their tabs once. Acceptable because Phase 3's rework is the load-bearing step.
- **System Search stub's panel** must render "Coming in Phase 7" from this phase onward, because it's now visible via the Tools sheet.
- **Sessions Home pulls from every server** — if a server is connected but `session.list` fails (e.g., schema mismatch), show a per-server error state, not a global failure.

### Verification — Phase 2 (contents of `plans/2-verify.md`)

```
Phase 2 verification

1. Cold start to SessionsHome
   - Launch app. PASS: SessionsHome is the first screen. ConnectScreen is not shown.

2. Add two servers
   - Tap "+" → Add Server → enter two sets of credentials (different hosts).
   - PASS: two server sections visible, both connecting then connected.

3. Create a Session
   - Tap "+", pick server 1, pick /tmp, title "demo", agent Claude, confirm.
   - PASS: WorkspaceScreen opens with sessionId.
   - Kill app, relaunch. PASS: session is still listed in SessionsHome.

4. Tools sheet from SessionsHome
   - Tap 🧰 on server 1's header.
   - PASS: ServerToolsSheet opens. Processes tab shows real data.

5. Tools sheet from Workspace
   - Open a session on server 1. Tap Tools in the bottom bar.
   - PASS: Same ServerToolsSheet, Processes already populated (no refetch).

6. Single subscription
   - Enable debug logs for WebSocket.
   - Open both Tools sheets (server 1 from home + workspace of server 1).
   - PASS: server log shows exactly one active subscribeProcessEvents subscription.
   - Close both. PASS: subscription torn down.

7. Plugin scope enforcement
   - Try tcl-calling `usePluginRegistry.getState().openTab('processes')`.
   - PASS: logs a rejection; no tab created.

8. Empty state
   - Forget all servers. PASS: empty state "Add your first server".
```

---

## Phase 3 — Workspace becomes Session-bound

### Goal

`WorkspaceScreen` takes a `sessionId` route param, all plugins inside receive `session: Session` as a prop, the Home navigation no longer disconnects, and every folder-picker call site outside the New Session flow is removed.

### Files touched

| Status | Path | What changes |
|---|---|---|
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Route takes `sessionId`. On mount, call `session.touch`. Load Session via `sessions-store`. Resolve the active Thread (most recent or none — AI panel lazy-creates on first send). Remove DirectoryPicker invocations. |
| MODIFIED | `apps/mobile/src/components/DrawerContent.tsx` | Home button: `navigation.navigate('SessionsHome')`. Do NOT call `disconnect()`. |
| MODIFIED | `apps/mobile/src/stores/plugin-registry.ts` | Scope tabs per Session (ties into Phase 2 Part B changes). |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` | Remove folder-picker empty state. Always has a folder via `session.folder`. Lazy-create first Thread via `orchestration.dispatchCommand { type:'thread.create', sessionId }` on first send. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/useOrchestration.ts` | Accept `session` prop. `cwd` derived from `session.folder`, not from directory picker state. |
| MODIFIED | `apps/mobile/src/plugins/workspace/editor/index.tsx` | Receive `session` — no more "Connect first" empty state; defaults to showing `session.folder` (the file tree lands in Phase 4, so Phase 3 shows the existing placeholder with no folder prompt). |
| MODIFIED | `apps/mobile/src/plugins/workspace/terminal/index.tsx` | Pass `cwd: session.folder` to `terminal.open`. No prompt. |
| MODIFIED | `apps/mobile/src/plugins/workspace/git/index.tsx` | Reads `session.folder` as working dir (the server side must also accept a per-request `cwd`/`worktreePath` — verify). |
| MODIFIED | `apps/mobile/src/plugins/workspace/browser/index.tsx` | Receives `session`; if it had implicit folder reads, use `session.folder`. |
| MODIFIED | `apps/mobile/src/components/PluginRenderer.tsx` | Already branches on scope (Phase 2), now reliably passes `session` prop through. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/hooks/useOrchestrationActions.ts` | Use `ai-bindings-store` keyed by `(serverId, sessionId, instanceId)` (Phase 0 store, extended in Phase 3 to include sessionId). |
| DELETED | every `DirectoryPicker` caller outside `NewSessionFlow.tsx` | grep-confirmed zero call sites. |
| MODIFIED | `apps/mobile/src/components/DirectoryPicker.tsx` | Unchanged except: add a JSDoc header stating the ONLY caller is `NewSessionFlow`. |

### Order of operations

1. **WorkspaceScreen signature.** Route param: `{ sessionId: string }`. On mount, look up the Session from `sessions-store`. If missing, re-fetch via `getClientForServer(?)` — but we don't know the server. Solution: `sessions-store` flattens `sessionsById: Record<sessionId, Session>` derived from `sessionsByServer`. Use it.
2. **`session.touch`** on mount. Non-blocking; log errors.
3. **Active Thread resolution.** Load threads from `session.get`. If empty, AI panel shows the Composer in a welcome state (no messages, no threadId bound yet). If one or more, pick `threads.sort((a,b)=>+new Date(b.updatedAt) - +new Date(a.updatedAt))[0]`.
4. **Per-Session tabs.** The `openTabsBySession[sessionId]` list is initialized (if absent) with the default set of singleton workspace plugins' tabs using the existing `initialize()` logic, but keyed by sessionId. Switching Sessions swaps the entire tab state.
5. **AI lazy thread.** In `useOrchestrationActions.ts`, the "send" path checks `getBoundThreadId`. If undefined, it first dispatches `thread.create { sessionId }`, awaits, then sends the turn.
6. **Remove folder prompts.** Grep for `DirectoryPicker` inside `navigation/WorkspaceScreen.tsx`, `plugins/workspace/ai/index.tsx`, `plugins/workspace/editor/index.tsx` — delete those render paths and their state. Replace with rendering against `session.folder`.
7. **Terminal cwd default.** `terminal.open` RPC gains a default of `session.folder` from the terminal plugin's side. Server already accepts `cwd`.
8. **Drawer Home button.** Replace `handleNavigateHome` body with `navigation.navigate('SessionsHome')`. Do not touch any connection. Add an `onBlur` hook in WorkspaceScreen that does nothing (affirmative: sessions and sockets stay alive).
9. **Hardware back (Android).** In WorkspaceScreen's `useFocusEffect`, register a BackHandler that calls `navigation.navigate('SessionsHome')` and returns `true` (consumes).
10. **Confirm `session.touch` on re-entry.** When Workspace is focused after navigating back from Home, call `session.touch` again (cheap).
11. **Grep-audit DirectoryPicker.** Final grep must return only `NewSessionFlow.tsx` as a caller. Add a CI check or a `plans/3-verify.md` grep step.

### Contracts — Phase 3

**`plugin-registry.ts` per-Session shape:**

```typescript
interface PluginRegistryState {
  definitions: Record<string, PluginDefinition>;
  openTabsBySession: Record<string, PluginInstance[]>;   // sessionId → tabs
  activeTabIdBySession: Record<string, string | null>;
  isReady: boolean;

  initializeForSession(sessionId: string): void;
  openTabInSession(sessionId: string, pluginId: string, initialState?: Record<string, unknown>): string;
  closeTabInSession(sessionId: string, instanceId: string): void;
  setActiveTabInSession(sessionId: string, instanceId: string): void;
}
```

**`ai-bindings-store.ts`** (extends the Phase 0 store):

```typescript
export interface AiBindingKey {
  serverId: string;
  sessionId: string;
  instanceId: string;
}
// Same API as Phase 0 but the key now includes sessionId.
```

**AI lazy-thread creation:**

```typescript
// In useOrchestrationActions.sendMessage(…):
let threadId = getBoundThreadId({ serverId, sessionId, instanceId });
if (!threadId) {
  const { thread } = await client.request<{ thread: OrchestrationThread }>('orchestration.dispatchCommand', {
    command: {
      type: 'thread.create',
      sessionId,
      projectId: session.folder,    // use folder as projectId for now
      title: session.title,
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      branch: '(unknown)',
      worktreePath: session.folder,
    },
  });
  threadId = thread.threadId;
  bind({ serverId, sessionId, instanceId }, threadId);
}
// then dispatch thread.turn.start with threadId and text
```

### Edges and gotchas — Phase 3

- **`session-registry` (drawer) vs `sessions-store`.** These are different stores. The existing `useSessionRegistry` stays — it tracks drawer per-tool sub-tabs (e.g., AI threads for the current Session). Do not merge or rename; just make sure it resets when the active Session changes.
- **Route-level "Session not found":** If a user deep-links (or resumes) into a Session that has been archived or deleted server-side, WorkspaceScreen shows an error state with a button back to Home. Do not silently redirect.
- **Per-Session tabs initialization** must run before the first render of `PluginBottomBar` to avoid a flash.
- **DirectoryPicker is not deleted** — it's still used in New Session. But all its screens/hooks outside that flow are removed.
- **Terminal default cwd:** if the user already has a persisted terminal tab with a different cwd, keep that — the default applies only on new terminal opens.
- **Active thread persistence:** when the user switches active Thread inside the AI panel, persist that preference in the `ai-bindings-store` (bound per instanceId). On Session re-entry, restore the same active Thread. Do NOT add a new persisted key for this.

### Verification — Phase 3 (contents of `plans/3-verify.md`)

```
Phase 3 verification

1. No folder picker in plugins
   - Create Session A on /tmp/foo. Open AI tab.
   - PASS: AI panel shows a composer immediately, no DirectoryPicker modal.

2. First Thread lazy-create
   - Send "hi". Confirm server logs a thread.create with sessionId=<A>.
   - PASS.

3. Terminal default cwd
   - Open Terminal tab, run `pwd`.
   - PASS: prints /tmp/foo.

4. Home without disconnect
   - Drawer → Home. SessionsHome shows A in session list; WebSocket stays connected (status dot stays green).
   - PASS.

5. Per-Session tabs
   - Open Session A. Close the Editor tab.
   - Home, open Session B. PASS: Editor tab is present on B.
   - Home, reopen A. PASS: A's Editor tab is still closed.

6. Hardware back (Android)
   - In Workspace, press device back.
   - PASS: navigates to SessionsHome, does NOT exit the app.

7. Grep audit
   - grep -rn "DirectoryPicker" apps/mobile/src
   - PASS: only NewSessionFlow.tsx references it.

8. Deep-link to archived session
   - Manually archive Session A server-side. Navigate to Workspace?sessionId=<A>.
   - PASS: error screen with "Back to Home" button.
```

---

## Phase 4 — Acode-style Editor (file tree + CodeMirror tabs)

This phase has two sub-phases. Implement 4a first; 4b can be its own PR.

### Phase 4a — File tree, tabs, and open-via-event plumbing

#### Goal

Replace the Editor plugin's "no files open" empty state with a split pane: left-side file tree rooted at `session.folder`, right-side tab bar + placeholder content region. Add the event-bus plumbing so other plugins can ask the Editor to open a file.

#### Files touched — 4a

| Status | Path | What changes |
|---|---|---|
| NEW | `apps/mobile/src/plugins/workspace/editor/components/FileTree.tsx` | Left-edge tree. |
| NEW | `apps/mobile/src/plugins/workspace/editor/components/EditorTabs.tsx` | Tab bar. |
| NEW | `apps/mobile/src/plugins/workspace/editor/components/EditorToolbar.tsx` | Save/Undo/Redo/Find/FormatTree toggle (save/undo/redo are no-ops until 4b). |
| NEW | `apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx` | Placeholder: shows plain text via the existing fallback. Phase 4b replaces. |
| NEW | `apps/mobile/src/plugins/workspace/editor/store.ts` | `openFilesBySession`, `activeFileBySession`. Persisted via the plugin-registry Phase 3 mechanism (NOT AsyncStorage directly). |
| REWRITTEN | `apps/mobile/src/plugins/workspace/editor/index.tsx` | Composes FileTree + EditorTabs + EditorSurface. Subscribes to `editor.openFile` event. |
| MODIFIED | `apps/mobile/src/services/event-bus.ts` | Formalize `editor.openFile` event in the typed event payload map (`packages/shared/src/plugin-events.ts`). |
| MODIFIED | `packages/server-core/src/handlers/fs.ts` | Add RPCs: `fs.create` (file or directory), `fs.rename`, `fs.delete`. Add `showHidden?: boolean` option to `fs.list`. |
| MODIFIED | `packages/shared/src/plugin-events.ts` | Add `editor.openFile` typed event. |

#### Order of operations — 4a

1. **Shared event shape.**
   ```typescript
   // packages/shared/src/plugin-events.ts
   export interface PluginEventPayloads {
     'editor.openFile': {
       sessionId: string;
       path: string;              // absolute path
       line?: number;
       column?: number;
     };
     // ... existing events stay
   }
   ```
2. **`fs.list` hidden toggle.**
   ```typescript
   // payload: { path: string; showHidden?: boolean }
   // Server-side behavior: when showHidden === true, do NOT filter HIDDEN_DIRS.
   ```
3. **New fs RPCs.** One handler per tag:
   - `fs.create { path, type: 'file'|'directory', content? }`
   - `fs.rename { from, to }`
   - `fs.delete { path, recursive?: boolean }`
   - Each is a thin wrapper around `node:fs/promises`. Reject paths that are not within `ctx.workspaceRoot` OR a known Session folder (guard against path traversal).
4. **Editor store.** Per-Session map. Contracts below.
5. **FileTree.tsx.** Root = `session.folder`. Lazy load via `fs.list`. Header row: Refresh, Collapse All, Show/Hide Hidden, Find File (opens a modal powered by `fs.search`). Long-press on file: New File, New Folder, Rename, Delete, Duplicate, Copy Path, Open in Terminal Here. Tap folder: expand/collapse. Tap file: `eventBus.emit('editor.openFile', { sessionId, path })`.
6. **EditorTabs.tsx.** Horizontal ScrollView of tabs. Unsaved indicator = dot (binding to `dirty` flag, always false in 4a). Long-press menu: Close, Close Others, Close All, Close to the Right.
7. **EditorSurface.tsx (placeholder).** Re-use the current ScrollView + Text fallback.
8. **`index.tsx`.** On mount, subscribe to `editor.openFile`. When handling the event, ensure the Editor bottom tab is active (via `usePluginRegistry.setActiveTabInSession` — or, if not available in 4a, leave it on the caller to route), open the file (load content via `fs.read`), set it as active tab.
9. **"Open in Terminal Here"** — fire a cross-plugin call: emit `terminal.openHere` event (new) carrying `{ sessionId, cwd }`. The Terminal plugin subscribes and opens a new tab with that cwd. Add `terminal.openHere` to the event payload map.
10. **Tablet vs phone.** Use `useWindowDimensions()`. If width ≥ 900, tree stays pinned. Else collapsed by default with a toggle in the toolbar.
11. **Visual style.** Match existing theme tokens (see `stavi-vision.md`): `bg.base` + `bg.raised` layering, no borders, mint accent on selected items.

#### Contracts — 4a

```typescript
// editor/store.ts
export interface OpenFile {
  path: string;             // absolute
  content: string;
  dirty: boolean;
  loading: boolean;
  error?: string;
  language?: string;        // inferred in 4b
}

export interface EditorStore {
  openFilesBySession: Record<string, OpenFile[]>;
  activeFileBySession: Record<string, string | null>;
  expandedDirsBySession: Record<string, Set<string>>;
  showHiddenBySession: Record<string, boolean>;

  openFile(sessionId: string, path: string): Promise<void>;
  closeFile(sessionId: string, path: string): void;
  setActiveFile(sessionId: string, path: string): void;
  toggleExpanded(sessionId: string, path: string): void;
  toggleShowHidden(sessionId: string): void;
}
```

```typescript
// packages/shared/src/plugin-events.ts
export interface PluginEventPayloads {
  'editor.openFile': { sessionId: string; path: string; line?: number; column?: number };
  'terminal.openHere': { sessionId: string; cwd: string };
  // existing keys...
}
```

### Phase 4b — CodeMirror 6 in WebView

#### Goal

Replace the plain-text placeholder with a real code editor. Bundle CodeMirror 6 with a curated language pack list, load it in a single shared WebView, and drive it via postMessage.

#### Files touched — 4b

| Status | Path | What changes |
|---|---|---|
| NEW | `apps/mobile/assets/editor/index.html` | Minimal host page. |
| NEW | `apps/mobile/assets/editor/bundle.js` | CodeMirror 6 + language packs, built via esbuild. Committed as a built artifact. |
| NEW | `apps/mobile/assets/editor/README.md` | Build command: `cd apps/mobile/assets/editor && npm run build`. |
| NEW | `apps/mobile/assets/editor/src/` | Unbundled source for the CodeMirror host (input to esbuild). |
| NEW | `apps/mobile/assets/editor/package.json` | Editor bundle deps (@codemirror/*, esbuild). Scoped to this folder only. |
| REPLACED | `apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx` | WebView + postMessage bridge. |
| MODIFIED | `apps/mobile/src/plugins/workspace/editor/components/EditorToolbar.tsx` | Save/Undo/Redo/Find become wired. |
| MODIFIED | `apps/mobile/src/plugins/workspace/editor/store.ts` | `dirty` flag driven by WebView `contentChanged` event. Save flow calls `fs.write`. |
| NEW | `apps/mobile/src/plugins/workspace/editor/language-map.ts` | extension → CodeMirror language ID. |

#### Order of operations — 4b

1. **Create the editor bundle** in `apps/mobile/assets/editor/`. One-time esbuild config that outputs a single `bundle.js` + `index.html`. Language packs: TypeScript/JSX, JavaScript, Python, Markdown, JSON, HTML, CSS, Rust, Go, Java, Swift, Kotlin, Bash, YAML, TOML, plus a `StreamLanguage` fallback for unknown extensions.
2. **Bridge contract** (below). Queue all JS→Web calls until the Web side emits `ready`.
3. **Single WebView** — one per Editor plugin instance. Switching tabs = `loadFile()` call, not a new mount.
4. **Binary detection** — a small helper `isBinary(path): boolean` checks extension (png/jpg/gif/pdf/zip/tar/exe/…). Binary → render a card, don't load the WebView.
5. **Large file guard** — if file > 2 MB, prompt confirm; if > 10 MB, refuse.
6. **Save flow** — toolbar Save → `bridge.requestContent()` → await `contentChanged` with `final=true` → `fs.write`. Clear dirty flag on success.
7. **Theme** — one dark theme. Matches app tokens. Re-bundle when tokens change.
8. **React Native asset loading.** Use `react-native-webview`'s `source={{ uri: 'file:///android_asset/editor/index.html' }}` on Android and the bundled assets dir on iOS. Test both.
9. **Find** — in-editor find panel from `@codemirror/search`.
10. **`language-map.ts`** — `export function detectLanguage(path: string): string | null`.

#### Contracts — 4b

```typescript
// postMessage bridge — EXACT shape
// JS → Web
type JsToWeb =
  | { type: 'loadFile'; path: string; content: string; language: string | null }
  | { type: 'setTheme'; theme: 'dark' | 'light' }
  | { type: 'requestContent'; requestId: string }
  | { type: 'find' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'format' };

// Web → JS
type WebToJs =
  | { type: 'ready' }
  | { type: 'contentChanged'; content: string; dirty: boolean }
  | { type: 'cursorMoved'; line: number; col: number }
  | { type: 'contentResponse'; requestId: string; content: string }
  | { type: 'saveRequested' }
  | { type: 'error'; message: string };
```

### Edges and gotchas — Phase 4 (both halves)

- **WebView `ready()` race:** never call `loadFile` before `ready`. Queue.
- **50 MB string across bridge** will crash. 2 MB warn, 10 MB refuse, chunk above some threshold if we add streaming later (not in 4b).
- **Path handling:** always absolute server-side. UI can show relative to `session.folder`.
- **Hidden files toggle is tree state, not Session state.** Do not persist.
- **Language detection by extension only.** Don't content-sniff.
- **Bundle the editor ONCE and commit** — don't add it to Metro. Keeps mobile builds fast.
- **Do NOT put the file tree inside the Workspace drawer** — that drawer is for per-tool sub-tabs.
- **Do NOT attempt LSP / multi-cursor / diff / split view / drag-reorder** in this phase.

### Verification — Phase 4 (contents of `plans/4-verify.md`)

```
Phase 4a verification

1. Open editor, tree visible rooted at session.folder.
2. Expand folders. Tap a file. It opens in a tab.
3. Long-press a file → Rename → tree updates.
4. Long-press a folder → Open in Terminal Here → terminal tab opens with matching pwd.
5. Open three files, navigate Home and back → same three tabs restored, same active tab.
6. Toggle "Show hidden files" → .git directory now visible in the tree.

Phase 4b verification

1. Open a .ts file → syntax highlighting visible.
2. Edit the file → dirty dot appears on the tab.
3. Tap Save → file saved on server; dirty dot disappears; git panel now shows the file modified.
4. Open another file; original content preserved; new content loads within 500 ms.
5. Open a 50k-line file → loads in <2 s, scroll is smooth.
6. Open a .png → binary placeholder shown, no WebView mounted.
7. Try to open a 50 MB file → refusal dialog.
```

### Out of scope for Phase 4 (explicit)

Multi-cursor; LSP; inline AI suggestions in the editor; diff view; split editor; drag-to-reorder tabs.

---

## Phase 5 — Multi-server support end-to-end

### Goal

A user can add two servers, connect to both simultaneously, see Sessions from both in the home screen, and switch between them. Most of the plumbing landed in Phase 2 Part A; Phase 5 closes the gaps.

### Files touched

| Status | Path | What changes |
|---|---|---|
| MODIFIED | `apps/mobile/src/stores/connection.ts` | Reconnect per server independently. Backoff per server. |
| MODIFIED | `apps/mobile/src/stores/stavi-client.ts` | Verify no hidden singleton paths. Ensure subscriptions key by serverId on the mobile side too. |
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | Server sections in insertion order; tap header to expand/collapse; connection status dot; Reconnect button. |
| MODIFIED | `packages/server-core/src/handlers/server-config.ts` | `server.getConfig` returns `serverId` (introduced in Phase 1; Phase 5 treats it as mandatory on mobile). |
| MODIFIED | `apps/mobile/src/stores/connection.ts` | On first successful connect to a SavedConnection, set `savedConnection.serverId = server.getConfig().serverId`. Dedup saved connections by `serverId`. |
| MODIFIED | `packages/shared/src/transport-types.ts` | `SavedConnection.serverId?: string` added (optional until bound, then locked). |
| MODIFIED | every `session.*` handler | Defense: validate that the session's `serverId` matches `ctx.serverId`. (In practice the server only sees its own sessions; this is a belt-and-suspenders audit.) |

### Order of operations

1. **Per-server backoff.** Each `PerServerConnection` tracks its own attempt count. Do not share.
2. **Server identity dedup.** On `addServer`, pre-flight-fetch `server.getConfig` via a throwaway WebSocket to learn `serverId`. If an existing saved connection has the same `serverId`, refuse with "already added" rather than silently duplicating.
3. **Sessions Home section UX.** Server sections render in insertion order (`savedConnections.map(...)`). Each section has a status dot, a connection menu (Disconnect / Forget / Edit), a Tools button, and a collapse toggle. Empty sections show "Start a new session" inline.
4. **Cross-server safety audit.** Grep for every `sessions-store` access that forgets `serverId`. Every lookup must route through `getClientForServer(session.serverId)`.
5. **Reconnect UX.** When a server drops, the section greys out. On reconnect, it re-subscribes to `subscribeSessions` automatically — existing Phase 2 logic, now exercised by the reconnect path.

### Edges and gotchas

- **Same server, different address:** If user adds `192.168.1.5:8022` and `macbook.local:8022` and both resolve to the same daemon, the `serverId` dedup catches them. Treat dedup as a merge: keep the newer `savedConnection` entry, transfer `lastConnected`, drop the older one.
- **`SavedConnection` drift.** The mobile store's `SavedConnection` shape and the one in `packages/shared/src/transport-types.ts` have diverged (recon part 11 confirms: mobile has `{ id, name, host, port, bearerToken, tls?, createdAt, lastConnectedAt? }`; shared has `{ id, label, config, serverPublicKey?, lastConnected?, createdAt }`). In Phase 5, unify by adopting the mobile shape in shared and re-exporting it. Removing the unused shared shape is acceptable if no server-side caller consumes it (grep; the recon confirms there are none).
- **Reconnect storms.** Backoff starts at 1 s and caps at 64 s per server. A single server reconnecting does not affect others.

### Verification — Phase 5

```
Phase 5 verification

1. Add two servers on different hosts. Both reach 'connected'.
2. Create Session A on server 1 and Session B on server 2.
3. SessionsHome shows both under their respective server headers.
4. Open A, navigate Home, open B, Home — both WebSockets remain connected.
5. Kill server 1. Server 1 section greys out. Server 2 section is unaffected.
6. Restart server 1. Section auto-reconnects within 5 s.
7. Try to add server 1 again under a different hostname.
   PASS: "already added" error; no duplicate server entry.
8. Cross-server leak audit:
   - In Session A, subscribe to its orchestration events.
   - Create a Thread in Session B.
   - PASS: Session A's subscriber receives ZERO events from B.
```

---

## Phase 6 — Tunnel mode (E2E encrypted remote)

### Goal

Promote the dead relay scaffolding to a working transport. `stavi serve --relay <url>` opens a relay-tunneled endpoint; mobile scans a QR, completes a Noise NK handshake, and connects. Local and tunnel modes behave identically above the transport layer.

### Files touched

| Status | Path | What changes |
|---|---|---|
| REWRITTEN | `packages/crypto/src/index.ts` | Implement `NoiseSession` with `initiate`, `respond`, `encrypt`, `decrypt`. Uses `@stablelib/x25519` + `@stablelib/chacha20poly1305` + `@stablelib/sha256` for HKDF. |
| NEW | `packages/crypto/src/node-primitives.ts` | Node.js `CryptoPrimitives` impl. |
| NEW | `packages/crypto/src/rn-primitives.ts` | React Native `CryptoPrimitives` impl using `react-native-quick-crypto`. |
| MODIFIED | `apps/relay/src/index.ts` | Verify wire compatibility; document in header. Add `/health`. |
| MODIFIED | `apps/cli/src/index.ts` | `--relay <url>` flag; prints QR via `qrcode-terminal`. |
| NEW | `apps/mobile/src/navigation/PairServerScreen.tsx` | Camera QR scanner → decode PairingPayload → enqueue connect. |
| NEW | `apps/mobile/src/transports/LocalWebSocketTransport.ts` | Thin wrapper over current behavior. |
| NEW | `apps/mobile/src/transports/RelayTransport.ts` | Connects to relay; runs Noise NK; encrypts/decrypts frames. |
| MODIFIED | `apps/mobile/src/stores/stavi-client.ts` | Accepts a `Transport` interface: `{ send(bytes), onMessage(cb), close() }`. |
| MODIFIED | `apps/mobile/src/components/AddServerSheet.tsx` | Button: "Pair via QR" → PairServerScreen. |
| MODIFIED | `apps/mobile/src/stores/connection.ts` | Recognizes `config.relayUrl`. Chooses transport accordingly. |
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | Server row shows a tunnel icon when the connection is relay-routed. |

### Order of operations

1. **Noise NK implementation.** Follow the Noise spec: initiator with known static responder public key. Use HKDF-SHA256, X25519 ECDH, ChaCha20-Poly1305 AEAD, 8-byte nonce counter per direction (matches `@stavi/crypto` wire format).
2. **Platform primitives.** `node-primitives.ts` uses `node:crypto`. `rn-primitives.ts` uses `react-native-quick-crypto` (already in mobile deps — verify first; add if missing).
3. **Transport interface.**
   ```typescript
   export interface Transport {
     send(data: Uint8Array): void;
     onMessage(cb: (data: Uint8Array) => void): () => void;
     onStateChange(cb: (s: 'open'|'closed'|'error', err?: Error) => void): () => void;
     close(): void;
   }
   ```
4. **`LocalWebSocketTransport`** — wraps current `new WebSocket(...)` behavior. Existing auth flow unchanged.
5. **`RelayTransport`** — opens WS to relay, sends `HELLO roomId`, receives handshake bytes, runs Noise, then all subsequent frames are `FrameType.DATA` with ChaCha20-Poly1305 payloads.
6. **`StaviClient` transport switch.** Ctor accepts a `Transport`. All existing RPC logic sits above the transport. `createStaviClient(config)` picks the transport based on `config.relayUrl` presence.
7. **CLI flag.** `apps/cli/src/index.ts` adds `--relay <url>`. When set, the server process:
   - Generates an ephemeral room id.
   - Opens a persistent WS to the relay, registers the room.
   - Prints a QR of the `PairingPayload` (JSON → base64url), plus a human-readable URL for copy/paste.
   - Accepts relay-tunneled traffic in parallel to local WebSocket (both may be active).
8. **QR scanner.** `react-native-vision-camera` (verify it's a dep; add if not). `PairServerScreen.tsx` decodes the QR, parses the PairingPayload, creates a SavedConnection with `relayUrl` and `serverPublicKey`, and invokes `connectServer`.
9. **Tunnel status UI.** Sessions Home renders a tunnel icon next to server name when `savedConnection.config.relayUrl` is set.
10. **Protocol docs.** Append Noise handshake and frame format to `docs/PROTOCOL.md`.

### Edges and gotchas

- **Do not implement Noise from scratch.** Use the primitives from `@stablelib` + a thin state-machine you own. Document the nonce direction convention clearly.
- **Replay protection:** counter-per-direction; refuse nonces out of order. A reconnect MUST renegotiate keys.
- **Relay grace period** already exists in `apps/relay/src/index.ts` — verify it still honors the existing contract.
- **`react-native-quick-crypto` vs JS fallback:** measure handshake time on a mid-range Android device. If >500 ms, accept it for v1 but file a follow-up.
- **PairingPayload QR limits:** at ~300 bytes this fits fine in a QR code at size L; keep the payload minimal.
- **Expect two listening surfaces on the CLI side:** local WS (existing) and relay-tunneled. The server-core dispatch loop sees both the same way — the relay is just another WebSocket with framed data.
- **Do NOT break local-only mode.** Users without `--relay` must see no regression.

### Verification — Phase 6

```
Phase 6 verification

1. Start server with --relay wss://relay.example:8080.
2. Terminal prints a QR plus a copy/paste URL.
3. Mobile: Add Server → Pair via QR → scan.
4. Server section connects; tunnel icon visible.
5. Open a Session, send an AI message, verify the response streams.
6. Wireshark capture of the relay WebSocket shows only ciphertext (no plaintext JSON).
7. Kill mobile app. Restart. Resumes within 10 s (reconnect + re-handshake).
8. LAN mode (no --relay) still works — add a second server without QR, regular behavior.
```

---

## Phase 7 — Polish and verification

### Goal

Close loops: loading/error/empty states, reconnection UX polish, a one-page mental-model doc for AI agents landing in the codebase, and ship the bulk file manager Explorer UI (the Editor's tree handles 80% of operations; Explorer is the bulk-ops surface per Correction 5).

### Files touched

| Status | Path | What changes |
|---|---|---|
| MODIFIED | every screen added in Phases 2–6 | Loading, error, empty states. |
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | Reconnection UX: greyed sections auto-resume, toast on resume. |
| MODIFIED | `apps/mobile/src/stores/sessions-store.ts` | Telemetry console logs (structured) on session create/open/close. |
| NEW | `docs/MENTAL-MODEL.md` | One page. Server / Session / Thread / Connection / Workspace / Plugin scope explained for a cold AI reader. |
| REWRITTEN | `apps/mobile/src/plugins/shared/explorer/index.tsx` + new components | Multi-select, batch ops, metadata view, workspace search, Open-in-Editor / Open-in-Terminal actions. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/ExplorerList.tsx` | FlashList of entries with checkbox selection. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/ExplorerToolbar.tsx` | Move, Copy, Delete, Zip, Extract, Rename buttons. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/EntryMetaSheet.tsx` | Size, mtime, permissions, type. |
| MODIFIED | `packages/server-core/src/handlers/fs.ts` | Add `fs.batchMove`, `fs.batchCopy`, `fs.zip`, `fs.unzip`. |
| MODIFIED | `apps/mobile/src/plugins/workspace/workspace-search/index.tsx` | Ensure it's wired up per Correction 3; verify `fs.search` is scoped to `session.folder`. |

### Order of operations

1. **State audit.** For every screen, add explicit loading/error/empty states. Use existing theme tokens.
2. **Reconnection UX.** SessionsHome greys disconnected server sections, shows a small spinner, auto-reconnects, fires a one-shot toast when back.
3. **Telemetry.** Structured `console.log` calls with a `telemetry: { event, sessionId?, serverId?, ... }` shape. A single helper `logEvent(event, props)`.
4. **`docs/MENTAL-MODEL.md`.** One page. Diagram, definitions, and "what changed in this refactor" so a future reader understands the history in 90 seconds.
5. **Explorer UI.** Multi-select + toolbar as specified. `fs.batchMove` / `batchCopy` take `{ paths: string[], destination: string }`. `fs.zip` / `unzip` take `{ source, destination }`. Each operation returns a progress stream (reuse the chunk mechanism).
6. **Explorer wires Open-in-Editor:** `eventBus.emit('editor.openFile', ...)` on selected files. Open-in-Terminal-Here: `terminal.openHere`.

### Contracts

```typescript
// New fs RPCs
fs.batchMove   { paths: string[]; destination: string } → chunk { type:'progress'|'done'|'error', path?, error? }
fs.batchCopy   { paths: string[]; destination: string } → chunk stream (same shape)
fs.zip         { source: string; destination: string } → chunk stream
fs.unzip       { source: string; destination: string } → chunk stream
```

### Edges and gotchas

- **Don't re-implement file tree in Explorer.** Explorer uses a flat list with breadcrumbs; the tree lives in the Editor.
- **Batch ops should stream progress** — the mobile can show a progress sheet.
- **Permissions / mtime** — use `fs.stat` on the server; expose via a new `fs.stat` RPC if it doesn't already exist.

### Verification — Phase 7

```
Phase 7 verification

1. Disconnect server → section greys with spinner → reconnect server → toast "Reconnected to <server>".
2. Explorer multi-select three files → Delete → confirm → server shows files removed.
3. Explorer → Open in Editor on a file → Editor opens the file in a new tab.
4. Search in workspace-search → results limited to session.folder.
5. Read docs/MENTAL-MODEL.md cold (new tab): a reader can describe Session/Thread/Workspace in one paragraph each.
```

---

## Codebase Legibility Rules (apply to every phase)

These are the **non-optional** rules restated for the executor:

1. **Every new file gets a header.** Format:
   ```
   // WHAT: one sentence.
   // WHY:  why it exists.
   // HOW:  key deps and the contract it exposes.
   // SEE:  related files an agent should read with this one.
   ```
2. **No file over 400 lines.** Split along a clear seam (one file per RPC handler, one per repository, one per screen's sub-component).
3. **SQL only in `db/` and `repositories/`.** Handlers call repositories.
4. **One RPC handler per file** for new handlers. `session.ts` may stay together until it crosses 300 lines.
5. **No new module-level mutable state in mobile.** State goes in Zustand stores. The Phase 0 `instanceThreadBindings` fix is the model.
6. **Every new RPC tag is documented** in `docs/PROTOCOL.md` in the same PR that adds it.
7. **No clever abstractions.** Long obvious beats short clever.
8. **Every phase ends with a `plans/<phase>-verify.md`** script a human can run in under 5 minutes. Those scripts are embedded in this plan above — ship them as separate files.
9. **Plugin scope is declared explicitly.** `PluginDefinition` is a discriminated union by `scope`. Workspace components accept `session: Session`. Server components accept `serverId: string`. A workspace plugin that reaches for global folder state is a bug.

---

## Risks and Unknowns

1. **~~`hasStarted` may be obsolete~~ — Resolved 2026-04-14.** Direct read of `packages/server-core/src/providers/claude.ts`: `hasStarted` is written at line 539 (success) and line 573 (stream end) and read at line 369 to switch between `sessionId` (first turn) and `resume` (subsequent turns). Multi-turn Claude already works. The `architecture-analysis.md` and `recon-report.md` claims were both incorrect. Phase 0 does not touch `hasStarted`; it only nulls `queryRuntime` on the success return path for symmetry and lands an integration test that asserts the resume behavior. Update `plans/architecture-analysis.md` and `plans/recon-report.md` in the Phase 0 PR to remove the stale "multi-turn broken" claim.

2. **`react-native-quick-crypto` and `react-native-vision-camera`** may not be in `apps/mobile/package.json`. If not, Phase 6 adds them. Confirm before starting Phase 6.

3. **Claude SDK prompt queue semantics.** Per Phase 1, `turn-start.ts` hot-path SQL writes must be fast enough to not starve streaming. `bun:sqlite` writes are typically <1 ms, but under burst, RAF-coalesce or transaction-batch message updates. Measure; back off to batching only if it shows up in a profile.

4. **WebView asset paths** differ between Android (`file:///android_asset/…`) and iOS (bundle dir). Phase 4b's test matrix must include both. Android emulator reliably works; iOS may need additional tvm config.

5. **Relay availability.** Phase 6 assumes a reachable relay host. The demo can use the `apps/relay` service on localhost or a developer-owned host. Production relay is out of scope for this plan.

6. **Existing `@stavi/protocol` migration** — deliberately deferred. The namespaced protocol package remains unused. A future phase (not in this plan) migrates every flat tag to `{ v:1, ns, action }`. Do not start that work inside these 8 phases.

7. **OpenCode adapter** (listed as "planned" in `stavi-vision.md`) is not on this plan.

8. **iOS terminal quality** (xterm.js WebView replacement for the current scroll-view fallback) is not in scope here — it's a Phase-3-ish bug fix listed in `plans/bugs-and-features.md` (BUG-4) but does not block the architecture.

9. **The `SavedConnection` type drift** between mobile store and `@stavi/shared` is unresolved — Phase 5 unifies by adopting the mobile shape. Confirm no server-side consumer of the shared shape exists before removing it.

10. **Directory rename may break lint configs.** Double-check `eslint.config`/`tsconfig` paths aliases, `babel.config`, `metro.config`, and Jest module name mappers for `plugins/core/` or `plugins/extra/` references.

## Out of Scope (explicit list)

- iOS terminal xterm.js WebView replacement
- LSP or language server integration in the Editor
- Multi-cursor / split editor / drag-to-reorder tabs
- Inline AI suggestions in the Editor
- Diff view in the Editor (Git plugin continues to own diffs)
- Voice mode / transcription
- Light theme + theme system (tracked in `plans/ui-redesign.md` Phase 5)
- Namespaced protocol migration (`@stavi/protocol` stays dormant)
- OpenCode provider adapter
- Offline / local-model support (Ollama)
- Server discovery via Bonjour / mDNS
- Cross-session AI tool calls (GPI beyond what exists today)
- Background push notifications on mobile
- File attachments in AI prompts
- Revert/unrevert UI for turns

---

End of plan. Execute Phase 0, then stop and report. Proceed one phase at a time.
