# Stavi — Complete Application Flow

> Written as a definitive architectural reference. Every subsystem, every data path, every state transition — documented end-to-end.

---

## 1. The Mental Model

**The server is the brain. The mobile app is a dumb display.**

The CLI runs a Bun-powered server that owns all state: sessions, threads, messages, terminals, file operations, git, AI agent loops. The mobile app is a thin React Native client that renders server state and forwards user input. If the app crashes, nothing is lost. If the server restarts, chat history survives (SQLite), terminal sessions survive (tmux), and the app reconnects seamlessly.

One device runs one server. One server manages multiple project workspaces. Multiple apps can connect to the same server (though currently single-client).

---

## 2. CLI Startup (`apps/cli/src/index.ts`)

```
User runs: npx stavi
         └─or─ npx stavi --relay wss://relay.stavi.dev
```

### Boot sequence:

1. **Resolve `STAVI_HOME`** → `~/.stavi/` (created if missing)
2. **Read or generate credentials** → `userdata/credentials.json`:
   - `serverId`: `randomUUID()` (stable across restarts)
   - `bearerToken`: `sk-stavi-<36 hex chars>` (stable across restarts)
3. **Read or generate Noise keypair** → `userdata/server-keypair.json`:
   - X25519 key pair for E2E encrypted relay transport
4. **Start the Bun HTTP/WS server** on `0.0.0.0:3773` (default)
5. **Initialize SQLite** → `userdata/stavi.db` with migrations:
   - `sessions` — workspace metadata (folder, title, status, agent_runtime)
   - `threads` — AI conversation threads per session
   - `messages` — individual messages per thread (role, text, turn_id, streaming flag)
6. **Create server context** (`createServerContext()`) — loads all threads + messages from DB into memory Maps for fast access
7. **Write runtime state** → `userdata/server-runtime.json` (pid, host, port, startedAt) for other tools to discover
8. **Print banner**:
   - **LAN mode**: prints `http://<local-ip>:3773` + bearer token
   - **Relay mode**: prints relay URL + generates QR code via `qrcode-terminal` encoding a `PairingPayload`:
     ```json
     { "relay": "wss://relay.stavi.dev", "roomId": "...", "serverPublicKey": "...", "token": "sk-stavi-...", "lanHost": "192.168.1.x", "port": 3773 }
     ```

### Server endpoints:

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Returns `{ status, version, uptime, cwd }` |
| `POST /api/auth/ws-token` | Exchanges bearer token → short-lived `ws-stavi-*` token (15-min TTL) |
| `WS /ws?wsToken=<token>` | Authenticated WebSocket connection (token consumed on use) |

---

## 3. Mobile App Boot (`apps/mobile/`)

### Entry sequence:

1. **`index.js`** → registers `App` component
2. **`App.tsx`** → `import './plugins/load'` (side-effect: registers all plugins)
3. **Plugin registration** (`plugins/load.ts`):

   | Plugin | Scope | Kind | ID |
   |--------|-------|------|----|
   | Terminal | workspace | core | `terminal` |
   | AI | workspace | core | `ai` |
   | Editor | workspace | core | `editor` |
   | Git | workspace | core | `git` |
   | Browser | workspace | core | `browser` |
   | Explorer | shared | extra | `explorer` |
   | Processes | shared | extra | `processes` |
   | Ports | shared | extra | `ports` |
   | System Monitor | shared | extra | `monitor` |
   | Search | shared | extra | `search` |
   | Tools | shared | extra | `tools` |

4. **Navigation mount**: React Navigation `NativeStackNavigator`:
   - `SessionsHome` — flat workspace list (home screen)
   - `PairServer` — QR scanner for relay pairing
   - `Workspace` — the main workspace view (plugins + bottom bar)
   - `Settings` — app settings

5. **Auto-connect**: `useConnectionStore.autoConnectSavedServers()` connects to all saved servers on mount
6. **Hydrate sessions**: `useSessionsStore.hydrateConnectedServers()` fetches workspace lists from connected servers
7. **Persist rehydration**: Zustand `persist` middleware rehydrates `sessionsByServer` from AsyncStorage → user sees cached workspaces instantly, before server reconnects

---

## 4. Pairing Flow

### QR Code (relay mode):

