# Stavi Architecture

Mobile IDE for AI Coding Agents.

## System Overview

3 apps + 3 packages in a Turborepo + Yarn 1.x monorepo:

```
stavi/
 ├── apps/
 │   ├── mobile/        React Native 0.85.0 (Hermes, New Arch, Fabric)
 │   ├── server/        Bun WebSocket server, port 8022
 │   └── relay/         Bun zero-knowledge relay, port 9022
 ├── packages/
 │   ├── shared/        Type definitions (raw TS, no build)
 │   ├── protocol/      RPC constructors, namespace/action registries
 │   └── crypto/        Noise NK encryption types + frame helpers
 ├── turbo.json
 └── package.json       Yarn 1.x workspaces root
```

## Data Flow

```
 ┌──────────────────────────────────────────────────────────────────────┐
 │                         MOBILE (React Native)                       │
 │                                                                     │
 │  ┌─────┐ ┌────────┐ ┌──────┐ ┌─────┐ ┌────────┐ ┌───────┐         │
 │  │ AI  │ │Terminal │ │Editor│ │ Git │ │Explorer│ │Search │  ...     │
 │  └──┬──┘ └───┬────┘ └──┬───┘ └──┬──┘ └───┬────┘ └───┬───┘         │
 │     └────────┴────────┬┴────────┴────────┴──────────┘              │
 │                       │ GPI (cross-plugin API)                      │
 │                       ▼                                             │
 │               ┌───────────────┐                                     │
 │               │  Connection   │  Zustand store + RPC + Subscriptions│
 │               │    Store      │                                     │
 │               └───────┬───────┘                                     │
 │                       │ WebSocket                                   │
 └───────────────────────┼─────────────────────────────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │ Direct (LAN) │ Via Relay    │
          ▼              ▼              │
   ┌─────────────┐  ┌──────────┐       │
   │   SERVER     │  │  RELAY   │       │
   │  port 8022   │  │ port 9022│       │
   │              │  │ (blind   │       │
   │  tmux / pty  │  │  forward)├───────┘
   │  fs / git    │  └──────────┘
   │  processes   │
   └──────────────┘
```

## Mobile App Architecture (apps/mobile)

### Plugin System

The plugin system is the heart of the app. Every panel in the workspace is a
plugin — there is no hard-coded screen layout.

```
                      PluginRegistry (Zustand store)
                      ┌──────────────────────────────┐
                      │ definitions: Map<id, PluginDef>│
                      │ instances:   Map<id, Instance>│
                      │ openTabIds:  string[]         │
                      │ activeTabId: string | null    │
                      └──────────┬───────────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
     Component Registry     Tab Lifecycle       MemoizedPanel
     (module-level Map)     register()          opacity-swap
     (outside Zustand —     openTab()           inactive = opacity:0
      components aren't     setActiveTab()         + pointerEvents:none
      serializable)         closeTab()          NEVER unmount
```

**Plugin kinds:**
- `core` — singleton, cannot close: **ai**, **editor**, **terminal**, **git**
- `extra` — closeable: **explorer**, **search**, **processes**, **ports**, **monitor**

**Tab lifecycle:**

```
register → openTab → setActiveTab → closeTab
                          │
                    mountedTabIds ref
                    (mount on first activation,
                     stay mounted forever)
```

**Rendering strategy — opacity-swap:**
- Active panel: `opacity: 1`, receives touch events
- Inactive panels: `opacity: 0`, `pointerEvents: 'none'`
- Panels are NEVER unmounted — preserves WebView DOM, terminal scrollback, etc.
- `MemoizedPanel`: custom `React.memo` comparator prevents re-renders of inactive panels

**Plugin boot:** `plugins/load.ts` imports all 9 plugin definitions and
registers them via `getState().register()`.

### Navigation

```
React Navigation native-stack, dark theme from design tokens

  ConnectScreen (initial, TBD)
        │
        ▼
  WorkspaceScreen
   ├── PluginRenderer     (renders all mounted panels via opacity-swap)
   └── PluginBottomBar    (tab strip for switching plugins)
```

### State Management

