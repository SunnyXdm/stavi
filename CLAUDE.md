## Plans

All architectural decisions, bug analyses, and roadmap items live in `plans/`.
- `plans/architecture-analysis.md` — full breakdown of bugs, root causes, and fix priorities
- `plans/ui-redesign.md` — UI roadmap comparing stavi vs t3code, phase-by-phase plan
- `plans/competitive-research.md` — deep research on t3code and lunel architectures, what to copy/avoid
- `plans/stavi-vision.md` — product vision, differentiators, roadmap
- `plans/10-stabilization.md` — **current phase**: security, stability, Skia terminal, theme, browser proxy
- `plans/11-ai-layer-comparison.md` — deep comparison of t3code vs stavi AI layer, known bugs, priority fixes

**Always read the plans/ files before starting new work** — they contain root-cause
analysis that prevents re-investigating known bugs.

---

## Core Mental Model

**The server is the brain. The app is a dumb display.**

- One CLI = one server per machine. The server owns ALL state: files, terminals, AI threads, git, sessions.
- The mobile app is a remote control / viewer — it displays what the server tells it and sends user actions back.
- The app should NEVER be the source of truth. `sessions-store` persist on mobile is a **cache** for instant display on reconnect, not authority.
- If the app closes → nothing lost (server keeps running). If the app reconnects → sync from server, show where user left off.
- If the server restarts → rehydrate from SQLite (messages, threads, sessions, resume cursors). App reconnects seamlessly.
- t3code does this correctly via `ProviderSessionDirectory` (persists resume cursors to DB). Stavi's gap: adapter sessions are in-memory only, lost on server restart.
- One server handles multiple projects/sessions — user doesn't need multiple servers.

---

## Project Context

- Stavi is a React Native 0.85 (Fabric/New Architecture) mobile app that connects to a local server to run AI agents
- Forked from t3code's server code, inspired by lunel (RN terminal+AI app for iOS)
- Server: `packages/server-core/src/server.ts` (Bun WebSocket RPC) + handlers in `src/handlers/`
- Mobile AI: `apps/mobile/src/plugins/workspace/ai/` — `hooks/useOrchestration.ts` is the brain, `hooks/useThreadManager.ts` manages threads, `utils/event-reducer.ts` processes SSE events
- Provider adapters: `packages/server-core/src/providers/` (claude.ts, codex.ts)
- Plugin system: `apps/mobile/src/plugins/load.ts` registers all plugins at boot. Plugins live in `workspace/` (core 5), `extra/` (tools, search, monitor, ports, processes), `shared/` (explorer)

---

## Architecture Notes

### Key Stores (Zustand)
| Store | Persisted | Notes |
|-------|-----------|-------|
| `connection.ts` | ✅ savedConnections | Concurrency-guarded connectServer, relay reconnect |
| `sessions-store.ts` | ✅ sessionsByServer, sessionsById | Persist via AsyncStorage |
| `plugin-registry.ts` | ✅ tab state | Migrate v3 reset |
| `server-plugins-store.ts` | ❌ | Ref-counted WS subscriptions for monitor/ports/processes |
| `session-registry.ts` | ❌ | Per-plugin session registration for drawer |
| `stavi-client.ts` | ❌ | Class-based, not Zustand |

