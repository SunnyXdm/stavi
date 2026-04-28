# Phase 10: Stabilization, Security, Skia Terminal, Theme & Browser

## Why This Phase Exists

After 9 phases of feature building, stavi has a working plugin system, bottom-tab navigation, AI orchestration, and a drawer — but the foundation is cracked. The connection system was silently swallowing errors. The server has path traversal vulnerabilities. There's no error containment, no crash reporting, no AppState lifecycle handling. The terminal is a WebView hack. The design doesn't match DESIGN.md. The browser can't access localhost. We have no tests.

Meanwhile, lunel has: Skia GPU terminal (60fps, server-parsed cells), light/dark/system themes, TCP port proxying for browser, voice input, haptics, ErrorBoundary, AppState handling, OTA hot updates, and production crash visibility.

This phase closes those gaps systematically.

---

## Competitive Position

| Capability | Lunel | Stavi (now) | Stavi (after Phase 10) |
|------------|-------|-------------|------------------------|
| Terminal | Skia GPU, 60fps | xterm.js WebView (~100ms lag) | 3 backends: WebView + Skia GPU + Native |
| AI agents | OpenCode + Codex | Claude + Codex | Claude + Codex + OpenCode |
| Theme | Light/Dark/System | Dark only | Light/Dark/System (DESIGN.md) |
| Browser | WebView + TCP proxy | WebView, no proxy | WebView + HTTP proxy |
| Error handling | ErrorBoundary + fallbacks | None | ErrorBoundary per plugin |
| Crash reporting | Unknown | None | Sentry |
| AppState | Handles foreground/background | None | Pauses polling on background |
| Connection | Cloud relay only | LAN + relay (buggy) | LAN + relay (fixed) |
| Security | Cloud-managed | Path traversal, info leak | Hardened |
| Tests | Unknown | Zero | Core store tests |
| Platform | iOS only | Android (iOS unverified) | Android + iOS |
| Hot updates | @hot-updater | None | Deferred |

**Stavi's moat**: Direct LAN connections (no cloud relay required), open server you control, multi-provider AI, plugin system.

---

## Step 1: Security Hardening (Server)

### 1a. Fix path traversal — `packages/server-core/src/handlers/fs.ts`
**Problem**: `fs.read` (L87), `fs.write` (L96), `projects.writeFile` (L104), `fs.list` (L209), `fs.search` (L262) use `resolveWorkspacePath()` which does NOT check boundaries. An authenticated client can read/write any file on the server's filesystem. Note: `fs.create`, `fs.rename`, `fs.delete` already correctly use `guardedPath` (L74).

**Fix**: Replace `resolveWorkspacePath(workspaceRoot, path)` with `guardedPath(path)` in the 5 unguarded handlers.

### 1b. Fix `/health` info leak — `packages/server-core/src/server.ts` L193
**Problem**: `/health` returns `{ status: 'ok', cwd: workspaceRoot }` unauthenticated.
**Fix**: Return only `{ status: 'ok' }`. Move `cwd` to the authenticated `server.getConfig` RPC.

### 1c. Add WebSocket maxPayload — `packages/server-core/src/server.ts` L221
**Problem**: No `maxPayload` → default 100MB → OOM attack vector.
**Fix**: `new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 })` (5MB).

### 1d. Add wsToken cleanup sweep — `packages/server-core/src/server.ts`
**Problem**: `wsTokens` are deleted on successful use (line 231), but tokens that are issued and never consumed (connection abandoned mid-pair) accumulate indefinitely.
**Fix**: `setInterval(() => wsTokens.forEach((v, k) => { if (Date.now() - v.createdAt > 15*60*1000) wsTokens.delete(k) }), 60000)`.

### 1e. Fix session.create folder whitelist poisoning
**Problem**: `session.create` with arbitrary `folder` adds it to `guardedPath`'s whitelist.
**Fix**: Validate that `folder` is a subdirectory of `workspaceRoot` before allowing session creation.

---

## Step 2: ErrorBoundary + AppState + Crash Reporting (Mobile)

