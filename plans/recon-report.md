# Stavi Codebase Reconnaissance Report

## Part 1 — Repo Shape

### Directory tree (depth 3, excluding noise)

```
stavi/
├── apps/
│   ├── cli/src/          — CLI entry point (index.ts, network.ts)
│   ├── mobile/src/       — React Native app
│   │   ├── components/   — DrawerContent, DirectoryPicker, PluginBottomBar, PluginHeader, PluginRenderer, TerminalToolbar, NativeTerminal
│   │   ├── navigation/   — ConnectScreen, WorkspaceScreen, SettingsScreen
│   │   ├── plugins/
│   │   │   ├── core/     — ai, browser, editor, git, terminal
│   │   │   └── extra/    — explorer, monitor, ports, processes, search
│   │   ├── services/     — event-bus.ts, gpi.ts
│   │   ├── stores/       — connection.ts, plugin-registry.ts, session-registry.ts, stavi-client.ts
│   │   └── theme/
│   └── relay/src/        — Zero-knowledge binary relay server (index.ts)
├── packages/
│   ├── crypto/src/       — Noise NK interface types only (no implementation)
│   ├── protocol/src/     — Namespaced RPC message constructors (unused — see Part 11)
│   ├── server-core/src/
│   │   ├── handlers/     — git, fs, terminal, system, process, server-config, orchestration/
│   │   ├── providers/    — claude.ts, codex.ts, registry.ts, types.ts
│   │   └── context.ts, server.ts, types.ts, utils.ts
│   └── shared/src/       — domain-types.ts, gpi-types.ts, plugin-types.ts, plugin-events.ts, transport-types.ts
├── plans/
└── docs/
```

### Package inventory

| Package | Path | Purpose | Build step? |
|---|---|---|---|
| `stavi` (CLI) | `apps/cli` | `npx stavi serve` entry point; delegates to server-core | No (tsx direct) |
| `stavi-mobile` | `apps/mobile` | React Native app — IDE UI | Yes (Metro/Gradle) |
| `stavi-relay` | `apps/relay` | Binary WebSocket relay for E2E tunnel mode | No (Bun direct) |
| `@stavi/server-core` | `packages/server-core` | Bun WebSocket RPC server — all handler logic | No (Bun direct) |
| `@stavi/shared` | `packages/shared` | Types shared between mobile and server | No |
| `@stavi/protocol` | `packages/protocol` | Namespaced RPC message constructors + enumerations (aspirational, unused) | No |
| `@stavi/crypto` | `packages/crypto` | Noise NK interface types (no implementation) | No |

### Entry points

- **Server CLI:** `apps/cli/src/index.ts` → `stavi serve [cwd]`, calls `startStaviServer()` from `@stavi/server-core`
- **Mobile app root:** `apps/mobile/src/App.tsx`
- **Relay daemon:** `apps/relay/src/index.ts` (standalone Bun process, no CLI wrapper)

---

## Part 2 — Mental Model

### a. Server

- **Where:** `packages/server-core/src/server.ts` + `context.ts`
- **Data shape:** `StaviServer = { bearerToken, port, host, stop() }`; internal state in `ServerContext` (plain object, not a class)
- **Lifecycle:** Created by `startStaviServer(options)`, torn down by `server.stop()`.
- **Persisted where:** Bearer token → `~/.stavi/userdata/credentials.json`. Runtime address → `~/.stavi/userdata/server-runtime.json` (deleted on stop). Everything else (threads, messages, terminals, managed processes) is in-process heap.

### b. Connection (mobile ↔ server WebSocket)

