# Stavi — Mental Model

> One-page onboarding guide for new contributors.
> For full details see ARCHITECTURE.md, PROTOCOL.md, and DESIGN.md.

## ASCII Overview

```
┌─────────────────────────────────────────────────────┐
│                   Mobile App (RN)                   │
│                                                     │
│  ┌─────────┐ ┌──────────┐ ┌──────┐ ┌───────────┐   │
│  │ Editor  │ │ Terminal  │ │  AI  │ │  Git/Expl │   │
│  │ plugin  │ │  plugin   │ │plugin│ │  plugins  │   │
│  └────┬────┘ └─────┬─────┘ └──┬───┘ └─────┬─────┘   │
│       │            │          │            │         │
│  ┌────┴────────────┴──────────┴────────────┴─────┐  │
│  │            StaviClient (per-server)            │  │
│  │   RpcEngine · Noise NK · Reconnect · Subs     │  │
│  └────────────────────┬──────────────────────────┘  │
└───────────────────────┼─────────────────────────────┘
                        │ WebSocket (ws:// or Relay)
┌───────────────────────┼─────────────────────────────┐
│                       │                             │
│  ┌────────────────────┴──────────────────────────┐  │
│  │          Stavi Server (Bun/Node)              │  │
│  │   RPC handlers · PTY · FS · Git · AI          │  │
│  └───────────────────────────────────────────────┘  │
│                   Server Machine                    │
└─────────────────────────────────────────────────────┘
```

## Key Definitions

| Term           | Meaning |
|----------------|---------|
| **Server**     | A remote (or local) machine running `stavi-server`. Identified by a persistent UUID. Has a keypair for Noise NK auth. |
| **Connection** | A `StaviClient` instance connected to one server. Manages WebSocket lifecycle, reconnect backoff, and RPC dispatch. |
| **Session**    | A workspace session on a server, tied to a folder (project root). Contains threads, terminals, editor state. Created via `sessions.create` RPC. |
| **Thread**     | An AI conversation within a session. Each thread has a provider + model selection, message history, and approval state. |
| **Workspace**  | The mobile UI for an active session. Hosts a tab bar of plugins (Editor, Terminal, AI, Git, Explorer, Browser). |
| **Plugin**     | A self-contained UI panel. Scope is `workspace` (needs a session) or `server` (server-wide). Each has an optional GPI API for cross-plugin calls. |
| **GPI**        | Global Plugin Interface — the `api()` export on each plugin definition. Allows cross-plugin calls (e.g., AI plugin opens a file in Editor). |

## Data Flow

1. **User opens app** → `SessionsHomeScreen` lists saved servers
2. **Auto-connect** → `ConnectionStore.autoConnectSavedServers()` creates `StaviClient` per server
3. **StaviClient connects** → Noise NK handshake → `sessions.subscribe` → sessions appear
4. **User taps session** → `WorkspaceScreen` mounts → plugin tabs load
5. **Plugin RPCs** → `client.request('terminal.open', ...)` → server handles → response
6. **Subscriptions** → `client.subscribe('subscribeTerminalEvents', ...)` → server pushes events
7. **Reconnect** → on disconnect, exponential backoff re-connects, re-subscribes all active subs

## Store Architecture

```
ConnectionStore (Zustand)      SessionsStore (Zustand)
  savedConnections[]             sessionsByServer{}
  clients Map<id, StaviClient>   subscribe per server
  connect/disconnect/reconnect   CRUD via RPC

PluginRegistry (Zustand)       SessionRegistry (Zustand)
  openTabsBySession{}            per-plugin session tabs
  activeTabBySession{}           (terminal tabs, AI threads)

EditorStore (Zustand)          ExplorerStore (Zustand)
  openFilesBySession{}           cwdBySession{}
  activeFileBySession{}          entriesBySession{}
  dirty tracking                 selection/sort state
```

## Plugin Scope

- **workspace** plugins (Editor, Terminal, AI, Git, Browser): receive `session` prop, operate within a project folder
- **server** plugins (System Search): receive `serverId`, operate server-wide
- **shared** plugins (Explorer): `scope: 'workspace'` but defined in `plugins/shared/` because the code is reusable

## Phase History

| Phase | What shipped |
|-------|-------------|
| 0     | Scaffold: RN app, basic navigation, daemon prototype |
| 1     | Server core: RPC engine, PTY, orchestration, Noise NK |
| 2     | Mobile core: StaviClient, sessions, connection store |
| 3     | Terminal plugin: native terminal via WebView + xterm.js |
| 4a    | Editor + Explorer stubs, plugin registry, tab system |
| 4b    | CodeMirror 6 editor via WebView bridge, file tree |
| 5     | Multi-server, reconnect, Git plugin, AI plugin, settings |
| 6     | Relay transport, QR pairing, crypto layer |
| 7a    | File splits (context.ts, stavi-client.ts), line-count compliance |
| 7b    | Design tokens aligned to DESIGN.md, Inter font, indigo accent |
| 7c    | Explorer rewrite (batch ops, FlashList), system search |
| 7d    | Final polish: StateViews, telemetry, toast, cleanup |

## 5 Entry Points

1. **`apps/mobile/src/App.tsx`** — React Navigation root
2. **`apps/mobile/src/navigation/SessionsHomeScreen.tsx`** — server/session list
3. **`apps/mobile/src/navigation/WorkspaceScreen.tsx`** — plugin workspace
4. **`apps/mobile/src/stores/connection.ts`** — connection lifecycle
5. **`packages/server-core/src/server.ts`** — server RPC handlers