1. User opens `PairServerScreen` → camera activates via `react-native-vision-camera`
2. Scans QR → decodes base64url → parses `PairingPayload`
3. Calls `useConnectionStore.addServer()` with extracted details
4. Server saved to `savedConnections` (persisted via Zustand + AsyncStorage)
5. `connectServer()` called → establishes relay transport (see §5)

### Manual entry (LAN mode):

1. User enters host + port + bearer token
2. Same `addServer()` → `connectServer()` flow, but uses direct WebSocket

---

## 5. Connection & Transport Layer

### Connection Store (`stores/connection.ts`)

Per-server runtime state:
```
savedConnections: SavedConnection[]     // persisted
clientState: Map<serverId, 'idle' | 'connecting' | 'connected' | 'error'>
runtimes: Map<serverId, { client: StaviClient }>
```

**Concurrency guard**: `_connectingServers: Map<string, Promise>` prevents duplicate connect calls from `autoConnect` + `hydrate` racing.

### StaviClient (`stores/stavi-client.ts`)

Wraps transport + RPC engine:
- `connectViaTransport(transport)` — closes old transport if replacing, drains pending requests, creates new `ClientEngine`
- `request(tag, payload)` → returns `Promise<response>` (single response RPC)
- `subscribe(tag, payload, onChunk)` → returns unsubscribe function (streaming RPC)
- `disconnect()` → closes transport, drains engine, emits state change

### Transport types:

#### Direct WebSocket
- URL: `ws://<host>:<port>/ws?wsToken=<token>`
- First: `POST /api/auth/ws-token` exchanges bearer token for short-lived WS token
- Plain WebSocket, no encryption (LAN only)

#### Relay + Noise NK (`transports/RelayTransport.ts`)
- URL: `wss://relay.stavi.dev/room/<roomId>?role=mobile&token=<bearer>`
- Handshake:
  1. WS opens → wait for `peer_connected` JSON signal
  2. `initiateHandshake(rnPrimitives, serverPubKey)` → send `HANDSHAKE` frame (Noise NK msg1)
  3. Receive msg2 → `completeHandshake()` → `NoiseSession` established
  4. All subsequent frames: `DATA` type with AEAD encryption
- Frame format: `ST` magic + version byte + type byte + 8-byte nonce (LE) + encrypted payload
- Per-direction nonce counters (no replay)
- Fresh handshake on every reconnect — no session resumption

### RPC Protocol

```
Request:  { _tag: "Request", id: number, tag: string, payload: any }
Response: { _tag: "Exit", id: number, payload: any }           // single response
Chunk:    { _tag: "Chunk", id: number, payload: any }          // streaming
```

---

## 6. Sessions Home Screen (`navigation/SessionsHomeScreen.tsx`)

**What the user sees on app open**: a flat, chronological list of all workspaces across all connected servers — sorted by `lastActiveAt` descending.

### Data flow:
1. `useSessionsStore(useShallow(s => s.sessionsByServer))` → stable reference
2. `useMemo` flattens + sorts → `allWorkspaces: Session[]`
3. Client-side search filters by title + folder substring
4. Pull-to-refresh calls `refreshForServer` on every connected server
5. Tap workspace → `navigation.navigate('Workspace', { sessionId })`

### Empty states:
- No servers → "Add a server to get started" + ServersSheet
- Servers but no workspaces → "No workspaces yet" + New Workspace button
- Search no results → "No results for '<query>'"

### Session creation (`NewSessionFlow` component):
1. User picks server → enters folder path
2. `session.create` RPC → server creates SQLite row + returns `Session`
3. Navigate to `Workspace` screen

---

## 7. Workspace Screen

The main workspace view. Contains:
- **PluginHeader** — shows active plugin name, multi-instance tab strip (hidden when only 1 instance)
- **PluginRenderer** — renders all open plugin instances using opacity-swap pattern:
  - Active: `opacity: 1, pointerEvents: 'auto'`
  - Inactive: `opacity: 0, pointerEvents: 'none', position: 'absolute'`
  - This keeps all plugins mounted (preserving state) while only showing one
- **PluginBottomBar** — 5-icon bottom navigation (terminal, AI, editor, git, browser) + "more" for extras