### 2a. Create `apps/mobile/src/components/ErrorBoundary.tsx` (~80 lines)
- Class component wrapping each plugin in `PluginRenderer.tsx`
- Catches render errors, shows fallback UI (error message + "Restart Plugin" button)
- `componentDidCatch` → log to Sentry (or console until Sentry is wired)
- Reset via `key={resetCount}` pattern

### 2b. Wrap plugins in ErrorBoundary — `PluginRenderer.tsx`
- Each rendered plugin panel gets `<ErrorBoundary pluginId={id}><Panel /></ErrorBoundary>`
- One crash no longer takes down the app

### 2c. Add AppState listener — `apps/mobile/src/App.tsx` or top-level provider
- `AppState.addEventListener('change', (state) => {...})`
- On `background`: pause all polling intervals (server-plugins-store, ports, monitor)
- On `active`: resume subscriptions, trigger reconnect check
- Store `isAppActive` in a tiny Zustand store or React Context

### 2d. Add Sentry (or minimal crash logging)
- `npm install @sentry/react-native`
- Initialize in `App.tsx` with DSN
- `ErrorBoundary.componentDidCatch` → `Sentry.captureException()`
- Deferred if user prefers not to add Sentry now — can start with `services/crash-reporting.ts` abstraction layer

---

## Step 3: Triple Terminal Architecture

### Strategy: 3 Backends, User Chooses

Every user has different needs. Instead of picking one terminal approach, stavi offers three — selectable per-plugin settings:

| Backend | Platform | Rendering | Pros | Cons |
|---------|----------|-----------|------|------|
| **WebView (xterm.js)** | Android + iOS | xterm.js in WebView | Battle-tested, full VT100, works now | ~50-100ms bridge latency, heavy memory |
| **Skia GPU** | Android + iOS | `@shopify/react-native-skia` Canvas | 60fps, zero bridge, cross-platform | New code, no scrollback initially |
| **Native** | Android: Termux TerminalView, iOS: SwiftTerm | Platform native Canvas/CoreText | Fastest possible, platform-native feel | Two separate native modules to maintain |

**Default**: WebView on Android (proven), Skia on iOS (needed).
**User can override** in Terminal plugin settings (see Step 3b: Plugin Settings).

### 3a. Server: VT Parser + Dirty-Row Diffs (Shared Infrastructure)

Both Skia and Native backends need pre-parsed cell data from the server. WebView can use it too (optional optimization) but continues to work with raw PTY data.

**Files**: `packages/server-core/src/handlers/terminal.ts` (modify)

1. Add `xterm-headless` (headless xterm.js VT parser, runs in Node/Bun)
2. On PTY data event, feed bytes into the headless parser's screen buffer
3. Diff against previous frame — track which rows changed via row-hash comparison
4. Emit `terminal.cells` event alongside existing `terminal.data`:
   ```ts
   { type: 'cells', terminalId, cursor: {row, col}, rows: [
     { index: 5, cells: [{char: 'h', fg: 7, bg: 0, attrs: 0}, ...] },
     { index: 6, cells: [...] }
   ]}
   ```
5. Client subscribes to `terminal.cells` instead of `terminal.data` when using Skia/Native backend
6. Raw `terminal.data` kept for WebView backend (zero change to existing flow)

**New shared types**: `packages/shared/src/terminal-types.ts` (~50 lines)
```ts
interface TerminalCell { char: string; fg: number; bg: number; attrs: number }
interface TerminalRowDiff { index: number; cells: TerminalCell[] }
interface TerminalCellsEvent { type: 'cells'; terminalId: string; cursor: {row: number; col: number}; rows: TerminalRowDiff[] }
```

### 3b. Mobile: Skia Terminal (iOS default, Android optional)

**New files**:
- `apps/mobile/src/plugins/workspace/terminal/backends/SkiaTerminal.tsx` (~400 lines)
  - `@shopify/react-native-skia` `<Canvas>` fills terminal area
  - `useFont(require('../assets/JetBrainsMono-Regular.ttf'), fontSize)` — fontSize from plugin settings
  - Cell grid: `CHAR_WIDTH` from font glyph metrics, `LINE_HEIGHT = fontSize * 1.45`
  - Columns/rows computed from `onLayout`
  - Render: group cells into spans (same fg/bg/attrs), draw `<Rect>` for bg, `<Text>` for text
  - Cursor: inverted block, blink via `setInterval(530ms)`
  - Colors: ANSI 256-color palette lookup, respects theme (light/dark terminal colors)