### Known Bugs (Verified)
- **Security**: `fs.read`(L87)/`write`(L96)/`list`(L209)/`search`(L262) use `resolveWorkspacePath` (no traversal guard) — `fs.create/rename/delete` already use `guardedPath`(L74) correctly
- **Security**: `/health` endpoint leaks `workspaceRoot` unauthenticated (server.ts:195)
- **Security**: No `maxPayload` on WebSocket server (server.ts:222, default 100MB → OOM)
- **Security**: Unconsumed `wsTokens` never pruned (consumed ones are deleted on use)
- **AI CRITICAL**: Unexpected stream end emits `turnComplete` instead of `turnError` (claude.ts:568-574) — partial responses look complete
- **AI CRITICAL**: `hasStarted=true` set on error/unexpected end → corrupts resume for future turns (claude.ts:539,574)
- **AI**: Codex `turn/completed` with `status='error'` emits `turnComplete` not `turnError`
- **AI**: `textDone` emitted twice (message_stop + result handler) — claude.ts lines 489 and 530
- **AI**: `stopSession()` exists (claude.ts:669) but is never called on client disconnect or workspace exit — sessions accumulate
- **AI**: No resume cursor persistence — server restart loses AI session state (messages survive in SQLite, but can't resume conversation)
- **AI**: Stale client reference in `useOrchestration` (non-reactive `getState()`)
- **AI**: 8x `(message as any)` type casts — limited type safety on SDK messages
- **UI**: No ErrorBoundary — one plugin crash takes down the app
- **UI**: No AppState listener — polling continues when backgrounded
- **Git plugin**: Non-reactive connection state reads → never re-subscribes after reconnect
- **Explorer**: Client captured at render → batch ops fail after reconnect
- **Navigation**: All screens use `NativeStackNavigationProp<any>` — no RootStackParamList type

### Plugin Registration
All plugins MUST follow the explicit pattern in `load.ts`: export a plugin object, then `register(plugin, plugin.component)`. Do NOT self-register via `usePluginRegistry.getState().register()` at module scope (the `tools` plugin does this — it should be migrated).

### Theme System
- Current: dark-mode only. Tokens in `apps/mobile/src/theme/tokens.ts`
- `lightColors` exists but is inert (not wired to any provider)
- DESIGN.md specifies a Cursor-inspired warm cream light theme — not yet implemented
- Target: light/dark/system switching via ThemeProvider context (see `plans/10-stabilization.md`)

### Terminal
- Current: xterm.js in WebView on both platforms
- Target: **3 backends**, user-selectable in plugin settings:
  - **WebView (xterm.js)**: existing, battle-tested, default on Android
  - **Skia GPU** (`@shopify/react-native-skia`): 60fps, zero bridge overhead, default on iOS. Server sends pre-parsed cell diffs.
  - **Native** (experimental): Android = Termux `terminal-emulator` via Turbo Module, iOS = SwiftTerm via Turbo Module. Behind "(Beta)" toggle.
- Server VT parser (`xterm-headless`) + dirty-row diffs shared infrastructure for Skia + Native backends
- SwiftTerm was tried standalone and rejected (bridge latency in RN) — now wrapped as optional native backend, not the only path

### Plugin Settings
- Plugins declare a `settings` schema on `PluginDefinition` (sections → fields with type/default/options)
- Settings auto-rendered in Settings screen via `SettingsRenderer` — zero per-plugin UI code
- Stored in `plugin-settings-store.ts` (Zustand + AsyncStorage persist), keyed by pluginId
- Access via `usePluginSetting(pluginId, key)` — single-field selector, minimal re-renders
- Lunel has NO plugin settings system (ad-hoc Context stores, duplicated UI) — this is a major DX advantage

---

## Competitor Landscape (April 2026)

| App | Platform | Terminal | AI | Notes |
|-----|----------|----------|----|-------|
| Lunel | iOS | Skia GPU (custom) | OpenCode+Codex | Cloud relay only, closed source |
| Code App | iOS | Native | None | Best editor, no AI |
| Blink Shell | iOS | Native SSH/Mosh | None | Best remote access |
| Termux | Android | Native | None | Full Linux, no GUI |
| Replit | Both | WebView | AI-first | Pivoted to agents, no terminal power |

**Stavi's gap**: No app combines quality native terminal + AI agent orchestration + SSH to real machines on mobile. Replit went AI-only. Blink went terminal-only. Code App went editor-only.

---

## graphify

This project has a graphify knowledge graph at graphify-out/.

Rules:
- Before answering architecture or codebase questions, read graphify-out/GRAPH_REPORT.md for god nodes and community structure
- If graphify-out/wiki/index.md exists, navigate it instead of reading raw files
- After modifying code files in this session, run `python3 -c "from graphify.watch import _rebuild_code; from pathlib import Path; _rebuild_code(Path('.'))"` to keep the graph current