### Plugin lifecycle:
1. On workspace mount: `initializeSession(sessionId)` in plugin-registry
2. Core plugins auto-open: terminal, AI (scope: workspace, kind: core)
3. Extra plugins opened on demand from "more" menu
4. Each plugin instance gets: `{ sessionId, serverId, instanceId }`
5. Plugin component receives `StaviClient` via context → makes RPC calls directly

---

## 8. Terminal Plugin (`plugins/core/terminal/`)

### Current implementation: xterm.js in WebView

1. **Open terminal**: `terminal.open` RPC → server creates tmux session + node-pty relay
2. **Rendering**: `react-native-webview` loads xterm.js from CDN
3. **Input**: WebView `postMessage` → `terminal.write` RPC → server `tmux send-keys`
4. **Output**: Server streams terminal output via `Chunk` messages → WebView renders
5. **Resize**: `terminal.resize` RPC → server resizes pty
6. **Persistence**: tmux sessions survive server restart. Terminal state survives app restart.

### Planned: Triple terminal architecture (see plans/10-stabilization.md, Step 3)

| Backend | Platform | Rendering | Status |
|---------|----------|-----------|--------|
| WebView (xterm.js) | Android + iOS | Web-based xterm.js in WebView | Current, working |
| Skia GPU | iOS (default) | `@shopify/react-native-skia` Canvas + Text + Rect | Planned, priority |
| Native | iOS (experimental) | SwiftTerm (CoreText UIView) via native module | HIGH RISK, deferred |

Settings will control which backend is active per-platform.

---

## 9. AI Plugin (`plugins/workspace/ai/`)

The most complex plugin. Three layers: UI components → orchestration hook → server provider adapters.

### Initialization (`useOrchestration.ts`):

1. `server.getConfig` → get available AI providers (Claude, Codex)
2. `orchestration.getSnapshot` → bulk load all threads, messages, activities, approvals for this session
3. `subscribeOrchestrationDomainEvents` → streaming subscription for real-time updates
4. Populate local state: `threads`, `messages`, `aiMessages`, `activities`, `approvals`

### Sending a message:

```
User types message
  → useOrchestrationActions.sendMessage(threadId, text)
    → orchestration.dispatchCommand({ type: 'thread.turn.start', threadId, text })
      → Server: orchestration handler
        → ClaudeAdapter.sendTurn() / CodexAdapter.sendTurn()
          → Claude Agent SDK query() / Codex CLI stdio
            → Streams events back:
              text-delta, thinking-delta, tool-use-start/delta/done,
              approval-required, turn-complete, turn-error
```

### Event streaming:

Server broadcasts domain events via the subscription:
- `thread.message-sent` — new/updated message (RAF-batched via coalescer)
- `thread.activity-appended` — tool use, thinking block (RAF-batched)
- `thread.approval-response-requested` — tool needs user approval
- `thread.token-usage` — token consumption stats
- `thread.created` — new thread created

### Approval flow:

1. Provider adapter yields `approval-required` event with `requestId`, `toolName`, `toolInput`
2. Server holds a `pendingApprovals` Map with `{resolve, toolName, toolInput}`
3. Client shows approval UI → user taps Allow/Deny
4. `orchestration.dispatchCommand({ type: 'thread.approval.respond', requestId, decision })`
5. Server resolves the pending Promise → adapter continues or skips the tool

### Thread model:

```typescript
Thread {
  id, sessionId, title,
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access',
  interactionMode: 'default' | 'plan',
  agentRuntime: 'claude' | 'codex',
  model, branch, worktreePath
}
```

### Provider adapters (server-side):

#### Claude (`packages/server-core/src/providers/claude.ts`)
- Uses `@anthropic-ai/claude-code` SDK's `query()` function
- AsyncGenerator streams SDK events → mapped to stavi event types
- Session state: `ClaudeSession { sessionId, queryRuntime, hasStarted, pendingApprovals, aborted }`
- `hasStarted` flag → enables `resume: sessionId` for multi-turn
- Known bugs: see plans/11-ai-layer-comparison.md (9 bugs, 2 critical)

#### Codex (`packages/server-core/src/providers/codex.ts`)
- Spawns `codex` CLI as child process, communicates via JSON-RPC over stdio
- Notifications: `turn/started`, `turn/completed`, `turn/content`, `turn/tool_call`
- Known bug: `turn/completed` with `status: 'error'` emits turnComplete instead of turnError