| Layer                  | Tool             | Purpose                                           |
|------------------------|------------------|----------------------------------------------------|
| Connection state       | Zustand store    | WebSocket lifecycle, RPC dispatch, subscriptions   |
| Plugin registry        | Zustand store    | Tab definitions, open tabs, active tab             |
| Persistence            | AsyncStorage     | Saved connections, open tabs, active tab           |
| WebSocket instance     | Module singleton  | Single `WebSocket` object, not in any store        |
| Component registry     | Module `Map`     | `Map<string, ComponentType>`, outside Zustand      |
| Pending RPC requests   | Module `Map`     | Correlation ID → {resolve, reject, timer}          |
| Event bus              | Typed pub/sub    | Error-isolated dispatch, last-100 event history    |
| Cross-plugin API       | GPI proxy        | `gPI.terminal.createSession()`, etc.               |

**Event Bus** (`services/event-bus.ts`):
- Typed pub/sub with `PluginEventPayloads` interface
- Each subscriber wrapped in try/catch — one bad listener never breaks others
- Keeps last 100 events in a ring buffer for debugging

**GPI (Global Plugin Interface)** (`services/gpi.ts`):
- Proxy-based: `gPI.terminal.createSession()` → looks up terminal plugin API
- Each plugin registers its API surface; other plugins consume via GPI
- Fully typed via `GPIRegistry` from `packages/shared`

### Connection / Transport

```
┌────────────────────────────────────────────────────────────┐
│                    CONNECTION STORE                         │
│                                                            │
│  state: idle → connecting → authenticating → ready → ...   │
│                                                            │
│  ┌──────────────┐    ┌──────────────┐                      │
│  │  Direct Mode  │    │  Relay Mode  │                      │
│  │  ws://server  │    │  ws://relay  │                      │
│  │  :8022        │    │  :9022/room/ │                      │
│  └──────┬───────┘    └──────┬───────┘                      │
│         └──────────┬────────┘                              │
│                    ▼                                        │
│         ┌─────────────────┐                                │
│         │   RPC Layer      │                                │
│         │   namespace +    │                                │
│         │   action routing │                                │
│         └────────┬────────┘                                │
│                  ▼                                          │
│         ┌─────────────────┐                                │
│         │  Subscriptions   │  5 channels, monotonic seq    │
│         └─────────────────┘                                │
└────────────────────────────────────────────────────────────┘
```

**RPC messages:** Namespaced JSON with auto-incrementing correlation IDs.
- Format: `msg_<timestamp>_<n>` (e.g. `msg_1712847600000_1`)
- 30-second timeout per request, auto-reject on expiry

**Subscription channels** (server-push, monotonic `seq` for replay):
1. `TERMINAL_EVENTS` — output, exit, resize
2. `ORCHESTRATION_EVENTS` — AI agent turns, tool calls
3. `GIT_STATUS` — working tree changes
4. `SYSTEM_MONITOR` — CPU, memory, disk
5. `SERVER_LIFECYCLE` — shutdown, restart

**Reconnect:** Exponential backoff on unexpected close, capped at 30s.

## Server Architecture (apps/server)

Bun WebSocket server. Env: `STAVI_PORT` (default 8022), `STAVI_HOST`.
Currently a skeleton (echo handler). Target architecture:

### RPC Router

```
WebSocket message
     │
     ▼
Parse as RpcMessage
     │
     ▼
Route by namespace + action
     │
     ├── terminal.*  ──→  TerminalService (tmux + pty)
     ├── fs.*        ──→  FsService
     ├── git.*       ──→  GitService
     ├── orchestration.* → OrchestrationService
     ├── process.*   ──→  ProcessService
     ├── system.*    ──→  SystemService
     ├── server.*    ──→  ServerService
     └── auth.*      ──→  AuthService
     │
     ▼
RpcResponse (correlated by request ID)
```

### Namespace Actions (48 total)