- **Where (mobile):** `stores/stavi-client.ts` (`StaviClient` class) + `stores/connection.ts` (Zustand wrapper)
- **Where (server):** `wss.on('connection')` in `server.ts:221`; subscriptions tracked in `ctx.connectionSubscriptions: Map<WebSocket, Set<requestId>>`
- **Data shape (mobile):** `StaviClientState = 'disconnected' | 'authenticating' | 'connecting' | 'connected' | 'reconnecting'`; `SavedConnection = { id, name, host, port, bearerToken, tls?, createdAt, lastConnectedAt? }`
- **Lifecycle:** Auth flow: bearer token → POST `/api/auth/ws-token` → WS upgrade with `?wsToken=`. WS tokens are 15-minute one-shot. On disconnect: all server subscriptions cleaned up; client schedules exponential-backoff reconnect (7 attempts, 1s–64s).
- **Persisted:** `savedConnections` array → AsyncStorage key `stavi-connection`. Active connection state is transient.
- **Rediscovery on reopen:** Saved connections reloaded from AsyncStorage. No auto-connect on launch; user must tap.

### c. Session (unit of agent work)

- **Exists as first-class server object?** No. No `Session` type exists on the server. Closest is `OrchestrationThread` (see e).
- **On mobile:** `session-registry.ts` has a `useSessionRegistry` Zustand store, but this is purely a UI-layer concept — a registry of drawer sidebar entries populated by plugins. It does NOT correspond to any server-side entity.

### d. Project / Working directory