---

## 10. Editor Plugin (`plugins/core/editor/`)

- **Rendering**: CodeMirror 6 in a WebView
- **File open**: `fs.read` RPC → content loaded into CodeMirror
- **Save**: CodeMirror change → `fs.write` RPC
- **Features**: Syntax highlighting, line numbers, search/replace
- **Language support**: Inferred from file extension → CodeMirror language pack

---

## 11. Git Plugin (`plugins/core/git/`)

Full git operations via RPC:

| RPC Tag | Action |
|---------|--------|
| `git.status` | Working tree status |
| `git.stage` | Stage files |
| `git.unstage` | Unstage files |
| `git.commit` | Create commit |
| `git.diff` / `git.diffFile` | View diffs |
| `git.log` | Commit history |
| `git.branches` | List branches |
| `git.checkout` | Switch branch |
| `git.push` / `git.pull` | Remote sync |
| `git.discard` | Discard changes |

All operations execute in the session's workspace folder on the server.

---

## 12. Browser Plugin (`plugins/core/browser/`)

- Renders a WebView pointed at a user-specified URL
- Intended for previewing localhost dev servers
- **Current limitation**: Can only access URLs reachable from the phone's network
- **Planned**: Localhost proxy through the server connection (plans/10-stabilization.md, Step 6) — requests to `localhost:*` on the phone are tunneled through the server's network

---

## 13. Explorer Plugin (`plugins/extra/explorer/`)

- File tree browser for the workspace folder
- `fs.list` RPC → directory listing
- Tap file → opens in Editor plugin
- Long-press → rename/delete/move actions via `fs.rename`, `fs.delete`, etc.
- Batch operations: `fs.batchDelete`, `fs.batchMove`, `fs.batchCopy`

---

## 14. Other Plugins

| Plugin | Purpose | Key RPCs |
|--------|---------|----------|
| Search | Filename + content search | `fs.search`, `fs.grep` |
| Processes | Running process manager | `process.spawn/kill/list` |
| Ports | Active port viewer | `system.ports` |
| System Monitor | CPU/memory/disk stats | `system.stats` |
| Tools | Utility tools (zip, etc.) | `fs.zip`, `fs.unzip` |

---

## 15. Persistence Model

### What survives what:

| Event | Terminal | AI Chat | Files | Sessions |
|-------|----------|---------|-------|----------|
| App close/reopen | ✅ (tmux) | ✅ (SQLite + AsyncStorage cache) | ✅ (filesystem) | ✅ (SQLite) |
| Server restart | ✅ (tmux) | ✅ messages (SQLite) | ✅ (filesystem) | ✅ (SQLite) |
| Server restart | — | ❌ AI adapter session (no resume cursor) | — | — |

### Server-side (SQLite):
- **Sessions**: id, folder, title, status, agent_runtime, timestamps
- **Threads**: id, session_id, title, runtime_mode, interaction_mode, model, branch
- **Messages**: id, thread_id, role, text, turn_id, streaming flag, sequence number

### Client-side (AsyncStorage via Zustand persist):
- **Saved connections**: server details, bearer token, relay config
- **Cached sessions**: `sessionsByServer`, `sessionsById` — for instant display before server reconnects

### Gap — AI session recovery:
Currently, if the server restarts, the Claude/Codex adapter sessions (in-memory `ClaudeSession` / `CodexSession` objects) are lost. The user can see old messages but cannot continue the conversation — a new SDK session starts with no context. Fix: persist `sessionId` + last assistant UUID to SQLite → use `resume` option in `query()` on reconnect.

---

## 16. Server RPC Handler Architecture

All handlers registered in `packages/server-core/src/server.ts`:

```
Client Request
  → WS message parsed
    → Route by tag prefix:
        session.*    → handlers/session.ts
        terminal.*   → handlers/terminal.ts
        fs.*         → handlers/fs.ts
        git.*        → handlers/git.ts
        process.*    → handlers/process.ts
        system.*     → handlers/system.ts
        server.*     → handlers/server-config.ts
        orchestration.* → handlers/orchestration/
    → Handler executes (may spawn child process, read DB, call SDK)
    → Response: Exit (single) or Chunk stream (streaming)
```

### Orchestration handler (AI):