| Namespace       | Actions | Details                                                         |
|-----------------|--------:|-----------------------------------------------------------------|
| `terminal`      |       9 | open, close, write, resize, list, attach, detach, kill, scrollback |
| `fs`            |       9 | list, read, write, delete, rename, move, mkdir, stat, search    |
| `git`           |      11 | status, diff, log, stage, unstage, commit, push, pull, branches, checkout, createBranch |
| `orchestration` |       5 | getSnapshot, dispatchCommand, getTurnDiff, getFullThreadDiff, replayEvents |
| `process`       |       4 | list, kill, ports, killByPort                                   |
| `system`        |       2 | info, monitor                                                   |
| `server`        |       4 | getConfig, getSettings, updateSettings, refreshProviders        |
| `auth`          |       4 | validate, pair, revoke, listSessions                            |

### Terminal Service

```
Mobile                      Server
  │                           │
  │  terminal.open ──────────►│──► tmux new-session -d -s <id>
  │  terminal.write ─────────►│──► tmux send-keys -t <id> -l -- <text>
  │  terminal.resize ────────►│──► (pty resize / stty)
  │                           │
  │  ◄── TERMINAL_EVENTS ────│◄── node-pty onData / tmux pipe-pane
  │  (subscription, seq++)    │
```

- tmux for session persistence across reconnects
- node-pty or tmux pipe-pane for output streaming
- Special keys via `tmux send-keys`: Enter, C-c, Tab, Up, Down, Escape

### Health Endpoint

```
GET /health → { status: "ok", version: string, uptime: number }
```

## Relay Architecture (apps/relay)

~150 lines. Fully implemented zero-knowledge binary relay.

```
         Mobile                    Relay (:9022)                  Server
           │                          │                              │
           │  ws:///room/abc?         │                              │
           │  role=mobile&token=xxx  ─┼──► join room "abc"           │
           │                          │    slot: mobile              │
           │                          │                              │
           │                          │  ◄── ws:///room/abc?         │
           │                          │      role=server&token=xxx   │
           │                          │      slot: server            │
           │                          │                              │
           │                          │──► {type:"peer_connected"}──►│
           │  ◄──{type:"peer_connected"}──│                          │
           │                          │                              │
           │  [encrypted frame] ─────►│──► [forward verbatim] ──────►│
           │  ◄──[forward verbatim]───│◄── [encrypted frame]         │
           │                          │                              │
           │  disconnect              │                              │
           │                          │──► 60s grace timer           │
           │                          │    (teardown if no reconnect)│
```

- Two WebSocket slots per room: `server` + `mobile`
- On message: forward raw frame verbatim — relay NEVER decrypts
- On disconnect: 60-second grace timer before room teardown
- Health: `GET /health → { rooms: number, uptime: number }`

## Crypto Layer (packages/crypto)

Noise NK protocol. Types and frame helpers defined; platform-specific
`CryptoPrimitives` implementations TBD.

### Handshake FSM

```
┌──────┐   ClientHello    ┌──────────────────────┐   ServerHello
│ idle │ ────────────────► │ awaiting_server_hello │ ─────────────►
└──────┘                   └──────────────────────┘
                                                      ┌──────────────────────────┐
                                                      │ awaiting_client_confirm  │
                                                      └────────────┬─────────────┘
                                                    ClientConfirm  │
                                     ┌─────────────┐◄─────────────┘
                                     │ established  │
                                     └─────────────┘
                                           │ error at any step
                                           ▼
                                     ┌────────┐
                                     │ failed │
                                     └────────┘
```

5 states: `idle` → `awaiting_server_hello` → `awaiting_client_confirm` → `established` → `failed`

### Frame Format

```
 0      1      2      3         4              11     12+
 ├──────┼──────┼──────┼─────────┼──────────────┼──────────────────┤
 │ 'S'  │ 'T'  │ ver  │  type   │  nonce (8B)  │    payload ...   │
 │      │      │      │         │  LE uint64   │                  │
 └──────┴──────┴──────┴─────────┴──────────────┴──────────────────┘
 ◄──── magic ──►
 ◄──────────── header (12 bytes) ──────────────►
```

Frame types: `HANDSHAKE`, `DATA`, `PING`, `CLOSE`

### CryptoPrimitives Interface

Platform-specific implementations must provide:

