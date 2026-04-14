# CORRECTIONS TO THE PRODUCT VISION (read before everything else)

This document was drafted with four conceptual mistakes. They are corrected here, at the top, because they invalidate parts of the phased plan below. **Where this section contradicts anything later in the document, this section wins.** When you (Opus) write `plans/00-master-plan.md`, propagate these corrections everywhere they're relevant — do NOT just copy the later phases verbatim if they conflict.

## Correction 1 — A Session is a Workspace, not an AI conversation

The earlier draft described a Session as roughly "an AI chat with extras" and proposed nesting Threads inside Sessions as a hierarchical container. That framing is wrong in a subtle but load-bearing way.

The correct definition:

> **A Session is a Workspace instance.** It is a `(server, folder)` pair representing "a project I currently have open." It is the user's working context. It is what appears on the home screen as "the workspaces I have open right now." It is NOT a Claude or Codex chat. It is NOT a Thread.

The things that live *inside* a Session:
- **AI Threads** (one or more AI conversations, each with their own message history) — these are what the existing `OrchestrationThread` already represents. The AI plugin's left-drawer thread list is showing the Threads that belong to the current Session.
- **Terminal tabs** (one or more PTY sessions, each bound to the Session's folder by default).
- **Editor tabs** (one or more open files from the Session's folder).
- **Git context** (the working tree state of the Session's folder).
- **Browser tabs** (any in-app preview tabs).

A Session has 0..N Threads. A Session has 0..N terminal tabs. A Session has 0..N editor tabs. None of these are the "essence" of the Session — the Session itself is just `(server, folder, title, status, lastActiveAt)` plus the contents listed above.

When the user creates a Session via the home screen flow ("+ New Session" → pick server → pick folder → pick title), the server creates an empty Session. **An initial Thread is NOT auto-created.** A Thread is created lazily the first time the user sends a message in the AI plugin within that Session. This is important — see Correction 2.

## Correction 2 — Folder selection happens ONCE, at Session creation

The earlier draft left this implicit. Be explicit:

> **No plugin ever asks the user to select a folder.** The folder is determined when the Session is created, on the home screen, before the user enters the Workspace. Every plugin inside the Workspace inherits the Session's folder automatically.

Concretely:

- The AI plugin must NOT show a folder picker when first opened. Today it does. This is a bug to fix as part of Phase 3 (the Session-bound Workspace phase). When the user opens the AI tab inside a Session, it just works — any new Thread it creates is bound to the Session's folder.
- The Editor plugin must NOT show a "pick a file" modal as its initial state. It should open with the Session's folder already loaded as a file tree on the left, and a welcome/empty tab on the right. (See Correction 4 for the Editor's full design.)
- The Terminal plugin must NOT prompt for a working directory. New terminal tabs spawn with `cwd = session.folder`.
- The Git plugin already operates on the current folder — verify it uses `session.folder`, not `ctx.workspaceRoot`.

The DirectoryPicker component continues to exist, but its only caller becomes the New Session flow on the home screen. Remove every other call site as part of Phase 3.

## Correction 3 — Plugins have a SCOPE: workspace-scoped vs server-scoped

This is the biggest structural correction. The earlier draft treated all plugins as workspace-local. They are not. Stavi has two distinct categories of plugins, and conflating them will produce subtle bugs around state sharing, subscriptions, and where data is fetched.

### Workspace-scoped plugins

These care about *which folder* you're working in. Their state is bound to a single Session. If you open the same plugin in two different Sessions on the same server, you see two different states.

- **AI** — Threads belong to a Session.
- **Editor** — Open files belong to a Session.
- **Terminal** — PTY tabs belong to a Session (their cwd is the Session's folder).
- **Git** — Operates on the Session's folder.
- **Browser** — In-app preview is per-Session.

### Server-scoped plugins

These care about the *host machine*, not the folder. Their state is bound to a Server, not a Session. If you open the same plugin from any Session on the same server (or directly from the home screen for that server), you see the SAME state — because there's only one process list per machine, one set of listening ports, one CPU/memory feed.

- **Processes** (managed processes spawned via `process.spawn`)
- **Ports** (listening ports on the host)
- **Monitor** (CPU / memory / disk stats)
- **System Search** (search across the entire machine, not the workspace folder — distinct from in-workspace search)

### How this scoping appears in the UI (decision: both surfaces)

Server-scoped plugins are accessible from **two places**, sharing the same underlying state per server:

1. **From inside any Workspace** — via the existing bottom-bar "Tools" sheet. Tapping Processes/Ports/Monitor inside a Workspace opens the same panel that would open from the home screen, but as a modal sheet over the current Workspace. The data shown is the Server's data, not anything bound to the current Session.

2. **From the Sessions Home screen** — each Server section header in the home screen has a "Tools" affordance (icon button on the right side of the section header) that opens a sheet showing that Server's tools (Processes/Ports/Monitor/System Search). The user can inspect server state without opening any Session at all.

Both surfaces are powered by the same per-server store: when the user opens Processes from anywhere, it subscribes (or reuses an existing subscription) to that server's `subscribeProcessEvents`. The data is identical regardless of entry point. Closing the sheet from one entry point does not unsubscribe if the other entry point is still open. Reference-counted subscriptions per server.

### How this scoping appears in code

- **Workspace-scoped plugins** receive `session: Session` as a prop / context. Their stores are keyed by `sessionId`. Their RPC calls implicitly target the Server that owns the Session.
- **Server-scoped plugins** receive `serverId: string` as a prop / context. Their stores are keyed by `serverId`. Their RPC calls target that Server directly. They do NOT receive a `session` prop and must not depend on one.
- **`PluginDefinition` gains a required field**: `scope: 'workspace' | 'server'`. The plugin loader uses this to wire the right context.
- **Stores are namespaced**: a server-scoped plugin's store looks like `processesByServer: Map<serverId, ProcessState>`, never `Map<sessionId, ...>`.

This split must be visible in the codebase organization. Move server-scoped plugins from `apps/mobile/src/plugins/extra/` into `apps/mobile/src/plugins/server/`, and rename `core/` to `workspace/`. New layout:

```text
apps/mobile/src/plugins/
  workspace/
    ai/
    editor/
    terminal/
    git/
    browser/
  server/
    processes/
    ports/
    monitor/
    system-search/
  shared/        ← bulk file manager Explorer lives here, see Correction 4
    explorer/
````

The directory rename is itself a Phase 0 task because every later phase depends on the new layout.

## Correction 4 — The Editor is an Acode-style IDE surface, not a "pick a file" modal

The Editor plugin must look and feel like an embedded Android code editor in the spirit of Acode (`com.foxdebug.acode`), not the read-only fallback it is today.

Concrete design (this is the design — implement to it, do not redesign in the plan):

### Layout

The Editor panel is split into two regions:

```text
┌─────────────────┬──────────────────────────────────────┐
│                 │  ┌────┬────┬────┐                    │
│   File tree     │  │tab1│tab2│tab3│  (open files)     │
│   (left side)   │  └────┴────┴────┘                    │
│                 │  ┌──────────────────────────────────┐│
│   /             │  │                                  ││
│   ├ src/        │  │   Code editor area               ││
│   │ ├ App.tsx   │  │   (CodeMirror 6 in WebView)      ││
│   │ └ index.ts  │  │                                  ││
│   ├ package.json│  │                                  ││
│   └ README.md   │  │                                  ││
│                 │  │                                  ││
└─────────────────┴──┴──────────────────────────────────┘
```

The file tree is a left-edge slide-in panel within the Editor (NOT the global Workspace drawer — that's a different drawer). It can be pinned open or auto-collapsed. On phones it auto-collapses by default; on tablets it stays pinned.

The right region holds editor tabs. Tabs are the unit of "open file." Tapping a file in the tree opens it as a new tab (or focuses it if already open). Long-press on a tab gives close/close-others/close-all. Unsaved changes are indicated with a dot next to the filename. Save with a save button in the editor toolbar (no Ctrl+S on mobile).

### File tree behavior (Acode-inspired)

* **Roots in the tree are the Session's folder.** No "add folder to workspace" — the workspace IS the Session's folder.
* **Lazy loading** — folders fetch their children only when expanded. Use the existing `fs.list` RPC (which already filters hidden dirs server-side; that filter must become opt-in via a "Show hidden files" toggle in the tree's header).
* **Inline file operations on long-press**: New File, New Folder, Rename, Delete, Duplicate, Copy Path, Open in Terminal Here (spawns a new terminal tab in the Terminal plugin with `cwd` = the folder).
* **Inline file operations on the tree's header**: Refresh, Collapse All, Show/Hide Hidden Files, Find File (Ctrl+P-style fuzzy search via `fs.search`).
* **Tap a folder** = expand/collapse. **Tap a file** = open in editor tab. **Long-press** = context menu.
* **Drag to reorder tabs** (nice to have, can be Phase 6 polish).

### Editor tab behavior

* **CodeMirror 6 in a WebView** (replacing the read-only plain text fallback). This is itself a meaningful piece of work — see "Editor implementation note" below.
* **Tabs persist per Session**: the open files for a Session are remembered when the user navigates Home and back. This rides on the per-Session `openTabsBySession` work in Phase 3.
* **Unsaved changes warning** when closing a tab.
* **Read-only fallback** for binary files (show "binary file, X bytes" with an option to open in the system viewer).

### "Open in Editor" from other plugins

Other plugins can ask the Editor to open a file. This is how Explorer's "Open in Editor" action works, how Git's "Open file" on a diff row works, how AI's file references in messages work. Implement it as an event:

```typescript
eventBus.emit('editor.openFile', { sessionId, path, line?, column? });
```

The Editor plugin subscribes to this event and: (a) ensures the Editor tab is visible in the bottom bar, (b) opens the file as a new tab (or focuses an existing one), (c) jumps to the line if specified.

### Editor implementation note for the executor

Replacing the read-only text fallback with CodeMirror 6 in a WebView is non-trivial. It should be its own phase with these sub-tasks:

1. Bundle CodeMirror 6 (with a sensible language pack — TypeScript, JavaScript, Python, Markdown, JSON, HTML, CSS, plus a generic fallback) into a static HTML asset shipped with the app.
2. Load it in a `WebView` with a postMessage bridge for: load file content, get content, save event, cursor position, selection, theme.
3. Wire the bridge to the file tree and the tab system.
4. Add the toolbar (save, undo/redo, find, format if available).
5. Performance: the existing FlashList + WebView combo in this app is well-trodden — follow the same patterns.

This Editor work becomes its own phase between Phase 3 and Phase 4 in the original draft. See "Phase ordering corrections" below.

## Correction 5 — The Explorer plugin's actual job

The Explorer plugin is NOT the Editor's file tree (that's built into the Editor — see Correction 4). The Explorer plugin is a **bulk file manager**: a separate surface for operations that don't fit a code editor's tree.

Explorer's job:

* Multi-select files and folders
* Batch operations: move, copy, delete, archive (zip), extract
* Drag and drop reordering / moving
* File metadata view (size, mtime, permissions)
* Search files by name/content within the workspace folder (workspace-scoped, distinct from System Search which is server-scoped)
* "Open in Editor" / "Open in Terminal Here" actions on selected files

Explorer is a **workspace-scoped plugin** (it operates on the Session's folder). It lives at `apps/mobile/src/plugins/shared/explorer/` because while it's workspace-scoped today, the same component could be reused on the home screen later for browsing a server's filesystem before Session creation. The "shared" directory is for plugins that *could* run in either scope; Explorer happens to currently only run in workspace scope.

Both the Editor's file tree and the Explorer plugin call the same `fs.*` RPCs on the server. There must be exactly one server-side fs handler family. They differ only in their UI and their workflows.

## Phase ordering corrections

The original draft had Phases 0-6. With the corrections above, the phase ordering must change:

* **Phase 0 — Cleanup & Truth (unchanged)** — five bug fixes plus the new directory rename (`plugins/core/` → `plugins/workspace/`, `plugins/extra/` → `plugins/server/`, with a new `plugins/shared/` for Explorer). The rename happens here because every later phase touches the new paths.
* **Phase 1 — Server-side Session model (mostly unchanged)** — Session is `(serverId, folder, title, status, lastActiveAt, ...)`. Threads gain a `session_id` foreign key but are NOT auto-created on session creation. Sessions can have zero Threads. The `session.create` handler creates only the Session, not a Thread. The first Thread is created lazily when the AI plugin sends its first message inside that Session.
* **Phase 2 — Mobile Sessions Home + plugin scope split** — adds the home screen AND introduces `PluginDefinition.scope: 'workspace' | 'server'` AND adds the per-server stores for server-scoped plugins. The Sessions Home screen renders Server section headers with a Tools affordance that opens server-scoped plugin sheets.
* **Phase 3 — Workspace becomes Session-bound + back navigation + folder picker removal** — same as the original draft, plus: every folder picker call site outside the New Session flow is removed; the AI plugin no longer asks for a folder; the Terminal plugin spawns with `session.folder`; per-Session tab persistence.
* **NEW Phase 4 — Editor (Acode-style)** — the CodeMirror-in-WebView editor with a built-in file tree and a tabbed editor area. This is the largest single phase and may need to split into 4a (file tree + open-via-event plumbing) and 4b (CodeMirror integration + tabs). Estimate at planning time.
* **Phase 5 — Multi-server support end-to-end** — was Phase 4 in the original draft. Renumber.
* **Phase 6 — Tunnel mode (E2E encrypted remote)** — was Phase 5 in the original draft. Renumber.
* **Phase 7 — Polish and verification** — was Phase 6 in the original draft. Renumber. Add to its scope: the bulk file manager Explorer plugin's UI (the Editor's tree handles 80% of file ops; Explorer ships in Phase 7 as the bulk-ops surface).

## End of corrections — read the rest of the document with these in mind

When you write `plans/00-master-plan.md`, renumber the remaining phases accordingly so the final master plan is Phase 0 through Phase 7.

# Stavi Architectural Plan — Phase 0 through Phase N

You are Opus 4.6 acting as the lead architect for Stavi, a mobile IDE for AI coding agents. Your job is to produce a complete, phased, file-level implementation plan that another instance of Claude (Sonnet 4.6) can execute one phase at a time without needing to make architectural decisions.

You will NOT write production code in this pass. You will produce a planning document. The success criterion is: a competent Sonnet instance, given any single phase from your plan and the current codebase, can implement that phase without asking clarifying questions about design.

## The product vision (read this twice)

Stavi today treats "where the CLI was launched" as "the project being worked on." This is wrong. The new mental model is:

* **A Server is a host.** It's a daemon (`stavi serve`) that exposes a filesystem and can run agents on any folder within that filesystem. The server is not bound to a project.
* **A Session is the unit of work.** A Session = `(serverId, folder, title, agent runtime, status, createdAt, lastActiveAt, persisted state)`. Sessions are first-class server-side objects that survive server restarts and mobile app restarts. A Session is the thing a user means when they say "the chat I had yesterday about the login bug."
* **A Session contains zero or more Threads, alongside terminal tabs, editor tabs, and other workspace contents.** A Thread is one AI conversation (the existing `OrchestrationThread` concept), and it is just one of several kinds of things that live inside a Session — not the Session's defining feature. Threads are NOT renamed; they keep their current role. A Session is created with zero Threads; the AI plugin creates the first Thread lazily when the user sends their first message inside that Session. See Correction 1 for the full rationale.
* **The mobile app is a viewer.** Closing the app does not kill Sessions on the server. Reopening the app shows all running Sessions across all connected Servers, grouped by Server.
* **Connections are transports, not contexts.** A user can connect to N Servers. For each Server, the connection is either local (LAN, direct WebSocket) or tunneled (E2E-encrypted via the existing relay). The UX above the transport layer is identical.
* **The home screen is a Session manager.** It lists running Sessions grouped by Server, plus a "+ New Session" button that triggers a flow: pick Server → pick folder → pick agent → enter Workspace. Connecting to a Server is a setup step, not the main event.
* **The Workspace is a modal view into one Session.** Today's WorkspaceScreen (AI / Editor / Term / Git / Browser / Tools tabs) becomes "the view you're in when you've opened one Session." From the Workspace you can navigate back to the Sessions home at any time WITHOUT disconnecting and WITHOUT killing the Session.
* **The drawer's job is per-tool sub-tabs within the current Session.** When the AI plugin is active, the drawer shows the Threads inside this Session. When the Terminal plugin is active, the drawer shows the terminal tabs inside this Session. The drawer is NOT plugin navigation and is NOT global navigation.
* **The codebase must be legible to AI agents.** This is itself a product constraint, not a nice-to-have. The Opus-plans-Sonnet-executes loop only works if Sonnet can open any single file and understand its purpose, contract, and edges in isolation. See "Codebase Legibility Rules" below.

## Decisions already made (do not relitigate)

1. **Session and Thread are sibling concepts, not nested.** A Session is a Workspace instance: `(serverId, folder, title, status, lastActiveAt, ...)`. A Thread is one AI conversation (the existing `OrchestrationThread`). A Session has 0..N Threads — but Threads are just one kind of content inside a Session, alongside terminal tabs and editor tabs. **Sessions are NOT created with a default Thread.** Threads are created lazily by the AI plugin the first time a user sends a message within a Session. Thread persistence (in the new SQLite store) gains a `session_id` foreign key, but the existing in-memory thread/message logic continues to work as-is — Sessions are added as a layer above, not as a replacement. See Correction 1 at the top of this document for the full rationale.
2. **Protocol: defer namespaced migration.** Add all new RPCs as flat tags (`session.create`, `session.list`, `session.get`, `session.rename`, `session.archive`, `session.delete`, `session.resume`, `subscribeSessions`). The `@stavi/protocol` package stays as-is for now. A later phase (out of scope here) will migrate everything to namespaced.
3. **Tunnel mode: wire it up now.** The existing `apps/relay`, `@stavi/crypto` Noise NK types, and `transport-types.ts` `relayUrl`/`PairingPayload` fields must be promoted from dead scaffolding to a working transport. Local and tunnel modes must reach functional parity by the end of the plan. The mobile `StaviClient` must be transport-agnostic above the connection layer.
4. **Session persistence: `bun:sqlite`.** Use Bun's built-in SQLite (no external dep). One database file at `~/.stavi/userdata/stavi.db`. Schema migrations live in `packages/server-core/src/db/migrations/`. All Session, Thread, and Message persistence goes through a thin repository layer — handlers never touch SQL directly.
5. **Bug fixes go in Phase 0.** Five known bugs (listed below) must be fixed before any architectural work begins, in a single focused pass. Phase 0 is the only phase that touches multiple unrelated areas; every later phase has a single tight scope.
6. **Bottom-tab plugin set, drawer behavior, Workspace shell, and AI plugin internals are not changing in this plan** unless a specific phase explicitly says so. Don't redesign the Workspace UI.

## Phase 0 — Cleanup & Truth (must be first)

Fix these five bugs. Each is small, each will sabotage later phases if left alone.

1. **Health endpoint mismatch.** `apps/mobile/src/navigation/ConnectScreen.tsx` `pingServer()` calls `/api/health`. The server registers `/health` in `packages/server-core/src/server.ts`. Pick one path (recommend `/health`) and make both sides agree. This is why every saved server shows offline today.

2. **Claude `hasStarted` never set.** In `packages/server-core/src/providers/claude.ts`, `ClaudeSession.hasStarted` is checked to decide whether to pass `resume: sessionId` to the SDK, but it's never set to `true` after the first turn. Fix the lifecycle so multi-turn conversations actually carry history. Add a unit test or an integration assertion that proves a second turn sees the first turn's context.

3. **`instanceThreadBindings` stale entries.** `apps/mobile/src/plugins/core/ai/hooks/useOrchestrationActions.ts` has a module-level `Map<instanceId, threadId>` that is never cleaned. On server reconnect, stale entries point to threadIds that no longer exist on the server. Add: (a) snapshot reconciliation that drops bindings whose threadIds are not in the latest snapshot, (b) a clear on disconnect.

4. **`subscribeTerminalEvents` is a global broadcast.** `packages/server-core/src/handlers/terminal.ts` sends every terminal session's output to every subscriber. Add a per-subscription filter so a subscriber only receives events for terminals it has explicitly subscribed to (by `threadId` and/or `terminalId`). This is a privacy and correctness fix that becomes critical the moment Sessions exist.

5. **Terminal key collision on empty `threadId`.** `packages/server-core/src/context.ts` keys terminals as `${threadId}:${terminalId}`. If `threadId` is empty, all such terminals collapse to `":default"` and silently share a PTY. Make `threadId` required at the type level for terminal operations, and reject the RPC if it's missing or empty.

6. **Directory rename for plugin scope.** Move plugin source files into the new layout that Correction 3 specifies:

   * `apps/mobile/src/plugins/core/` → `apps/mobile/src/plugins/workspace/`
   * `apps/mobile/src/plugins/extra/` → `apps/mobile/src/plugins/server/` (keeping only `processes`, `ports`, `monitor` here)
   * Move `explorer` to a new `apps/mobile/src/plugins/shared/explorer/`
   * Move `search` to `apps/mobile/src/plugins/workspace/search/` and rename it `workspace-search` in code and in its `PluginDefinition.id`. Add a placeholder `apps/mobile/src/plugins/server/system-search/` that registers but renders "Coming in a later phase."
   * Update every import path. Update `apps/mobile/src/plugins/load.ts`. Update `usePluginRegistry`'s persisted IDs migration: any persisted tab pointing at a renamed plugin id is migrated on hydration.
   * This rename produces no new features. It exists so every later phase can reference the new paths without a confusing "old layout vs new layout" footnote.

Phase 0 produces no user-visible features. It produces a green baseline. Do not advance until Phase 0 is verified.

## Phase 1 — Server-side Session model (foundation, no UI)

Goal: introduce the Session as a first-class server-side object, persisted in SQLite, exposed via `session.*` RPCs. Do NOT touch the mobile app in this phase except for the type definitions in `@stavi/shared`.

Deliverables:

* **`packages/server-core/src/db/`** — new directory.

  * `index.ts` — opens `~/.stavi/userdata/stavi.db`, runs migrations on startup, exports a singleton `db` handle.
  * `migrations/0001_initial.sql` — schema for `sessions`, `threads`, `messages`. Threads gain a `session_id` foreign key. Messages gain `thread_id` (already implicit, now explicit in the DB).
  * `migrations/runner.ts` — simple forward-only migration runner that tracks applied migrations in a `_migrations` table.
* **`packages/server-core/src/repositories/`** — new directory.

  * `session-repo.ts` — `createSession`, `listSessions`, `getSession`, `updateSession`, `archiveSession`, `deleteSession`, `touchSession` (updates `lastActiveAt`). All take and return plain objects, never raw rows.
  * `thread-repo.ts` — `createThread(sessionId, ...)`, `listThreadsForSession`, `getThread`, `updateThread`, `deleteThread`. The existing in-memory `ctx.threads: Map` becomes a write-through cache populated from this repo on startup.
  * `message-repo.ts` — `appendMessage`, `listMessagesForThread`, `replaceMessage` (for streaming completion). Likewise becomes a write-through cache for `ctx.messages`.
* **`packages/server-core/src/types.ts`** — add `Session` interface: `{ id, serverId, folder, title, agentRuntime, status: 'idle'|'running'|'errored'|'archived', lastActiveAt, createdAt, updatedAt, metadata? }`. The `serverId` is generated once per server install and lives in `~/.stavi/userdata/credentials.json` next to the bearer token (extend the existing file).
* **`packages/server-core/src/handlers/session.ts`** — new file. Implements all `session.*` flat tags:

  * `session.create` `{ folder, title?, agentRuntime? }` → returns the new Session. **Does NOT create a Thread.** The Session starts with zero Threads. A Thread is created lazily by `orchestration.dispatchCommand({ type: 'thread.create', sessionId, ... })` the first time the AI plugin needs one inside this Session. The `orchestration.dispatchCommand` handler must accept a `sessionId` field on `thread.create` and write it to the new `threads.session_id` column.
  * `session.list` `{ includeArchived? }` → returns all Sessions sorted by `lastActiveAt` desc.
  * `session.get` `{ sessionId }` → returns one Session along with its Threads (which may be an empty array).
  * `session.rename` `{ sessionId, title }`
  * `session.archive` `{ sessionId }` → soft delete, sets status='archived'.
  * `session.delete` `{ sessionId }` → hard delete, cascades to Threads and Messages.
  * `session.touch` `{ sessionId }` → updates `lastActiveAt` (called by client when user opens a Session).
  * `subscribeSessions` `{}` → chunk stream of Session lifecycle events (`created`, `updated`, `archived`, `deleted`).
* **`packages/server-core/src/server.ts`** — wire the new tags into the flat switch. Session events broadcast on the same fan-out helpers used today.
* **`packages/server-core/src/handlers/orchestration/turn-start.ts`** — when a turn starts on a Thread, the parent Session's `lastActiveAt` and `status` must update.
* **Migration of existing in-memory state** — on first run with the new schema, any existing in-memory threads (there won't be any, since the server doesn't persist today) are ignored. A "default" Session is NOT auto-created. Mobile clients must explicitly create Sessions. A Session created via `session.create` starts with zero Threads. The AI plugin creates Threads inside a Session lazily — see Correction 1.
* **`packages/shared/src/domain-types.ts`** — add the `Session` type so mobile can import it.

Phase 1 is verified by: starting the server, calling `session.create` via a test client, restarting the server, calling `session.list`, and seeing the Session come back intact with zero Threads; then creating a first Thread via the AI/orchestration path and verifying it persists across restart with the correct `session_id`.

## Phase 2 — Mobile Sessions Home + plugin scope split

Goal: replace the current ConnectScreen-as-root with a Sessions Home screen, AND introduce the workspace/server plugin scoping that everything else depends on. These two changes are bundled because the Sessions Home screen is the surface that exposes server-scoped plugins, and the scoping infrastructure must exist before that surface can render correctly.

### Part A — Sessions Home screen

* **New screen `apps/mobile/src/navigation/SessionsHomeScreen.tsx`** — the new app root. Shows:

  * Top bar: app title, settings gear, "+ New Session" button.
  * For each connected Server: a section header showing server name, status dot, connection menu (disconnect/forget/edit), and a **Tools button** (LayoutGrid icon) on the right side of the header that opens the server-scoped plugins sheet for that server.
  * Under each server section header: a list of Sessions on that Server sorted by `lastActiveAt` desc. Each Session row shows title, folder (truncated middle if too long), agent type icon, lastActiveAt relative time, and a status dot. Tap a row to enter the Workspace for that Session.
  * Below the connected Servers: a "Saved Servers" section listing servers that aren't currently connected, with a Connect button.
  * Empty states: no servers → "Add your first server" with a big add button; servers connected but no sessions on a server → "Start a new session" inline.
* **`apps/mobile/src/stores/sessions-store.ts`** — new Zustand store. Holds `sessionsByServer: Map<serverId, Session[]>`. Subscribes to `subscribeSessions` for every connected server. Reconciles on connect/disconnect/snapshot.
* **`apps/mobile/src/stores/connection.ts`** — extended to support multiple simultaneous connections. Today it has one `activeConnection`; it needs `connectionsById: Map<serverId, ConnectionState>`. Each connection has its own `StaviClient` instance. The "active" concept moves to "the Session the user is currently viewing" (in WorkspaceScreen), not "the one server we're connected to."
* **`apps/mobile/src/stores/stavi-client.ts`** — must become instantiable per-server (it already is a class, but the singleton assumption in callers must go). No more `getClient()`-as-global. Every caller obtains a client via `useConnectionStore.getState().getClientForServer(serverId)`.
* **`apps/mobile/src/navigation/ConnectScreen.tsx`** — repurposed as "Add Server" sheet. Reachable from SessionsHome → "+" button → "Add Server", and from the empty state. Not the app root anymore.
* **New component `apps/mobile/src/components/NewSessionFlow.tsx`** — bottom sheet with three steps: (1) pick server (skip if only one connected), (2) pick folder via existing `DirectoryPicker`, (3) pick title and agent (Claude / Codex). On confirm, calls `session.create` on the chosen server's client, then navigates to Workspace with the new sessionId.
* **`apps/mobile/src/App.tsx`** — root navigator changes. New stack: `SessionsHome` (initial) → `Workspace` → `Settings`. ConnectScreen is no longer in the stack; it's a sheet over SessionsHome.

### Part B — Plugin scope split (workspace vs server)

This part introduces the `PluginDefinition.scope` field and the corresponding store, context, and UI infrastructure. It does NOT yet move plugin source files (that's done in Phase 0's directory rename). It wires the scope concept through everything that consumes plugins.

* **`packages/shared/src/plugin-types.ts`** — add required field `scope: 'workspace' | 'server'` to `PluginDefinition`. Existing plugins must declare their scope. Initial assignments:

  * `ai`, `editor`, `terminal`, `git`, `browser` → `'workspace'`
  * `processes`, `ports`, `monitor` → `'server'`
  * `explorer` → `'workspace'`
  * `search` → split: rename the existing one to `workspace-search` (`'workspace'` scope, searches the Session's folder) and create a new `system-search` (`'server'` scope, searches the whole machine). For Phase 2, only the rename happens; system-search is a stub that says "Coming in a later phase."
* **`apps/mobile/src/stores/plugin-registry.ts`** — `openTabs` becomes scope-aware. Workspace-scoped plugins persist as `workspaceTabsBySession: Map<sessionId, PluginInstance[]>`. Server-scoped plugins do NOT persist as tabs at all — they're opened on demand as sheets, not as persistent tabs.
* **New store `apps/mobile/src/stores/server-plugins-store.ts`** — for each `serverId`, holds the per-plugin state for server-scoped plugins. Reference-counted subscriptions: when the first consumer opens Processes for server X, subscribe to `subscribeProcessEvents` on X's client; when the last consumer closes it, unsubscribe. Same pattern for ports and monitor.
* **New component `apps/mobile/src/components/ServerToolsSheet.tsx`** — bottom sheet that takes a `serverId` and renders a tabbed view of server-scoped plugins for that server (Processes / Ports / Monitor / System Search stub). Used by:

  * The Tools button on each server section header in SessionsHomeScreen.
  * The bottom-bar Tools button inside WorkspaceScreen (which passes `serverId = currentSession.serverId`).
* **`apps/mobile/src/components/PluginBottomBar.tsx`** — when rendered inside a Workspace, the bottom bar shows only `scope === 'workspace'` plugins as tabs. The Tools button opens `ServerToolsSheet` with the current Session's serverId.
* **`apps/mobile/src/components/PluginRenderer.tsx`** — when rendering a workspace-scoped plugin, passes `session: Session` as a prop. When rendering a server-scoped plugin (inside the sheet), passes `serverId: string` instead. A plugin component declares which props it expects via TypeScript on its component signature.

### Verification

Phase 2 is verified by:

1. Launching the app cold, seeing the Sessions Home, adding two servers (one local, one fake/offline).
2. Creating a Session via the New Session flow on the local server.
3. Force-quitting and relaunching — the Session is still listed.
4. Tapping the Tools button on the local server's section header → ServerToolsSheet opens with Processes/Ports/Monitor tabs, and Processes shows real data.
5. Closing the sheet, opening the Session, tapping the Tools button in the Workspace's bottom bar → the same ServerToolsSheet opens (NOT a different instance), with the same Processes data already loaded (no re-fetch).
6. Verifying via console logs that there is exactly ONE active `subscribeProcessEvents` subscription on the server while either entry point is open, and ZERO when both are closed.

## Phase 3 — Workspace becomes Session-bound + back navigation

Goal: WorkspaceScreen takes a `sessionId` param, and the Home button navigates back to SessionsHome WITHOUT disconnecting.

Deliverables:

* **`apps/mobile/src/navigation/WorkspaceScreen.tsx`** —  accepts `route.params.sessionId`. On mount: calls `session.touch`, loads the Session's Threads (which may be empty). If the Session has no Threads, the AI plugin renders its empty/welcome state and creates the first Thread lazily on the user's first message. If the Session has one or more Threads, the AI plugin's active Thread is set to the most recently active one.
* **`apps/mobile/src/components/DrawerContent.tsx`** — Home button no longer calls `disconnect()`. It calls `navigation.navigate('SessionsHome')`. The Session and its Threads stay alive on the server. WebSocket stays connected.
* **`apps/mobile/src/stores/plugin-registry.ts`** — `openTabs` must be scoped per Session, not global. Today they persist globally to AsyncStorage; now they persist as `openTabsBySession: Map<sessionId, PluginInstance[]>`. When the user opens a different Session, they see that Session's tabs.
* **`apps/mobile/src/plugins/core/ai/hooks/useOrchestrationActions.ts`** — `instanceThreadBindings` is now scoped per Session, not global. Recommend moving it into a Session-scoped store rather than a module-level Map.
* **`apps/mobile/src/plugins/core/terminal/`** — terminal sessions are now bound to the active Session's first Thread by default. The terminal key collision fix from Phase 0 makes this safe.
* **Hardware back button (Android)** — from Workspace, goes to SessionsHome, does not exit the app.
* **Remove every folder picker call site outside the New Session flow.** The DirectoryPicker component continues to exist, but it is only invoked from `NewSessionFlow.tsx`. Search for every other call site and delete the prompt — the plugin must use `session.folder` directly. Specifically:

  * `apps/mobile/src/navigation/WorkspaceScreen.tsx` — remove the directory picker that triggers when an AI or Editor tab is opened. Plugins receive the Session's folder as a prop.
  * `apps/mobile/src/plugins/workspace/ai/index.tsx` (after Phase 0 rename) — delete the "select a folder" empty state. The AI plugin always has a folder via `session.folder`.
  * `apps/mobile/src/plugins/workspace/editor/index.tsx` — same. The Editor opens with `session.folder` as its tree root.
* **Workspace plugins receive `session: Session` as a prop.** Update `PluginRenderer.tsx` and every workspace-scoped plugin component to accept and use this prop. Workspace-scoped plugins must NOT read from any global "current folder" state — only from their `session` prop.
* **Terminal `cwd` defaults to `session.folder`.** In `apps/mobile/src/plugins/workspace/terminal/index.tsx`, the `terminal.open` RPC must pass `cwd: session.folder` when creating a new terminal tab. The user can override per-tab if they want, but the default is the Session's folder.

Phase 3 is verified by:

1. Creating Session A on `~/projects/foo`, opening the AI plugin → no folder picker appears, the AI is ready to chat immediately and any Thread it creates is bound to `~/projects/foo`.
2. Opening the Terminal plugin → a new terminal tab is already running with `pwd` showing `~/projects/foo`.
3. Navigating Home (drawer → Home), creating Session B on `~/projects/bar`, opening its Terminal plugin → the new terminal shows `~/projects/bar`. Session A's terminal is NOT visible.
4. Navigating Home again, reopening Session A → its terminal is still there with the original `pwd`, the AI plugin still has the same Threads, the Editor still has the same open files.
5. Confirming via grep that there are zero call sites of `DirectoryPicker` outside `NewSessionFlow.tsx`.

## Phase 4 — Acode-style Editor (file tree + CodeMirror tabs)

Goal: replace the read-only plain-text fallback with a real mobile code editor: a left-side file tree rooted at the Session's folder, a tabbed editor area on the right, CodeMirror 6 in a WebView for the editing surface. Inspired by Acode (`com.foxdebug.acode`). This is the largest phase in the plan and should be implemented in two halves.

This phase has two sub-phases. They can be merged into one PR or split into two; the executor decides based on size.

### Phase 4a — File tree, tabs, and the open-via-event plumbing (no real editor yet)

Deliverables:

* **`apps/mobile/src/plugins/workspace/editor/components/FileTree.tsx`** — left-side file tree component.

  * Root is `session.folder`.
  * Lazy-loaded folder children via `fs.list`. Cache children per folder; invalidate on file operations.
  * Tap a folder to expand/collapse. Tap a file to emit `eventBus.emit('editor.openFile', { sessionId, path })`.
  * Long-press to open a context menu with: New File, New Folder, Rename, Delete, Duplicate, Copy Path, Open in Terminal Here.
  * Header row with: Refresh, Collapse All, Show/Hide Hidden Files toggle, Find File button (opens a modal fuzzy search via `fs.search`).
  * On phones, the tree is collapsed by default and slides in from the left edge of the Editor panel via a button in the editor toolbar. On tablets (or wide screens), it stays pinned open.
  * Visual style: matches the existing theme tokens. No borders; background layering for depth; mint accent for selected items.
* **`apps/mobile/src/plugins/workspace/editor/components/EditorTabs.tsx`** — horizontal tab bar above the editor area.

  * One tab per open file. Active tab highlighted with mint accent.
  * Unsaved changes shown as a dot next to the filename instead of the close button.
  * Long-press tab → context menu: Close, Close Others, Close All, Close to the Right.
  * Horizontal scroll if many tabs are open.
* **`apps/mobile/src/plugins/workspace/editor/store.ts`** — per-Session editor state store: `openFilesBySession: Map<sessionId, OpenFile[]>`, `activeFileBySession: Map<sessionId, string>`. Persisted via the Phase 3 `workspaceTabsBySession` mechanism.
* **`apps/mobile/src/plugins/workspace/editor/index.tsx`** — the Editor plugin component. Composes `<FileTree />` + `<EditorTabs />` + a placeholder `<EditorSurface />` (which Phase 4b will replace with CodeMirror). The placeholder shows the file's plain text content (using the existing fallback).
* **`apps/mobile/src/services/event-bus.ts`** — confirm the event bus supports the `editor.openFile` event. Add it if missing. Document the event contract in a comment.
* **New fs RPCs as needed**: `fs.create` (touch a new file or mkdir a new folder), `fs.rename`, `fs.delete`. If they don't exist on the server today (per the recon, they might be partial — verify), add them in `packages/server-core/src/handlers/fs.ts`. Each is a thin wrapper around Node `fs` operations.
* **Hidden files toggle** — `fs.list` today filters `HIDDEN_DIRS` server-side. Add a `showHidden?: boolean` parameter; when true, the filter is bypassed. The file tree owns the toggle state.

Verification of 4a:

1. Open a Session, open the Editor — the file tree is visible (or accessible via a button on phones), rooted at the Session's folder.
2. Expand folders, tap a file — it opens as a tab and shows its content (still the plain-text fallback at this point).
3. Long-press a file → Rename → it renames on the server and the tree updates.
4. Long-press a folder → Open in Terminal Here → switches to the Terminal plugin and a new terminal tab is open with that folder as `pwd`.
5. Open three files, navigate Home, reopen the Session — same three tabs are restored, same active tab selected.

### Phase 4b — CodeMirror 6 in WebView

Deliverables:

* **`apps/mobile/assets/editor/`** — new directory containing a static HTML bundle that hosts CodeMirror 6.

  * `index.html` — minimal HTML page that loads the CodeMirror bundle.
  * `bundle.js` — CodeMirror 6 with these language packs: TypeScript, JavaScript (incl. JSX), Python, Markdown, JSON, HTML, CSS, Rust, Go, Java, Swift, Kotlin, Bash, YAML, TOML, plus a generic fallback. Bundled via esbuild as a one-time build step (committed to the repo as a binary artifact — not built at app build time, to keep mobile builds fast). Document the rebuild command in a `README.md` in this directory.
  * The bundle must support: load content, get content, undo/redo, find/replace, set theme, listen for change events, listen for cursor position, listen for save shortcut.
* **`apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx`** — replaces the Phase 4a placeholder. Renders a `WebView` pointing at the bundled `index.html`. Implements a postMessage bridge with these methods (in both directions):

  * JS → Web: `loadFile(path, content, language)`, `setTheme(theme)`, `requestContent()`, `find()`, `undo()`, `redo()`, `format()`.
  * Web → JS: `contentChanged(content, dirty)`, `cursorMoved(line, col)`, `saveRequested()`, `ready()`.
* **Save flow**: a save button in the Editor toolbar calls `requestContent()` → receives content → calls `fs.write` → updates the OpenFile's `dirty` flag to false. Auto-save is OFF by default; user can enable in Settings.
* **Editor toolbar** — small toolbar above the tabs (or below, designer's choice): Save (with dirty indicator), Undo, Redo, Find, Format (if available for current language), File Tree toggle (on phones).
* **Theme** — the editor theme matches the app's dark theme. Use the existing color tokens. Bundle a single theme initially.
* **Binary file handling**: when the user opens a binary file (detect via extension list), show a "Binary file, X bytes" placeholder card with an "Open externally" button instead of loading the WebView.
* **Performance**: only one WebView instance for the entire Editor plugin — switching tabs calls `loadFile()` rather than mounting a new WebView.

Verification of 4b:

1. Open a `.ts` file → syntax highlighting works.
2. Edit the file → the dirty dot appears on the tab.
3. Tap save → file is saved on the server, dirty dot disappears, `git status` (in the Git plugin) shows the file as modified.
4. Switch tabs → the previous file's content is preserved, the new file's content loads.
5. Open a 50,000-line file → it loads in under 2 seconds and scrolls smoothly.
6. Open a binary file (e.g. a PNG) → the binary placeholder appears, no WebView crash.

### Edges and gotchas for Phase 4

* **WebView / native bridge race**: the WebView's `ready()` event must fire before any `loadFile()` call. Queue calls until ready.
* **Large files**: don't send 50MB strings across the bridge in one chunk. Chunk above some threshold (1MB), or refuse to open.
* **Path handling**: always use absolute paths server-side, even if displayed as relative to `session.folder` in the UI.
* **The hidden files toggle is a tree concern, not a Session concern** — don't persist it per Session unless the user asks for that.
* **CodeMirror language detection**: do it by extension, not content sniffing. Keep a clear extension → language map in one file.
* **Don't bundle every language pack in CodeMirror's full distribution** — that's >5MB. Use a curated subset (the list above) and a `StreamLanguage` fallback for unknown extensions.
* **Don't put the file tree inside the Workspace's left drawer.** The Workspace drawer is for per-tool sub-tabs (AI threads, terminal sessions). The Editor's file tree is its own slide-in inside the Editor panel. They are different drawers with different jobs.

### Out of scope for Phase 4 (deferred)

* Multi-cursor / multi-select edits
* LSP / language server integration
* Inline AI suggestions in the editor
* Diff view (a Phase 7+ concern; the Git plugin already handles diffs in its own surface)
* Split editor / side-by-side
* Drag-to-reorder tabs (nice to have, can be Phase 7 polish)

## Phase 5 — Multi-server support end-to-end

Goal: a user can add two servers, connect to both simultaneously, see Sessions from both in the home screen, and switch between them seamlessly.

Deliverables:

* **`apps/mobile/src/stores/connection.ts`** — finish the multi-connection refactor started in Phase 2. Connections reconnect independently, their states are tracked independently.
* **`SessionsHomeScreen`** — server sections render in the order servers were added. Connection status dots per server. Tap server header to expand/collapse its sessions.
* **`SavedConnection` type in `packages/shared/src/transport-types.ts`** — already has `id`, no changes needed; verify nothing assumes single-server.
* **Server identity** — when mobile connects to a server, server returns its `serverId` in `server.getConfig`. Mobile binds the SavedConnection to that serverId. If the same server is added twice (different host but same serverId), they're deduplicated.
* **Cross-server safety** — every Session-related RPC includes the implicit serverId via the connection it was sent on. Sessions cannot leak between servers in any code path.

Phase 5 is verified by: adding two servers (e.g., laptop + desktop), connecting to both, creating one Session on each, seeing both in the home screen under their respective server headers, opening one then the other without disconnecting either.

## Phase 6 — Tunnel mode (E2E encrypted remote)

Goal: promote the existing dead scaffolding to a working transport. Local and tunnel modes reach functional parity.

Deliverables:

* **`packages/crypto/src/`** — implement Noise NK using a small audited library (`@stablelib/x25519` + `@stablelib/chacha20poly1305` + a Noise framework wrapper, or a single Noise lib if one is healthy on npm). Export a clean `NoiseSession` API: `initiate()`, `respond()`, `encrypt(plaintext)`, `decrypt(ciphertext)`. The interface types already exist; this phase fills them in.
* **`apps/relay/src/index.ts`** — verify it still works with the implemented crypto. Add a health check endpoint. Document the wire protocol in a header comment.
* **`apps/cli/src/index.ts`** — `stavi serve` gets a `--relay <url>` flag. When set, the server opens a persistent connection to the relay, registers a room, and accepts encrypted WebSocket-over-relay traffic in addition to direct local WebSocket.
* **Pairing flow** — `stavi serve --relay <url>` prints a QR code (use `qrcode-terminal`) containing a `PairingPayload` with relayUrl, roomId, ephemeral pubkey, bearer token. Mobile scans, decodes, completes the Noise handshake, and connects.
* **Mobile QR scanner** — new screen `apps/mobile/src/navigation/PairServerScreen.tsx` using `react-native-vision-camera` (or whatever is already in the deps; check first). Reachable from "Add Server" sheet alongside manual entry.
* **`apps/mobile/src/stores/stavi-client.ts`** — transport abstraction. `StaviClient` accepts a `Transport` interface (`send`, `onMessage`, `close`). Two implementations: `LocalWebSocketTransport` (today's behavior) and `RelayTransport` (Noise-encrypted via relay). Above the transport, the RPC logic is identical.
* **Tunnel status in UI** — Sessions Home shows a small icon next to each server indicating local vs tunnel.

Phase 6 is verified by: running the server with `--relay`, scanning the QR with mobile from a different network, creating a Session, sending an AI message, and seeing it work identically to local mode. Wireshark capture of relay traffic shows only ciphertext.

## Phase 7 — Polish and verification

Goal: small, high-leverage cleanup that locks in the new architecture before further feature work.

* Loading and error states for every new screen.
* Reconnection UX: when a server drops, its Sessions section greys out; when it comes back, it auto-resumes.
* Empty states reviewed against the new mental model (no Sessions yet, no servers yet, server unreachable).
* Telemetry hooks (just console logs for now, structured) for Session create/open/close.
* A `docs/MENTAL-MODEL.md` document explaining Session/Thread/Server/Connection/Workspace in one page, written for an AI agent landing in the codebase cold.
* The bulk file manager Explorer plugin's UI (multi-select, batch ops, metadata surface, workspace search, open-in-editor / open-in-terminal actions), per Correction 5.

## Codebase Legibility Rules (apply to every phase)

These rules are NOT optional and are NOT separate from feature work. The Sonnet executor must follow them as it implements each phase.

1. **Every new file gets a header comment.** Format:

   ```ts
   // WHAT: One sentence describing what this file is.
   // WHY:  Why it exists / what problem it solves.
   // HOW:  Key dependencies and the contract it exposes.
   // SEE:  Related files an agent should read alongside this one.
   ```

   Existing files touched by a phase get a header added if they don't have one.

2. **No file over 400 lines.** If a phase would push a file past 400 lines, split it. Splits must be along a clear seam (e.g., one file per RPC handler, one file per repository, one file per screen's sub-components).

3. **Repositories are the only place that touches SQL.** Handlers call repositories. Repositories return plain objects. No SQL strings outside `packages/server-core/src/repositories/` and `packages/server-core/src/db/`.

4. **One RPC handler per file** for new handlers (Phase 1's `session.ts` is the exception — it's small enough to stay together at first; split if it grows past 300 lines).

5. **No new module-level mutable state** in mobile. The `instanceThreadBindings` Map is the cautionary example. New shared state goes in Zustand stores.

6. **Every new RPC tag is documented** in `docs/PROTOCOL.md` with request shape, response shape, and one-sentence purpose, in the same phase that adds it.

7. **No clever abstractions.** If a Sonnet instance reading the file in isolation would have to jump to three other files to understand what's happening, the abstraction is too clever. Prefer a long obvious function to a short clever one.

8. **Tests are not required for this plan**, but every phase must end with a written manual verification script in `plans/<phase>-verify.md` that a human can run in under five minutes.

9. **Plugin scope is declared explicitly.** Every `PluginDefinition` MUST set `scope: 'workspace' | 'server'`. There is no default. Workspace-scoped plugin components MUST accept a `session: Session` prop and MUST NOT read from any global "current folder" or "current session" state. Server-scoped plugin components MUST accept a `serverId: string` prop and MUST NOT accept a `session` prop. This is enforced via TypeScript: the `PluginDefinition.component` field is a discriminated union on `scope`. A reviewer (human or AI) seeing a workspace plugin reach for global state should treat it as a bug.

## What you must produce

Produce one document, `plans/00-master-plan.md`, structured as follows:

1. **Executive summary** (10 lines max).
2. **Mental model diagram** (ASCII or nested list — Server → Connection → Session → Thread → Message, with the mobile-side parallel of Connection → SessionsHome → Workspace → Drawer).
3. **For each phase (0 through 7):**

   * **Goal** — one paragraph.
   * **Files touched** — full list with paths, marked `NEW` / `MODIFIED` / `DELETED`.
   * **Order of operations** — numbered steps a Sonnet executor follows in order. Each step references specific files and specific changes. No step should require design judgment.
   * **Contracts and shapes** — exact TypeScript type definitions for any new type, exact request/response shapes for any new RPC, exact SQL for any new schema. No "TBD" anywhere.
   * **Edges and gotchas** — anything you anticipate could trip the executor, listed up front.
   * **Verification script** — the contents of `plans/<phase>-verify.md`. Step-by-step manual test, expected outputs, pass/fail criteria.
4. **Risks and unknowns** — things you couldn't decide from the recon and need a human answer on before that phase can start. If there are zero, say zero. Be honest.
5. **Out of scope (explicit list)** — things a reader might expect to find in this plan but are deliberately deferred. iOS terminal, CodeMirror editor, voice mode, server discovery via Bonjour, namespaced protocol migration, anything else not above.

## Constraints on your output

* **Do not write production code.** You may write type definitions, SQL schemas, and example RPC payloads inside the plan as specifications. You may NOT write implementation bodies.
* **Do not skip phases or merge them.** The phasing is load-bearing.
* **Do not propose alternative architectures.** The decisions in "Decisions already made" are final for this plan.
* **Do not pad.** If a phase is small, the section is short.
* **Read before you plan.** Before writing the plan, read these files in this order: `packages/server-core/src/server.ts`, `packages/server-core/src/context.ts`, `packages/server-core/src/handlers/orchestration/index.ts`, `packages/server-core/src/handlers/orchestration/turn-start.ts`, `packages/server-core/src/providers/claude.ts`, `packages/server-core/src/providers/codex.ts`, `packages/server-core/src/handlers/terminal.ts`, `packages/server-core/src/handlers/fs.ts`, `packages/shared/src/domain-types.ts`, `packages/shared/src/transport-types.ts`, `apps/cli/src/index.ts`, `apps/relay/src/index.ts`, `packages/crypto/src/`, `apps/mobile/src/App.tsx`, `apps/mobile/src/navigation/ConnectScreen.tsx`, `apps/mobile/src/navigation/WorkspaceScreen.tsx`, `apps/mobile/src/components/DrawerContent.tsx`, `apps/mobile/src/components/DirectoryPicker.tsx`, `apps/mobile/src/stores/stavi-client.ts`, `apps/mobile/src/stores/connection.ts`, `apps/mobile/src/stores/plugin-registry.ts`, `apps/mobile/src/stores/session-registry.ts`, `apps/mobile/src/plugins/core/ai/index.tsx`, `apps/mobile/src/plugins/core/ai/useOrchestration.ts`, `apps/mobile/src/plugins/core/ai/hooks/useOrchestrationActions.ts`, `apps/mobile/src/plugins/core/terminal/index.tsx`, `apps/mobile/src/plugins/extra/explorer/`, `apps/mobile/src/plugins/extra/processes/`, `apps/mobile/src/plugins/extra/ports/`, `apps/mobile/src/plugins/extra/monitor/`, `apps/mobile/src/plugins/extra/search/`, `apps/mobile/src/plugins/core/editor/`, `apps/mobile/src/services/event-bus.ts`. If a file has materially diverged from what the recon described, note it in "Risks and unknowns" rather than guessing. Specifically inspect: how the current Editor plugin handles "open file," whether it has any tree component at all, and whether the existing Explorer plugin shares any code with it (it shouldn't, but verify).

Begin by writing the file `plans/00-master-plan.md`. Do not output the plan in chat — write it to the file.

