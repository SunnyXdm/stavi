# Stavi — Mental Model

> One-page onboarding guide for new contributors.
> For full details see ARCHITECTURE.md, PROTOCOL.md, and DESIGN.md.

## ASCII Overview

```
┌──────────────────────────────────────────────────────────────┐
│                      Mobile App (RN)                         │
│                                                              │
│  ┌────────┐   ┌──────────────────────────────────────────┐   │
│  │Sidebar │   │ Content area (one plugin at a time)      │   │
│  │  Rail  │   │                                          │   │
│  │ 52px   │   │  Editor · Terminal · AI · Git            │   │
│  │  or    │   │  Explorer · Browser                      │   │
│  │ 260px  │   │                                          │   │
│  │expanded│   │  (hidden plugins stay mounted at        │   │
│  └────────┘   │   opacity:0, not unmounted)              │   │
│               └──────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │           StaviClient (per-server)                   │    │
│  │   RpcEngine · Noise NK · Reconnect · Subs            │    │
│  └───────────────────────┬──────────────────────────────┘    │
└──────────────────────────┼───────────────────────────────────┘
                           │ WebSocket (ws:// or Relay)
┌──────────────────────────┼───────────────────────────────────┐
│  ┌────────────────────────┴──────────────────────────────┐   │
│  │           Stavi Server (Bun/Node)                     │   │
│  │  RPC handlers · PTY · FS · Git · AI (Claude/Codex)    │   │
│  └───────────────────────────────────────────────────────┘   │
│                      Server Machine                          │
└──────────────────────────────────────────────────────────────┘
```

## Key Definitions

| Term           | Meaning |
|----------------|---------|
| **Server**     | A remote (or local) machine running `stavi-server`. Identified by a persistent UUID. Has a keypair for Noise NK auth. |
| **Connection** | A `StaviClient` instance connected to one server. Manages WebSocket lifecycle, reconnect backoff, and RPC dispatch. |
| **Session**    | A workspace session on a server, tied to a folder (project root). Created via `sessions.create` RPC. Displayed as **"Workspace"** in the UI. |
| **Thread**     | An AI conversation within a session. Each thread has a per-chat provider + model selection, message history, and approval state. Displayed as **"Chat"** in the UI. |
| **Workspace**  | Both the user-facing term for a Session (Phase 8b rename) and the `WorkspaceScreen` that renders it. |
| **Plugin**     | A self-contained UI panel. Scope is `workspace` (needs a session) or `server` (server-wide). Each has an optional GPI API for cross-plugin calls. |
| **GPI**        | Global Plugin Interface — the `api()` export on each plugin definition. Allows cross-plugin calls (e.g., AI plugin opens a file in Editor). |

## Data Flow

1. **User opens app** → `SessionsHomeScreen` lists servers and workspaces as a flat card list
2. **Auto-connect** → `ConnectionStore.autoConnectSavedServers()` creates `StaviClient` per server
3. **StaviClient connects** → Noise NK handshake → `sessions.subscribe` → workspaces appear
4. **User taps workspace** → `WorkspaceScreen` mounts → sidebar (52px rail) + plugin panels load
5. **Default tab** → AI plugin (navOrder 0) is active on first open; last-active tab recalled on re-open
6. **Plugin RPCs** → `client.request('terminal.open', ...)` → server handles → response
7. **Subscriptions** → `client.subscribe('subscribeOrchestrationDomainEvents', ...)` → server pushes events
8. **Reconnect** → on disconnect, exponential backoff re-connects, re-subscribes all active subs

## Workspace Layout (Phase 8e+)

```
┌──────┬───────────────────────────────────┐
│ Rail │                                   │
│  AI  │  Plugin content area (flex: 1)    │
│  ⌨   │                                   │
│  📁  │  All plugins mounted simultaneously│
│  ✺   │  Inactive ones at opacity: 0       │
│  🌐  │  (preserves scroll / terminal state│
│  ──  │                                   │
│  🏠  │                                   │
│  ⚙   │                                   │
└──────┴───────────────────────────────────┘
Collapsed: 52px   Expanded: 260px (labels + chat list)
```

- The sidebar expands to show plugin labels and a "CHATS" section listing AI threads
- Tapping a chat in the sidebar switches AI thread AND activates the AI tab
- A "New Chat" button (PenLine icon) in the sidebar and AI header always creates a fresh thread

## Store Architecture

```
ConnectionStore (Zustand)      SessionsStore (Zustand)
  savedConnections[]             sessionsByServer{}
  clients Map<id, StaviClient>   subscribe per server
  connect/disconnect/reconnect   CRUD via RPC

PluginRegistry (Zustand)       SessionRegistry (Zustand)
  openTabsBySession{}            per-plugin session tabs
  activeTabBySession{}           (terminal tabs, AI chats)
  initialize() → default AI      onCreateSession → createNewChat

AiBindingsStore (Zustand)      EditorStore / ExplorerStore
  binds instanceId→threadId      per-session file state
  reconcile on reconnect         cwd, selection, sort state
```

## Plugin Scope

- **workspace** plugins (Editor, Terminal, AI, Git, Browser): receive `session` prop, operate within a project folder
- **server** plugins (System Search): receive `serverId`, operate server-wide
- **shared** plugins (Explorer): `scope: 'workspace'` but defined in `plugins/shared/`

## AI Chat Architecture (Phase 8c/8f)

- Each workspace can have **multiple chats** (threads). Chats are visible in the sidebar chat list.
- Each chat has a **per-chat provider** (`agentRuntime: 'claude' | 'codex'`). Changing the composer model selection locks it to that thread.
- `useOrchestration` owns state + subscriptions. `useThreadManager` (extracted hook) owns `ensureActiveThread` / `createNewChat`. `processEventInner` (event-reducer.ts) is a pure reducer.
- `useAiBindingsStore` maps `(serverId, sessionId, instanceId) → threadId` so the correct chat is restored after reconnect.

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
| 8a    | Fix Codex multi-turn race condition; Claude dispatch chain verified |
| 8b    | Terminology rename: Session→Workspace, Thread→Chat in all UI strings |
| 8c    | Per-chat agentRuntime; model selection persisted per thread |
| 8d    | Flat home screen (WorkspaceCard grid), ServersSheet, search |
| 8e    | Sidebar shell: 52px icon rail replaces bottom tab bar + left drawer |
| 8f    | Chat-first: createNewChat action, AI default tab, sidebar chat list |
| 8g    | File splits (useOrchestration, ai/index.tsx), MENTAL-MODEL rewrite |

## 5 Entry Points

1. **`apps/mobile/src/App.tsx`** — React Navigation root
2. **`apps/mobile/src/navigation/SessionsHomeScreen.tsx`** — flat workspace list
3. **`apps/mobile/src/navigation/WorkspaceScreen.tsx`** — sidebar + plugin content
4. **`apps/mobile/src/stores/connection.ts`** — connection lifecycle
5. **`packages/server-core/src/server.ts`** — server RPC handlers
