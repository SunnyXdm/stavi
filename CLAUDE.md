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

### Known Bugs (re-audited 2026-06-11)
The April bug list is obsolete — a June 2026 code audit confirmed all of these are FIXED in current code:
path-traversal guards on all fs ops (`guardedPath`, fs.ts), `/health` leak, WS `maxPayload` (5MB, server.ts:395),
wsToken pruning (60s sweep), claude.ts stream-end → `turnError` without corrupting `hasStarted`,
codex `status='error'` → `turnError`, `textDone` dedup, `stopAll()` wired to disconnect + shutdown,
resume-cursor persistence (thread-repo.ts + claude.ts `query({resume})`), root ErrorBoundary (App.tsx),
AppState listener, and the stale-client reconnect bugs in `useOrchestration`/`useGit`/Explorer
(fixed 2026-06-11 via reactive `useConnectionStore` selectors).

Still open:
- **Navigation**: All screens use `NativeStackNavigationProp<any>` — no RootStackParamList type (plans A2)
- **AI**: 24x `as any` casts in claude.ts — limited type safety on SDK messages
- **Testing**: No test infrastructure in server-core or mobile. Typecheck: `npm run typecheck` works in both `packages/server-core` and `apps/mobile`.
- See `plans/14-sibling-recon-2026-06.md` for patterns worth porting from t3code/litter/muxy/lunel.

### Plugin Registration
All plugins MUST follow the explicit pattern in `load.ts`: export a plugin object, then `register(plugin, plugin.component)`. Do NOT self-register via `usePluginRegistry.getState().register()` at module scope. (Historical note: `tools` used to do this; it was migrated — all plugins now register via load.ts.)

### Theme System
- Light/dark/**system** switching is live via ThemeProvider (`apps/mobile/src/theme/ThemeContext.tsx`); default mode is `system` (`stores/theme-store.ts`, `userSet` flag preserves explicit choices across migrations)
- Tokens in `apps/mobile/src/theme/tokens.ts` — the light palette is the DESIGN.md Cursor-inspired warm cream
- Android cold-start `windowBackground` matches `bg.base` per mode (`values/colors.xml` + `values-night/`); `SystemBars` is rendered once in `App.tsx`, not per-screen
- Known stuck-dark: `NativeTerminal` terminal palette (intentional) and the editor's default `stavi-dark` CodeMirror theme (user-selectable)

### Keyboard Handling
- Edge-to-edge disables Android `adjustResize` — NEVER use RN `KeyboardAvoidingView` in workspace panels. Use `hooks/useKeyboardPanelStyle(bottomBarHeight)` (react-native-keyboard-controller + reanimated; pad = keyboardHeight − bottomBarHeight). `KeyboardProvider` wraps the app in `App.tsx`. Plain KAV is acceptable only inside Modals (screen-rooted windows).

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