| Primitive       | Algorithm             |
|-----------------|-----------------------|
| generateKeypair | X25519                |
| ecdh            | X25519 ECDH           |
| encrypt         | ChaCha20-Poly1305     |
| decrypt         | ChaCha20-Poly1305     |
| hkdf            | HKDF-SHA256           |
| sha256          | SHA-256               |
| randomBytes     | CSPRNG                |

### End-to-End Data Flow

```
Mobile                       Relay                        Server
  │                            │                             │
  │ plaintext                  │                             │
  │   ▼                        │                             │
  │ [Noise NK encrypt]         │                             │
  │   ▼                        │                             │
  │ ciphertext ───────────────►│ forward blind ─────────────►│
  │                            │                             │ ciphertext
  │                            │                             │   ▼
  │                            │                             │ [decrypt]
  │                            │                             │   ▼
  │                            │                             │ plaintext → tmux/fs/git
  │                            │                             │
  │                            │                             │ response plaintext
  │                            │                             │   ▼
  │                            │              forward blind  │ [encrypt]
  │ ◄──────────────────────────│◄────────────────────────────│
  │ ciphertext                 │                             │
  │   ▼                        │                             │
  │ [decrypt]                  │                             │
  │   ▼                        │                             │
  │ plaintext → plugin UI      │                             │
```

## Protocol (packages/protocol)

Message constructors and type guards for the RPC layer.

```typescript
// Construction
createRpcMessage(ns, action, payload)
// → { id: "msg_1712847600000_1", ns, action, payload }

createRpcResponse(request, ok, payload?, error?)
// → { id: request.id, ok, payload?, error? }

// Type guards
isRpcResponse(msg)          // has .ok field
isSubscriptionMessage(msg)  // has .channel + .seq fields

// Registry
NamespaceActions            // exhaustive const record of all valid actions
Subscriptions               // 5 named streaming channels
```

## Shared Types (packages/shared)

No build step. Imported as raw TypeScript via relative paths. 5 type files:

| File                   | Key Exports                                                        |
|------------------------|--------------------------------------------------------------------|
| `plugin-types.ts`      | PluginDefinition, PluginInstance, PluginPanelProps, PluginPermission |
| `plugin-events.ts`     | 25+ named events, PluginEventPayloads interface                    |
| `transport-types.ts`   | ConnectionState (8 states), ConnectionConfig, RpcMessage/Response, PairingPayload |
| `domain-types.ts`      | TerminalSession, FsEntry, GitStatus, AIThread, ProcessInfo, SystemInfo |
| `gpi-types.ts`         | TerminalPluginAPI, EditorPluginAPI, AIPluginAPI, GitPluginAPI, GPIRegistry |

### ConnectionState FSM

```
idle → connecting → authenticating → ready → reconnecting → ...
  │                                    │           │
  ▼                                    ▼           ▼
error                            disconnected    failed
```

8 states: `idle`, `connecting`, `authenticating`, `ready`,
`reconnecting`, `disconnected`, `error`, `failed`

## Monorepo Configuration

### Yarn 1.x Workspaces

```json
// root package.json
{
  "workspaces": {
    "packages": ["apps/*", "packages/*"],
    "nohoist": ["**/react-native", "**/react-native/**"]
  }
}
```

`nohoist` keeps react-native and its transitive deps inside `apps/mobile/node_modules`
so Metro and autolinking can find them.

### Turborepo

```json
// turbo.json — task graph
{
  "build":     { "dependsOn": ["^build"] },
  "dev":       { "persistent": true },
  "typecheck": { "dependsOn": ["^build"] },
  "lint":      {},
  "test":      {},
  "clean":     {}
}
```

### Dependency Resolution

- Root `resolutions` pins react and react-native to single versions (prevents duplicates)
- Metro `resolveRequest` hook in `apps/mobile/metro.config.js` forces react/react-native
  imports from any package to resolve to the app-local copies
- All native dependencies live in `apps/mobile/package.json` (React Native autolinking
  scans only the app's direct dependencies)

### Package Dependency Graph

```
apps/mobile ─────┐
                  ├──► packages/shared
apps/server ─────┤
                  ├──► packages/protocol ──► packages/shared
apps/relay       │
                  └──► packages/crypto   ──► packages/shared
```

`apps/relay` has no package dependencies — it is a standalone binary relay.