- `apps/mobile/src/plugins/workspace/terminal/backends/useTerminalCells.ts` (~200 lines)
  - Subscribes to `terminal.cells` events from server
  - Maintains `cellBuffer: TerminalCell[][]`
  - Merges dirty-row diffs into buffer
  - Exposes: `cellBuffer`, `cursorPos`, `scrollOffset`

- `apps/mobile/src/plugins/workspace/terminal/backends/TerminalInput.tsx` (~150 lines)
  - Hidden `<TextInput>` off-screen captures keyboard
  - `onKeyPress` → escape sequences (arrows, escape, backspace, tab)
  - `onChangeText` → raw text
  - Shared between Skia and Native backends
  - Special key toolbar (Tab, Ctrl, arrows, Esc) above keyboard

- `apps/mobile/src/plugins/workspace/terminal/backends/TerminalScrollbar.tsx` (~150 lines)
  - Reanimated `Gesture.Pan()` on right edge
  - Scroll offset sent to server via `terminal.scroll` RPC
  - Shared between Skia and Native backends

### 3c. Mobile: Native Terminal (HIGH RISK — no prior art exists)

**Reality check (fact-checked April 2026)**:
- **No React Native bridge for SwiftTerm exists** — zero packages, zero blog posts, zero prior art
- **No React Native bridge for Termux TerminalView exists** — equally unexplored
- **No one has publicly built a native terminal in RN** — WebView+xterm.js dominates because it's cross-platform with zero native code
- **SwiftTerm known issues**: black-on-black rendering (#423), broken scrollback with DispatchQueue (#486), external keyboard shortcuts not activating (#483), Swift 6.2.3 build issues (#450)
- **The iOS first-responder problem is the biggest risk**: SwiftTerm's `TerminalView` calls `becomeFirstResponder()` to capture keyboard. RN manages its own first responder chain. Two competing first responders = keyboard appears/disappears unpredictably, input stolen between views.
- **Termux is GPL-licensed** — extracting the terminal-emulator library may have license implications

**Conclusion**: Native backends are genuinely experimental. Budget 1-2 weeks per platform just for the bridge, with high risk of keyboard/gesture conflicts that may be unsolvable without forking the terminal libraries. **Recommend: build Skia first, defer native backends until Skia is proven and there's a clear reason to go native.**

**If we still want to try**:
- `apps/mobile/src/plugins/workspace/terminal/backends/NativeTerminalAndroid.tsx` (~200 lines)
  - Wraps Termux's `terminal-emulator` Java library (Apache 2.0) as a Fabric native component
  - `TerminalView` renders via Android Canvas/`drawText()`
  - Bridge: Turbo Module exposes `create()`, `write()`, `resize()`, `destroy()`

- `apps/mobile/src/plugins/workspace/terminal/backends/NativeTerminalIOS.tsx` (~200 lines)
  - Wraps SwiftTerm's `TerminalView` (UIView, CoreText + optional Metal) as a Fabric native component
  - **RISK**: first-responder conflicts with RN's keyboard system
  - **RISK**: gesture responder conflicts with RN's touch system
  - **RISK**: scrollback DispatchQueue bug (#486) may affect embedded use
  - Bridge: Turbo Module same API as Android

- `android/app/src/main/java/com/stavi/terminal/` — Turbo Module host (~300 lines)
- `ios/StaviTerminal/` — Turbo Module host (~300 lines)

### 3d. Terminal Backend Switcher

In the terminal plugin's `index.tsx`:
```tsx
function TerminalPanel(props) {
  const backend = usePluginSettings('terminal', 'backend'); // 'webview' | 'skia' | 'native'
  
  switch (backend) {
    case 'skia': return <SkiaTerminal {...props} />;
    case 'native': return Platform.OS === 'ios' 
      ? <NativeTerminalIOS {...props} /> 
      : <NativeTerminalAndroid {...props} />;
    default: return <WebViewTerminal {...props} />; // existing
  }
}
```

### Dependencies to Add
- `@shopify/react-native-skia` (GPU canvas — Skia backend)
- `xterm-headless` on server (VT parser for dirty-row diffs)
- Bundle JetBrains Mono Nerd Font TTF in mobile assets
- Termux `terminal-emulator` library (Android native — gradle dependency)
- SwiftTerm (iOS native — SPM/CocoaPods)

### Estimated Effort
- Server: VT parser + dirty-row differ (~500 lines)
- Mobile Skia: renderer (~400) + cells hook (~200) + input (~150) + scrollbar (~150)
- Mobile Native Android: Turbo Module (~300) + RN wrapper (~200)
- Mobile Native iOS: Turbo Module (~300) + RN wrapper (~200)
- Shared: cell types (~50) + backend switcher (~50)
- **Total: ~2,500 lines** (but native backends can be deferred)

### Phasing
1. **Phase A**: Server VT parser + dirty-row diffs (unblocks everything)
2. **Phase B**: Skia terminal (iOS default, Android optional) — highest priority
3. **Phase C**: Native Android (Termux wrapper) — nice to have
4. **Phase D**: Native iOS (SwiftTerm wrapper) — experimental, may not ship

---

## Step 3.5: Plugin Settings Architecture

### Why
Lunel's settings are completely ad-hoc: no plugin registration for settings, no shared schema, UI primitives duplicated across pages, settings stores disconnected from plugins. We can do better.

Every plugin should be able to **declare its own settings schema**, and the Settings screen should **auto-generate sections from those declarations**. This means:
- Adding a new plugin with settings requires zero changes to the Settings screen
- Settings are typed, validated, persisted, and accessible via a single hook
- The AI can understand and modify plugin settings without hunting through scattered files

### Architecture

#### 1. Extend `PluginDefinition` — `packages/shared/src/plugin-types.ts`

```ts
interface PluginSettingField {
  key: string;
  label: string;
  description?: string;
  type: 'select' | 'toggle' | 'stepper' | 'text' | 'color';
  // Type-specific config:
  options?: Array<{ value: string; label: string; description?: string }>;  // for 'select'
  min?: number; max?: number; step?: number;  // for 'stepper'
  default: any;
}

interface PluginSettingsSchema {
  /** Sections group related settings visually */
  sections: Array<{
    title?: string;  // optional section header
    fields: PluginSettingField[];
  }>;
}

// Add to PluginDefinition:
interface PluginDefinition {
  // ...existing fields...
  settings?: PluginSettingsSchema;
}
```

#### 2. Create Settings Store — `apps/mobile/src/stores/plugin-settings-store.ts` (~120 lines)

```ts
// Zustand + persist. Keyed by pluginId → Record<string, any>
// usePluginSettings(pluginId: string): Record<string, any>
// updatePluginSetting(pluginId: string, key: string, value: any): void
// getPluginSetting<T>(pluginId: string, key: string): T
```

- Persisted to AsyncStorage as `stavi-plugin-settings`
- Defaults populated from `PluginSettingsSchema.fields[].default`
- Type-safe via generics on `getPluginSetting<T>()`
- `usePluginSetting(pluginId, key)` — single-field selector for minimal re-renders

#### 3. Shared Settings UI Components — `apps/mobile/src/components/settings/` (~300 lines total)

```
settings/
  SettingsSection.tsx    — titled group with dividers (~40 lines)
  SettingsToggle.tsx     — label + Switch (~40 lines)
  SettingsStepper.tsx    — label + −/value/+ buttons (~60 lines)
  SettingsSelect.tsx     — label + modal picker or inline radio (~80 lines)
  SettingsText.tsx       — label + TextInput (~40 lines)
  SettingsRenderer.tsx   — takes a PluginSettingsSchema, renders all sections automatically (~60 lines)
```

`SettingsRenderer` is the key component — given a plugin's schema + current values, it renders the entire settings panel. Zero per-plugin UI code needed.

#### 4. Redesigned Settings Screen — `apps/mobile/src/navigation/SettingsScreen.tsx`

Current: just a connection manager. New structure:

```
Settings
├── Appearance
│   ├── Theme (Light / Dark / System)
│   ├── App Icon (future)
│   └── Font Size (global base)
├── Servers (existing connection management, moved to a section)
├── Plugin Settings (auto-generated from plugin schemas)
│   ├── Terminal
│   │   ├── Backend: WebView / Skia / Native (Beta)
│   │   ├── Font Size: 10-20 (stepper)
│   │   ├── Font Family: JetBrains Mono / Fira Code / ...
│   │   ├── Scrollback Lines: 1000-50000 (stepper)
│   │   ├── Cursor Style: Block / Underline / Bar
│   │   └── Bell: On / Off
│   ├── AI
│   │   ├── Default Provider: Claude / Codex
│   │   ├── Default Model: (per provider)
│   │   ├── Effort: Low / Medium / High / Max
│   │   ├── Extended Thinking: On / Off
│   │   └── Auto-scroll: On / Off
│   ├── Editor
│   │   ├── Font Size: 10-20
│   │   ├── Word Wrap: On / Off
│   │   ├── Line Numbers: On / Off
│   │   └── Tab Size: 2 / 4 / 8
│   ├── Browser
│   │   ├── Homepage URL
│   │   ├── Search Engine: Google / DuckDuckGo / Bing
│   │   └── JavaScript: On / Off
│   ├── Git (no settings initially)
│   ├── Explorer
│   │   ├── Show Hidden Files: On / Off
│   │   └── Sort By: Name / Date / Size
│   └── Search
│       └── Case Sensitive: On / Off (default off)
├── About
│   ├── Version
│   ├── Server Info
│   └── Licenses
```

The Plugin Settings section is **auto-generated**: iterate `usePluginRegistry.getState().definitions`, filter those with `settings` schema, render a `SettingsRenderer` for each. Adding a new plugin with settings = zero Settings screen changes.

#### 5. Example: Terminal Plugin Settings Declaration

In `apps/mobile/src/plugins/workspace/terminal/index.tsx`:
```ts
export const terminalPlugin: WorkspacePluginDefinition = {
  id: 'terminal',
  name: 'Terminal',
  // ...existing fields...
  settings: {
    sections: [
      {
        title: 'Rendering',
        fields: [
          {
            key: 'backend',
            label: 'Terminal Backend',
            description: 'How the terminal is rendered',
            type: 'select',
            options: [
              { value: 'webview', label: 'WebView (xterm.js)', description: 'Battle-tested, full compatibility' },
              { value: 'skia', label: 'Skia GPU', description: 'Fast GPU rendering, cross-platform' },
              { value: 'native', label: 'Native (Beta)', description: 'Platform-native rendering' },
            ],
            default: Platform.OS === 'ios' ? 'skia' : 'webview',
          },
        ],
      },
      {
        title: 'Appearance',
        fields: [
          { key: 'fontSize', label: 'Font Size', type: 'stepper', min: 8, max: 24, step: 1, default: 14 },
          { key: 'cursorStyle', label: 'Cursor Style', type: 'select',
            options: [
              { value: 'block', label: 'Block' },
              { value: 'underline', label: 'Underline' },
              { value: 'bar', label: 'Bar' },
            ], default: 'block' },
          { key: 'bell', label: 'Bell Sound', type: 'toggle', default: false },
        ],
      },
      {
        fields: [
          { key: 'scrollbackLines', label: 'Scrollback Lines', type: 'stepper', min: 500, max: 50000, step: 500, default: 5000 },
        ],
      },
    ],
  },
};
```

#### 6. Hook for Plugins to Read Their Own Settings

```ts
// In any plugin component:
const fontSize = usePluginSetting('terminal', 'fontSize'); // typed, reactive, single-field
const backend = usePluginSetting('terminal', 'backend');
```

This is a single Zustand selector — minimal re-renders, no prop drilling.

### What This Gets Us Over Lunel

Lunel: 3 disconnected Context stores, manually wired settings pages, duplicated UI primitives, no plugin schema.
Stavi: One declarative schema per plugin, auto-generated UI, shared typed store, one `usePluginSetting()` hook. Adding a plugin with settings = add a `settings` field to the definition. Done.

### Estimated Effort
- Shared types update: ~40 lines
- Plugin settings store: ~120 lines
- Settings UI components (6 files): ~300 lines
- Settings screen redesign: ~350 lines (mostly restructuring, reuse components)
- Plugin schema declarations (terminal, AI, editor, browser, explorer, search): ~200 lines total
- **Total: ~1,010 lines**

---

## Step 4: Theme System (Light/Dark/System)

### Architecture

DESIGN.md defines a warm cream light theme. `tokens.ts` already has `lightColors` (inert). We need:

1. **New**: `apps/mobile/src/theme/ThemeContext.tsx` (~100 lines)
   - React Context (same pattern as lunel — not Zustand, because theme affects every component and Context is the React-idiomatic way)
   - `ThemeOption = 'light' | 'dark' | 'system'`
   - System → `useColorScheme()` from RN
   - Persisted in AsyncStorage (`@stavi_theme`)
   - Provides: `{ colors, typography, spacing, radii, isDark }`

2. **Modify**: `apps/mobile/src/theme/tokens.ts`
   - Rename current `colors` → `darkColors`
   - Promote existing `lightColors` (already mirrors DESIGN.md values) to active use
   - Both exported, ThemeContext selects between them
   - Update `lightColors` to exactly match DESIGN.md:
     - bg.base: `#f2f1ed`, bg.raised: `#f7f7f4`, bg.sunken: `#ebeae5`
     - fg.primary: `#26251e`, fg.secondary: `rgba(38,37,30,0.55)`, fg.muted: `rgba(38,37,30,0.35)`
     - accent.primary: `#f54e00`
     - borders: warm-shifted oklab-based (approximate in rgba for RN: `rgba(38,37,30,0.1)`)
     - semantic.error: `#cf2d56`, semantic.success: `#1f8a65`

3. **Modify**: All components that import `colors` from `../theme`
   - Replace static import with `const { colors } = useTheme()`
   - This is a large sweep (~60+ files) but each change is mechanical
   - Alternative: make `colors` a Proxy or module-level getter that reads from context — more magical but less churn

4. **Typography**: 
   - DESIGN.md specifies CursorGothic, jjannon, berkeleyMono — these are proprietary/custom fonts
   - Keep Inter (sans) and JetBrains Mono (mono) as defaults
   - Add font selection system later (lunel has 15+ font families via expo-google-fonts)

5. **Add to Settings screen**: Theme picker (Light / Dark / System) with live preview

### Migration Strategy
- Phase 4a: Create ThemeContext, wire to App.tsx, default to 'dark' (no visual change)
- Phase 4b: Sweep components to use `useTheme()` instead of static imports (can be done incrementally per plugin)
- Phase 4c: Polish light theme colors, test all screens
- Phase 4d: Add Settings UI

---

## Step 5: Browser Localhost Proxy

### Problem
Stavi's browser is a WebView that can load public URLs, but developers need to access `localhost:3000` (etc.) running on the server. The server is remote — `localhost` on the phone isn't the server.

### Lunel's Approach
Lunel uses `react-native-tcp-socket` to create raw TCP connections from the mobile app to the server, forwarding HTTP traffic. A local TCP server on the phone listens on a port, and proxies requests through the WebSocket connection to the server's localhost.

### Stavi's Approach (Simpler)
Since stavi already has a WebSocket RPC connection to the server, add an HTTP proxy RPC:

1. **Server**: New RPC `http.proxy` — accepts `{ method, url, headers, body }`, makes the HTTP request locally on the server, returns `{ status, headers, body }`
2. **Mobile**: When the browser detects a localhost URL, intercept the request and proxy through the RPC
3. **WebView**: Use `onShouldStartLoadWithRequest` to intercept localhost URLs, fetch via RPC, inject response

**Alternative (better for real-time)**: WebSocket tunnel
- Server: `http.tunnel` RPC opens a connection to `localhost:PORT`, streams bidirectionally
- Mobile: Local HTTP server (or intercept at WebView level)
- More complex but supports WebSocket connections, SSE, etc.

### Estimated Effort
- Server handler: ~100 lines
- Mobile WebView integration: ~150 lines
- Total: ~250 lines for basic HTTP proxy, ~500 for full tunnel

---

## Step 6: AI System Bug Fixes

### 6a. Fix unexpected stream end — `packages/server-core/src/providers/claude.ts`
**Problem**: Lines 568-574: if the SDK stream ends without a `result` message, stavi emits `turnComplete` (success) AND sets `hasStarted=true`. Partial responses look complete, and resume is corrupted.
**Fix**: Emit `turnError('Stream ended unexpectedly')` instead. Do NOT set `hasStarted=true`.

### 6b. Fix Codex error handling — `packages/server-core/src/providers/codex.ts`
**Problem**: `turn/completed` with `status='error'` emits `turnComplete` instead of `turnError` (lines 612-614).
**Fix**: Check `status` field and emit appropriate event.

### 6c. Fix stale client in useOrchestration — `apps/mobile/src/plugins/workspace/ai/hooks/useOrchestration.ts`
**Problem**: `getState()` captures client at render time, not reactively. If server reconnects, the old (dead) client is used.
**Fix**: Use a Zustand selector to get the client reactively, or read `getState()` inside callbacks (not at render time).

### 6d. Wire `stopSession` to disconnect events
**Problem**: `stopSession()` exists (claude.ts:669) and works correctly, but is never called when clients disconnect or leave workspaces. Sessions accumulate in memory.
**Fix**: Call `stopSession(threadId)` when client disconnects from workspace, or on server shutdown.

### 6e. Remove duplicate `textDone` emission
**Problem**: `textDone` emitted at `message_stop` (L490-492) AND at `result` (L530-532). Clients get it twice.
**Fix**: Only emit in the `result` handler.

### 6f. Fix Codex interrupt drain loop hang
**Problem**: After `turn/interrupt` RPC, if `turn/aborted` notification never arrives, the drain loop hangs for 30 seconds.
**Fix**: After sending `turn/interrupt`, push a synthetic `turnError('interrupted')` into the event buffer to wake the drain loop.

### 6g. Persist resume cursor (SERVER RESTART SURVIVAL)
**Problem**: `session.sessionId` in Claude and `providerThreadId` in Codex are in-memory only. Server restart = messages visible from SQLite, but can't continue conversation (AI starts fresh with no context).
**Fix**: Add `resume_cursor TEXT` column to `threads` table (new migration). After each successful turn, save `JSON.stringify({sessionId, lastAssistantUuid})`. On server restart + first sendTurn, use `resume` option in `query()` to reconnect to prior SDK session.

---

## Step 7: Code Quality

### 7a. Type the navigation
- Create `apps/mobile/src/navigation/types.ts` with `RootStackParamList`
- Define params for each screen: `SessionsHome: undefined`, `Workspace: { sessionId: string }`, `Settings: undefined`, `PairServer: undefined`
- Replace all `NativeStackNavigationProp<any>` with `NativeStackNavigationProp<RootStackParamList>`

### 7b. Fix plugin registration consistency
- `extra/tools` self-registers on import — migrate to explicit `register()` in `load.ts` like every other plugin
- Delete the empty `plugins/core/` directory

### 7c. Fix non-reactive state reads
- `git/hooks/useGit.ts`: Use Zustand selector for connection state (not `getState()`)
- `shared/explorer/index.tsx`: Get client reactively, not at render time

### 7d. Remove unused dependencies
- Audit and remove: `react-native-worklets` (if vestigial from Reanimated 3), unused `@stablelib/*` if already in `@stavi/crypto`
- Verify `react-native-quick-base64` usage

### 7e. Fix wsToken cleanup (server)
Already covered in Step 1d.

---

## Step 8: Polish

### 8a. Haptics
- `expo-haptics` on tab press (Light), drawer open (Medium), destructive actions (Heavy)
- Lunel uses this throughout — it feels alive

### 8b. AnimatedPressable
- Reanimated spring scale (1 → 0.96) on all interactive elements
- Lunel's press feedback makes the app feel responsive

### 8c. Keyboard handling
- `react-native-keyboard-controller` for smooth keyboard animations (worklet-based)
- Bottom bar should hide or adjust when keyboard is open in composer

### 8d. Fix pre-existing TypeScript errors
- `PluginBottomBar.tsx`: `StyleSheet.absoluteFillObject` → `StyleSheet.absoluteFill`
- `SessionDrawer.tsx`: same fix

---

## Dependency Graph

```
Step 1 (Security) ──────────────────────────── Independent, do first
Step 2 (ErrorBoundary + AppState) ──────────── Independent, do second
Step 3 (Terminal) ──────────────────────────── Biggest effort
  ├── 3a: Server VT parser + dirty-row diffs (unblocks Skia+Native)
  ├── 3b: Skia terminal (iOS default, Android optional)
  ├── 3c: Native Android - Termux wrapper (optional)
  └── 3d: Native iOS - SwiftTerm wrapper (experimental)
Step 3.5 (Plugin Settings) ────────────────── Do BEFORE Step 3b (terminal needs settings)
  ├── Shared types + settings store
  ├── Settings UI components
  ├── Settings screen redesign
  └── Plugin schema declarations
Step 4 (Theme System) ──────────────────────── Independent of Step 3
  ├── 4a: ThemeContext + wire to App
  ├── 4b: Component sweep (incremental)
  ├── 4c: Polish light colors
  └── 4d: Add to Settings (uses plugin settings components)
Step 5 (Browser Proxy) ────────────────────── After Step 1 (server hardening)
Step 6 (AI Bug Fixes) ─────────────────────── Independent
Step 7 (Code Quality) ─────────────────────── Independent
Step 8 (Polish) ────────────────────────────── After everything else
```

Steps 1, 2, 6, 7 can run in parallel.
Step 3.5 should land before 3b (terminal backend switcher needs plugin settings).
Step 4d reuses settings UI components from 3.5.
Step 3 is the critical path — longest and most complex.
Step 5 depends on Step 1 (don't add HTTP proxy to an unhardened server).

---

## Recommended Execution Order

1. **Step 1**: Security (quick, critical)
2. **Step 2**: ErrorBoundary + AppState (quick, critical)
3. **Step 3.5**: Plugin settings architecture (foundation for everything)
4. **Step 6**: AI bug fixes (quick wins)
5. **Step 7**: Code quality (quick wins)
6. **Step 4**: Theme system (uses settings components from 3.5)
7. **Step 3a**: Server VT parser (unblocks terminal work)
8. **Step 3b**: Skia terminal (the big one)
9. **Step 5**: Browser proxy
10. **Step 3c**: Native Android terminal (optional)
11. **Step 3d**: Native iOS terminal (experimental)
12. **Step 8**: Polish (haptics, animations, keyboard)

---

## Estimated Total Effort

| Step | New Lines | Modified Lines | Deleted Lines |
|------|-----------|----------------|---------------|
| 1. Security | ~50 | ~30 | ~5 |
| 2. ErrorBoundary + AppState | ~200 | ~50 | 0 |
| 3. Terminal (all backends) | ~2,500 | ~300 | 0 |
| 3.5. Plugin Settings | ~1,010 | ~200 | ~100 |
| 4. Theme System | ~200 | ~800 (sweep) | 0 |
| 5. Browser Proxy | ~250 | ~100 | 0 |
| 6. AI Bug Fixes | ~20 | ~60 | 0 |
| 7. Code Quality | ~100 | ~200 | ~50 |
| 8. Polish | ~300 | ~100 | 0 |
| **Total** | **~4,630** | **~1,840** | **~155** |

---

## What Makes Stavi Better Than Lunel After This

1. **Direct LAN + relay** — lunel is relay-only (cloud dependency). Stavi works offline on local network.
2. **Open server** — users control their own server, not locked to lunel's cloud.
3. **Multi-provider AI** — Claude + Codex + future providers (OpenCode, Ollama). Lunel is tied to their backend.
4. **Plugin architecture** — extensible, documented, each plugin is isolated. Lunel's Panel.tsx was 4335 lines (monolith).
5. **3 terminal backends** — WebView (proven), Skia (fast), Native (experimental). User chooses. Lunel only has Skia.
6. **Plugin settings system** — declarative schema, auto-generated UI, typed store. Lunel has ad-hoc disconnected settings with duplicated UI.
7. **Android + iOS** — lunel is iOS-only. Stavi targets both with platform-appropriate defaults.
8. **DESIGN.md theme** — warm, distinctive Cursor-inspired aesthetic vs lunel's generic dark theme.
9. **Security-hardened server** — path traversal fixed, maxPayload set, proper auth boundaries.