```
orchestration.dispatchCommand
  → Parse command type:
      thread.create → create thread in DB, broadcast thread.created
      thread.turn.start → resolve provider adapter, call sendTurn()
        → AsyncGenerator yields events → broadcast as domain events
      thread.turn.interrupt → adapter.interruptTurn()
      thread.approval.respond → resolve pending approval Promise
```

---

## 17. State Architecture (Client)

### Zustand stores:

| Store | Persisted | Purpose |
|-------|-----------|---------|
| `useConnectionStore` | ✅ savedConnections | Server connections, client state, runtimes |
| `useSessionsStore` | ✅ sessionsByServer, sessionsById | Workspace data cache |
| `usePluginRegistry` | ❌ | Plugin definitions, open tabs, active tab per session |
| Per-plugin stores | ❌ | Plugin-specific state (AI messages, terminal buffers, etc.) |

### Data flow pattern:
```
Server (SQLite + in-memory) ← authoritative
  ↕ WebSocket RPC
Client stores (Zustand) ← cache for instant display
  ↕ React hooks
UI components ← pure renderers
```

---

## 18. Security Model

### Authentication:
- Bearer token (`sk-stavi-*`) — long-lived, generated once per server
- WS token (`ws-stavi-*`) — short-lived (15 min), consumed on use, exchanged via bearer token
- Relay: Noise NK encryption (X25519 key exchange, AEAD per-frame)

### Known security issues (see plans/10-stabilization.md, Step 1):
- `fs.read/write/list/search` lack path traversal guards (only `fs.create/rename/delete` use `guardedPath`)
- No `maxPayload` on WebSocket server (DoS risk)
- `/health` endpoint leaks `cwd`
- Unconsumed WS tokens not cleaned up on expiry

---

## 19. What Makes This Different

| vs. | Stavi advantage |
|-----|----------------|
| **SSH + terminal app** | Full IDE experience: AI, editor, git, file explorer — not just a terminal |
| **VS Code Remote** | Native mobile UX, works on phone, no desktop dependency |
| **GitHub Codespaces** | Self-hosted, no cloud dependency, works offline (LAN), E2E encrypted |
| **Lunel** | Cross-platform (iOS + Android), open source, server-persisted state, AI-first |
| **t3code** | Mobile-first (not desktop port), simpler architecture (no Effect-TS), plugin system |

---

## 20. Architecture Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                     MOBILE APP (React Native)                │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Terminal  │  │    AI    │  │  Editor  │  │   Git    │   │
│  │ (WebView/ │  │(Orchestr)│  │(CodeMirror│  │ (Status/ │   │
│  │  Skia)   │  │          │  │ WebView) │  │  Diff)   │   │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
│       │              │              │              │          │
│  ┌────┴──────────────┴──────────────┴──────────────┴────┐   │
│  │              Zustand Stores + StaviClient              │   │
│  └──────────────────────┬───────────────────────────────┘   │
│                         │ WebSocket RPC                      │
└─────────────────────────┼───────────────────────────────────┘
                          │
              ┌───────────┴───────────┐
              │    Direct WS (LAN)    │
              │         OR            │
              │  Relay + Noise NK     │
              │   (E2E encrypted)     │
              └───────────┬───────────┘
                          │
┌─────────────────────────┼───────────────────────────────────┐
│                     SERVER (Bun)                             │
│                         │                                    │
│  ┌──────────────────────┴──────────────────────────────┐    │
│  │                 RPC Router (server.ts)                │    │
│  └──┬──────┬──────┬──────┬──────┬──────┬──────┬────────┘    │
│     │      │      │      │      │      │      │             │
│  session terminal  fs    git  process system orchestration   │
│     │      │      │      │      │      │      │             │
│     │   ┌──┴──┐   │      │      │      │   ┌──┴──────┐     │
│     │   │tmux │   │      │      │      │   │Claude   │     │
│     │   │+pty │   │      │      │      │   │Codex    │     │
│     │   └─────┘   │      │      │      │   │Adapters │     │
│     │             │      │      │      │   └─────────┘     │
│  ┌──┴─────────────┴──────┴──────┴──────┴───────────────┐    │
│  │              SQLite (bun:sqlite)                      │    │
│  │  sessions │ threads │ messages                        │    │
│  └──────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```