- **Where (server):** `ctx.workspaceRoot: string` — set once at startup from `options.cwd`, never changes at runtime.
- **Where (per-thread):** `OrchestrationThread.worktreePath: string | null` — can differ per thread, set at thread creation time.
- **Lifecycle:** `workspaceRoot` is static for the server process lifetime. `worktreePath` on a thread is set at `thread.create` time and not updated after.
- **Mobile side:** When opening an AI or Editor tab, `WorkspaceScreen` triggers `DirectoryPicker`, which uses `fs.list` RPC to browse. Selected path stored in `PluginInstance.initialState.directory` and passed as `worktreePath` in the thread create command.
- **Survives reconnect?** `workspaceRoot` survives (it's a process arg). Thread's `worktreePath` is in-memory only — lost on server restart.

### e. Thread (AI conversation)

- **Where (server):** `ctx.threads: Map<string, OrchestrationThread>` and `ctx.messages: Map<string, OrchestrationMessage[]>` in `context.ts`
- **Data shape:** `OrchestrationThread = { threadId, projectId, title, runtimeMode, interactionMode, branch, worktreePath, modelSelection?, archived, createdAt, updatedAt }`
- **Lifecycle:** Created by `orchestration.dispatchCommand` with `type:'thread.create'`. No server RPC to delete (only mobile-side event handler reacts to `thread.deleted`). Messages accumulate in heap.
- **Persisted:** No. In-memory only. Lost on server restart.
- **Rediscovery:** On reconnect, mobile calls `orchestration.getSnapshot` which returns all in-memory threads. If server restarted, snapshot is empty.

### f. Workspace (screen with AI/Editor/Term/Git/Browser/Tools)

- **Where:** `navigation/WorkspaceScreen.tsx` — single screen hosting drawer + plugin panels + bottom bar
- **Lifecycle:** Navigated to from `ConnectScreen` on successful connect. Only left via drawer → Home (which also disconnects).
- **Persisted:** Not persisted. Tab/plugin state persisted via `usePluginRegistry` to AsyncStorage key `stavi-plugin-registry`.

### g. Plugin (panel inside the workspace)

- **Where:** `stores/plugin-registry.ts`; definitions in `plugins/core/*/index.tsx` and `plugins/extra/*/index.tsx`
- **Data shape:** `PluginDefinition = { id, name, description, kind, icon, component, navOrder?, allowMultipleInstances?, ... }`. Runtime instance: `PluginInstance = { id, pluginId, title, status, error?, initialState? }`
- **Lifecycle:** Definitions registered at boot (`plugins/load.ts`). Tabs (instances) created by `openTab()`, persisted to AsyncStorage. Extra/multi-instance tabs can be closed; singleton core tabs cannot.
- **Persisted:** `openTabs` and `activeTabId` → AsyncStorage key `stavi-plugin-registry`.

### Reconnect / rediscovery summary

| Concept | Survives server restart | Survives mobile app close | How client rediscovers |
|---|---|---|---|
| workspaceRoot | Yes (process arg) | N/A | `server.getConfig` returns `cwd` |
| Threads & messages | **No** | N/A | `orchestration.getSnapshot` (empty after restart) |
| Terminal sessions | **No** | N/A | Must reopen |
| Plugin tabs (mobile) | N/A | Yes (AsyncStorage) | Hydrated from `stavi-plugin-registry` |
| Saved connections (mobile) | N/A | Yes (AsyncStorage) | Hydrated from `stavi-connection` |
| Active connection state | N/A | **No** | User must tap to reconnect |

---

## Part 3 — RPC Surface

The server uses a flat string-tag protocol. Wire format: `{ _tag: "Request", id, tag, payload }` → `{ _tag: "Chunk"/"Exit", requestId, ... }`. (This differs from `@stavi/protocol`'s namespaced format — see Part 11.)

### Terminal domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `terminal.open` | `{ threadId, terminalId, cwd?, cols?, rows? }` | `Exit.Success { threadId, terminalId, history, status }` | Open/reattach PTY session | `handlers/terminal.ts:11` |
| `terminal.write` | `{ threadId, terminalId, data }` | `Exit.Success { ok }` | Write bytes to PTY | `handlers/terminal.ts:26` |
| `terminal.resize` | `{ threadId, terminalId, cols, rows }` | `Exit.Success { ok }` | Resize PTY | `handlers/terminal.ts:39` |
| `terminal.close` | `{ threadId, terminalId }` | `Exit.Success { ok }` | Kill and delete PTY | `handlers/terminal.ts:51` |
| `subscribeTerminalEvents` | `{}` | Chunk stream of `{ type, threadId, terminalId, data }` | Subscribe to ALL terminal output (no per-session filter) | `handlers/terminal.ts:63` |

**Flag:** `subscribeTerminalEvents` broadcasts events from ALL terminal sessions to ALL subscribers — a client sees every session's output.

### Git domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `git.status` | `{}` | `Exit.Success { branch, ahead, behind, staged, unstaged, untracked }` | One-shot status; also pushes to active subscribers | `handlers/git.ts:13` |
| `git.refreshStatus` | `{}` | Same as `git.status` | Exact alias | `handlers/git.ts:22` |
| `git.stage` | `{ paths: string[] }` | `Exit.Success { ok }` | Stage files | `handlers/git.ts:31` |
| `git.unstage` | `{ paths: string[] }` | `Exit.Success { ok }` | Unstage files | `handlers/git.ts:43` |
| `git.commit` | `{ message }` | `Exit.Success { ok, output }` | Commit staged changes | `handlers/git.ts:54` |
| `git.diff` | `{ path?, staged? }` | `Exit.Success { diff }` | Stat/numstat diff | `handlers/git.ts:64` |
| `git.diffFile` | `{ path, staged? }` | `Exit.Success { diff }` | Full unified diff for one file | `handlers/git.ts:79` |
| `git.log` | `{ limit? }` | `Exit.Success { commits }` | Commit log | `handlers/git.ts:96` |
| `git.branches` | `{}` | `Exit.Success { branches }` | Branch list | `handlers/git.ts:117` |
| `git.checkout` | `{ branch, create? }` | `Exit.Success { ok }` | Checkout/create branch | `handlers/git.ts:137` |
| `git.push` | `{ force? }` | `Exit.Success { ok, output }` | Push | `handlers/git.ts:150` |
| `git.pull` | `{ rebase? }` | `Exit.Success { ok, output }` | Pull | `handlers/git.ts:162` |
| `git.discard` | `{ paths: string[] }` | `Exit.Success { ok }` | Discard changes | `handlers/git.ts:174` |
| `subscribeGitStatus` | `{}` | Chunk stream of git status objects | Poll-push every 4s | `handlers/git.ts:190` |

### AI / Orchestration domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `orchestration.getSnapshot` | `{}` | `Exit.Success { snapshotSequence, threads, projects }` | Full current state | `handlers/orchestration/index.ts:15` |
| `orchestration.dispatchCommand` | `{ command: { type, threadId, ... } }` | `Exit.Success { ok / thread }` | Handles `thread.create`, `thread.turn.start`, `thread.turn.interrupt`, `thread.approval.respond` | `handlers/orchestration/index.ts:19` |
| `subscribeOrchestrationDomainEvents` | `{}` | Chunk stream of event objects | Subscribe to all orchestration events | `handlers/orchestration/index.ts:93` |

### Filesystem domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `fs.read` | `{ path }` | `Exit.Success { content }` | Read file | `handlers/fs.ts:30` |
| `fs.write` | `{ path, content }` | `Exit.Success { ok }` | Write file | `handlers/fs.ts:36` |
| `fs.list` | `{ path }` | `Exit.Success { path, entries }` | List directory | `handlers/fs.ts:51` |
| `fs.search` | `{ query, limit? }` | `Exit.Success { entries, content? }` | Search files by name glob | `handlers/fs.ts:98` |
| `fs.grep` | `{ pattern, glob?, limit? }` | `Exit.Success { matches }` | Ripgrep search | `handlers/fs.ts:123` |
| `projects.writeFile` | `{ path, content }` | `Exit.Success { ok }` | Alias for `fs.write` (legacy t3code compat) | `handlers/fs.ts:44` |
| `projects.searchEntries` | `{ query, limit? }` | Same as `fs.search` | Alias for `fs.search` (legacy t3code compat) | `handlers/fs.ts:111` |

### System domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `system.processes` | `{}` | `Exit.Success { processes }` | OS process list via `ps` | `handlers/system.ts:12` |
| `system.ports` | `{}` | `Exit.Success { ports }` | Listening ports via `lsof`/`ss`/`netstat` | `handlers/system.ts:40` |
| `system.stats` | `{}` | `Exit.Success { disk, memRaw }` | Disk/memory stats | `handlers/system.ts:75` |

### Managed Process domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `process.spawn` | `{ command, args?, cwd? }` | `Exit.Success { id, pid, status, ... }` | Spawn a managed Bun subprocess | `handlers/process.ts:11` |
| `process.kill` | `{ id }` | `Exit.Success { ok }` | SIGTERM + remove | `handlers/process.ts:31` |
| `process.list` | `{}` | `Exit.Success { processes }` | List managed processes | `handlers/process.ts:48` |
| `process.clearOutput` | `{ id }` | `Exit.Success { ok }` | Clear buffered output | `handlers/process.ts:53` |
| `process.remove` | `{ id }` | `Exit.Success { ok }` | Kill (if running) + delete | `handlers/process.ts:63` |
| `subscribeProcessEvents` | `{}` | Chunk stream of `{ type, id, ... }` | Subscribe to process lifecycle events | `handlers/process.ts:74` |

### Server Config domain

| Tag | Request payload | Response | Purpose | File:line |
|---|---|---|---|---|
| `server.getConfig` | `{}` | `Exit.Success { cwd, providers }` | Server's workspaceRoot + provider info | `handlers/server-config.ts:11` |
| `server.getSettings` | `{}` | `Exit.Success { anthropicApiKey (masked), ... }` | Provider settings | `handlers/server-config.ts:18` |
| `server.updateSettings` | `{ anthropicApiKey?, defaultProvider?, defaultModel?, codexBinaryPath? }` | `Exit.Success { ok, providers }` | Update and refresh providers | `handlers/server-config.ts:28` |
| `server.refreshProviders` | `{}` | `Exit.Success { providers }` | Re-probe provider readiness | `handlers/server-config.ts:43` |

**Flag:** `@stavi/protocol` defines an entirely different namespaced protocol (`{ v:1, id, ns, action, payload }`) with `NamespaceActions` and `Subscriptions` constants. This format is **not** what the server speaks. The server uses the original `_tag: "Request"` flat-tag format. The protocol package is unused dead code or an unfinished migration.

---

## Part 4 — State Stores (mobile)

### Zustand stores

| Store | File | What it holds | Persists? | AsyncStorage key | Transient fields |
|---|---|---|---|---|---|
| `useConnectionStore` | `stores/connection.ts` | `state`, `activeConnection`, `savedConnections`, `error` | Partial | `stavi-connection` | `state`, `activeConnection`, `error` |
| `usePluginRegistry` | `stores/plugin-registry.ts` | `definitions`, `openTabs`, `activeTabId`, `isReady` | Partial | `stavi-plugin-registry` | `definitions`, `isReady` |
| `useSessionRegistry` | `stores/session-registry.ts` | `registrations: Record<pluginId, SessionRegistration>` | No | — | All |

### Module-level mutable maps

| Symbol | File | What it holds |
|---|---|---|
| `componentRegistry: Map<string, ComponentType>` | `stores/plugin-registry.ts:83` | Plugin React components (excluded from Zustand serialization) |
| `instanceThreadBindings: Map<string, string>` | `plugins/core/ai/hooks/useOrchestrationActions.ts:10` | instanceId → server threadId; survives re-renders, lost on app restart |

### AsyncStorage keys

| Key | Owner | Contents |
|---|---|---|
| `stavi-connection` | `useConnectionStore` | `{ savedConnections: SavedConnection[] }` |
| `stavi-plugin-registry` | `usePluginRegistry` | `{ openTabs: PluginInstance[], activeTabId: string \| null }` |

No other AsyncStorage keys found.

---

## Part 5 — Navigation and Screen Graph

### Screens

| Screen | Route | How you get there |
|---|---|---|
| `ConnectScreen` | `Connect` | Default/initial screen; also from WorkspaceScreen drawer → Home button (+ disconnect) |
| `WorkspaceScreen` | `Workspace` | `navigation.navigate('Workspace')` after successful connect |
| `SettingsScreen` | `Settings` | From WorkspaceScreen drawer → Settings button |

### Navigation graph

```
[App Launch]
      │
      ▼
ConnectScreen  ─── connect success ──►  WorkspaceScreen
      ▲                                       │
      └──── drawer → Home (+ disconnect) ◄────┤
                                              │
                                    SettingsScreen  (← back)
```

### From WorkspaceScreen → "list of sessions / list of servers"

**One path:** Open drawer (hamburger in `PluginHeader`) → tap **Home** → calls `handleNavigateHome()` which calls `disconnect()` then `navigation.navigate('Connect')`.

No gesture-only path, no swipe-from-edge, no deep links. Navigating Home **explicitly disconnects** the WebSocket.

### Left-side drawer

- **Trigger:** Hamburger icon in `PluginHeader`. Animated slide-in from left (82% of screen width, max 340px). Closed by tapping scrim.
- **Contents (`DrawerContent.tsx`):**
  - If active plugin has sessions (AI/terminal): plugin name header → search bar → per-plugin session list → create button
  - If active plugin is in `HIDE_SESSIONS_FOR` (git, browser, editor, explorer, search, monitor, ports, processes): branding block (icon + name + description)
  - Always at bottom: **Home** button, **Settings** button, connection status dot
- **Scope:** Global to the workspace — shows sessions for whichever plugin is currently active.

---

## Part 6 — Plugin / Tool / Sidebar Confusion

### Bottom bar (PluginBottomBar)

Shows core plugins with `navOrder` set (Terminal, AI, Editor, Git, Browser), plus a **"Tools"** button (LayoutGrid icon) that opens a bottom sheet listing all `kind: 'extra'` plugins: Explorer, Search, Processes, Ports, Monitor.

### Left drawer (DrawerContent)

Contextual to the active plugin. Shows per-plugin "sessions" (AI threads, terminal instances) registered via `useSessionRegistry`. For non-session plugins, shows a branding block. **Not a global plugin list.**

### Multi-session tabs for the current tool

- AI plugin: multiple threads listed in drawer session list. User switches by tapping a session.
- Terminal plugin: same pattern (registers sessions to drawer via `useSessionRegistry`).
- **Rendered location:** Drawer sidebar only — not tabs inside the panel content area.

### "Plugins" list vs bottom tab bar

- Bottom tab bar: core plugins with `navOrder` (Terminal, AI, Editor, Git, Browser).
- "Plugins" / Tools sheet (opened via **Tools** button): `kind: 'extra'` plugins — Explorer, Monitor, Ports, Processes, Search.
- These are the items visible in screenshots as "Explorer / Monitor / Ports / Processes / Search."
- All registered at boot in `plugins/load.ts` but no `navOrder`, so they don't appear in the main nav.

---

## Part 7 — Server-side Session and Directory State

**1. CWD separate from launch cwd?**
Partial. `ctx.workspaceRoot` is fixed at launch. BUT `OrchestrationThread.worktreePath` can be a different directory per-thread. Both terminal sessions and the Claude adapter use `thread.worktreePath` if set. No runtime-mutable global cwd.

**2. terminal.open cwd:**
`terminal.open` reads `payload.cwd` (defaults to `.`), resolves it against `workspaceRoot`. Client CAN override it with an absolute or relative path.

**3. AI thread cwd:**
`turn-start.ts:106` passes `cwd: updatedThread.worktreePath ?? ctx.workspaceRoot` to `adapter.sendTurn()`. Per-thread — yes.

**4. Persistence across server restarts:**
**No.** All state is in-process heap. Nothing written to disk except bearer token and runtime-state JSON (host/port/pid).

---

## Part 8 — Provider System

### ClaudeAdapter (`packages/server-core/src/providers/claude.ts`)

- **Conversation history storage:** In-process `sessions: Map<string, ClaudeSession>`. `ClaudeSession` holds `queryRuntime` (SDK `query()` return), `sessionId` (UUID), `hasStarted`, `pendingApprovals`. Message history lives inside the SDK subprocess, not in explicit server-side arrays.
- **Per-thread vs global:** One `ClaudeSession` per `threadId`. Strict 1:1.
- **If WebSocket disconnects mid-turn:** The async streaming loop in `turn-start.ts` is NOT tied to the WebSocket. It continues, pushing events via `broadcastOrchestrationEvent` to whatever subscribers exist. If no subscribers, events are silently dropped. Mobile will miss all events from the disconnected period — no replay. Streaming message stays `streaming: true` in the server's `messages` map until turn completes.

### CodexAdapter (`packages/server-core/src/providers/codex.ts`)

- **Conversation history:** Per-thread session map. Uses JSON-RPC over a spawned `codex app-server` subprocess.
- **Per-thread vs global:** 1:1 per threadId.
- **If WebSocket disconnects mid-turn:** Same as Claude — turn continues, events go to empty subscriber set, permanently lost.

---

## Part 9 — AI Agent Legibility Audit

### 1. `apps/mobile/src/plugins/core/ai/index.tsx` (839 lines)

- **Responsibilities:** Full AI chat panel UI; FlashList with AIPart-based message rendering; approval card rendering; composer toolbar; model/config popover; session registration with drawer; thread creation.
- **Header comment:** Yes (brief).
- **Safe to modify in isolation?** Partially. Depends on `useOrchestration` return shape, `AIMessage`/`AIPart` types, and `useSessionRegistry` protocol.
- **Gotcha:** The "thinking" indicator item is appended to the render list based on three separate derived conditions scattered across the component (last message streaming, no pending approvals, provider supports thinking). No single place encapsulates "is the AI currently thinking."

### 2. `apps/mobile/src/stores/stavi-client.ts` (567 lines)

- **Responsibilities:** WebSocket lifecycle; bearer → wsToken auth flow; one-shot request/response with timeout; streaming subscriptions with auto-resubscribe on reconnect; exponential backoff.
- **Header comment:** Yes — explains wire format and auth flow.
- **Safe to modify in isolation?** Yes — well-encapsulated.
- **Gotcha:** `_sendSubscription()` at line 505 calls `this.ws!.send()` with a `!` non-null assertion but no readyState check. If called during a reconnect race (socket assigned but not yet OPEN), it will throw.

### 3. `apps/mobile/src/navigation/ConnectScreen.tsx` (572 lines)

- **Responsibilities:** List saved servers with ping status; add/remove connections; connect flow with loading state; dev-config shortcut.
- **Header comment:** Yes.
- **Safe to modify in isolation?** Yes.
- **Gotcha:** `pingServer()` at line 41 hits `/api/health`. The actual server health endpoint is `/health` (no `/api` prefix) — `server.ts:160`. Every ping will return offline for any server running current code.

### 4. `apps/mobile/src/plugins/core/ai/useOrchestration.ts` (525 lines)

- **Responsibilities:** Snapshot fetch + subscription setup; event stream processing (reducer pattern); thread/message/activity/approval state; RAF-batched coalescing updates; thread creation via `ensureActiveThread`.
- **Header comment:** Yes.
- **Safe to modify in isolation?** No. `instanceThreadBindings` (module-level Map in `useOrchestrationActions.ts`) binds plugin tab instanceId to server threadId — invisible in this file.
- **Gotcha:** The `useEffect` for subscription setup depends on `[connectionState, instanceId, processEvent]`. `processEvent` depends on `processEventInner` which depends on `[instanceId]`. Every new AI tab instance causes the subscription to tear down and re-init, firing an extra `getSnapshot` + `getConfig` round trip.

### 5. `packages/server-core/src/context.ts` (450 lines)

- **Responsibilities:** `ServerContext` interface; all subscription maps; broadcast helpers; orchestration snapshot; managed process spawner; terminal session creator; git polling lifecycle.
- **Header comment:** Yes.
- **Safe to modify in isolation?** Mostly yes. Broadcast helpers are fire-and-forget with no backpressure — touching fan-out logic affects all subscriber paths.
- **Gotcha:** Terminal sessions are keyed as `${threadId}:${terminalId}` (line 373). If `threadId` is empty string (client omits it), all such terminals share the key `":default"` — two clients opening a terminal without a threadId silently share the same PTY session.

---

## Part 10 — Gaps vs Target Vision

Target: "Home screen = list of running sessions grouped by server. Session = (server, folder, agent state, history). Connect to N servers, each with M sessions. Mobile is a viewer; closing it doesn't kill sessions. Navigate back to home without losing state."

| Capability | Status | Justification | File where it would live |
|---|---|---|---|
| Server-side Session object with id, serverId, folder, createdAt, lastActiveAt, agent type, status | **Missing** | `OrchestrationThread` has some fields but no `serverId`, no `lastActiveAt`, no explicit `status`, not called Session | `packages/server-core/src/types.ts` |
| SessionStore (server) with create/list/get/rename/archive/delete/resume | **Missing** | Threads are in a plain `Map`; no list/rename/archive/delete RPCs exist | `packages/server-core/src/handlers/session.ts` (new) |
| `session.*` RPC family | **Missing** | No `session.*` tags in any handler | `packages/server-core/src/handlers/session.ts` (new) |
| `fs.listDirectory` RPC for directory picker | **Present** | `fs.list` exists and is used by `DirectoryPicker` | `packages/server-core/src/handlers/fs.ts:51` |
| Mobile `DirectoryPickerSheet` | **Present** | `apps/mobile/src/components/DirectoryPicker.tsx` (459 lines, functional) | already exists |
| Mobile `SessionsHomeScreen` (list of running sessions grouped by server) | **Missing** | `ConnectScreen` lists servers only; no sessions-by-server grouping | `apps/mobile/src/navigation/` (new file) |
| "New Session" flow: server → folder → agent | **Partial** | DirectoryPicker exists; no server-selection step (single server assumed); no agent-selection step | `apps/mobile/src/navigation/WorkspaceScreen.tsx:88` |
| Navigation gesture from Workspace back to SessionsHome | **Partial** | One path exists (drawer → Home) but it disconnects; no preserve-state nav | `apps/mobile/src/navigation/WorkspaceScreen.tsx:65` |
| Per-session cwd that `terminal.open` and `ai.send` respect | **Present** | `OrchestrationThread.worktreePath` passed to both | `context.ts:377`, `handlers/orchestration/turn-start.ts:106` |
| QR-code server pairing | **Missing** | `@stavi/crypto` has Noise NK types; `PairingPayload` type exists; relay exists — but no QR generator, no pairing RPC handler, no mobile scanner UI | needs: `apps/cli/src/index.ts`, new mobile screen |
| Tunnel mode (E2E encrypted remote connection) | **Partial** | Relay binary (`apps/relay`) exists and is complete. `@stavi/crypto` defines Noise NK interface. `SavedConnection.relayUrl` field exists in `transport-types.ts`. But no encryption is implemented in the call path; mobile `StaviClient` has no relay routing | `packages/crypto`, `apps/relay`, `stores/stavi-client.ts` |
| "Multi-tab within current tool" UI in left drawer | **Present** | Drawer shows session list for active plugin; create button creates new session | `apps/mobile/src/components/DrawerContent.tsx` |
| Persistence of sessions across server restarts | **Missing** | All thread/message state is in-process heap | `packages/server-core/src/context.ts` (needs SQLite or file store) |

---

## Part 11 — Things That Surprised Me

1. **`@stavi/protocol` package is effectively unused.** Defines a clean `{ v:1, ns, action, payload }` namespaced protocol with `NamespaceActions` and `Subscriptions` constants — but the server still speaks `{ _tag, tag, payload }`. The mobile client also uses the old format. No callers found. Aspirational refactor sitting unused.

2. **`ConnectScreen` pings the wrong health endpoint.** `pingServer()` at `ConnectScreen.tsx:41` hits `/api/health`. The server registers `/health` (no `/api` prefix) at `server.ts:160`. Every ping returns offline.

3. **`thread.created` event IS now broadcast from server.** `orchestration/index.ts:36`. The plans mention this as a known bug — it is fixed in the current code.

4. **`hasStarted` flag is never set to `true`.** In `claude.ts`, the `ClaudeSession.hasStarted` field is checked at line 369 (`if (session.hasStarted)`) to decide whether to pass `resume: sessionId` to the SDK. But `hasStarted` is initialized `false` and never set to `true` anywhere in the file. Every turn starts as a fresh session — multi-turn conversation history is NOT carried forward. This is likely the "queryRuntime not reset" bug in different form.

5. **`subscribeTerminalEvents` is a global broadcast.** All terminal output from all sessions goes to all subscribers. Two clients both connected will each see the other's terminal output.

6. **`instanceThreadBindings` module-level Map never gets cleaned up on server reconnect.** If the server restarts and the mobile reconnects, stale bindings remain mapping old instanceIds to non-existent threadIds. Init logic checks if the bound threadId is in the snapshot — but stale entries are never removed from the map.

7. **`DirectoryPicker` hides useful directories server-side.** `fs.list` filters `HIDDEN_DIRS` (node_modules, .git, .turbo, dist, build, etc.) — there is no way to navigate into these from the directory picker.

8. **Relay binary is complete but mobile never uses it.** `apps/relay/src/index.ts` is a fully functional E2E relay with room pairing and grace periods. `transport-types.ts` has `PairingPayload.relay` field. But `StaviClient.connect()` accepts a `config.tls` flag and nothing else — no relay routing is implemented on the client side.

9. **`process.spawn` and `terminal.open` are parallel concepts with no bridge.** `process.spawn` = non-interactive Bun subprocess with buffered output. `terminal.open` = interactive PTY. Processes plugin uses spawn; terminal plugin uses PTY. No way to attach an interactive terminal to a managed process.

10. **`auth` namespace declared in `@stavi/protocol` but never implemented.** Lists `['validate', 'pair', 'revoke', 'listSessions']`. None handled by any server handler. Only actual auth is the out-of-band bearer token exchange over HTTP.
