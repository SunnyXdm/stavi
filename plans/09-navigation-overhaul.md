# Navigation & Plugin Overhaul — Lunel-Style Bottom Tabs + Drawer

## Context

Phase 8e replaced stavi's bottom tab bar with a 52px always-on sidebar rail — a desktop IDE pattern that's hostile on phones. It steals 14% of screen width permanently, puts navigation at the top-left (hardest to reach one-handed), and the collapse-scrim covers the sidebar itself (blocking taps). Lunel uses a bottom tab bar + swipe-from-left session drawer — the standard mobile pattern. We're adopting that.

Additionally, stavi has 4 server-scoped plugins (Processes, Ports, Monitor, System Search) trapped in a `ServerToolsSheet` bottom sheet, inaccessible from the main workspace. Lunel puts all plugins (core + extra) in the same tab system. We'll do the same, plus add new plugins: Search, Tools.

**Not in scope**: Light/dark theme (separate phase), terminal rewrite (Skia), editor WebView always-mount fix (separate fix).

---

## Phase 1: Bottom Tab Bar + Full-Width Content

**Goal**: Kill the sidebar rail. Restore bottom navigation. Content gets full screen width.

### Create `apps/mobile/src/components/PluginBottomBar.tsx` (~280 lines)

- 6 fixed slots: AI, Editor, Terminal, Git, Browser, **Tabs** (LayoutGrid icon)
- Each slot: Lucide icon (20px) + label (10px caption) stacked vertically
- Active = `colors.accent.primary` icon+label, inactive = `colors.fg.muted` at 0.7 opacity
- Bar height: 56px + `useSafeAreaInsets().bottom`
- Background: `colors.bg.raised`, top border: `colors.divider`
- **"Tabs" button**: opens a `Modal` (transparent, slide-up) listing all `kind: 'extra'` plugins
  - Each row: icon + name + description, tap → `openTab(pluginId)` + close modal
  - Backdrop: `colors.bg.scrim`, tap to dismiss
  - Sheet: `colors.bg.raised`, `radii.lg` top corners
- **Imperative state reads**: Don't subscribe to plugin-registry reactively. Use `usePluginRegistry.getState()` inside press handlers. Only re-render when `activeTabId` changes (single selector).
- Reuse: `usePluginRegistry((s) => s.getActiveTabId(sessionId))` for active highlight

### Modify `apps/mobile/src/navigation/WorkspaceScreen.tsx`

- Remove `WorkspaceSidebar` import and JSX
- Remove `sidebarExpanded` state, `handleToggleSidebar`, scrim `<Pressable>`
- Change `styles.root.flexDirection` from `'row'` to `'column'` (or just `flex: 1`)
- Add `const insets = useSafeAreaInsets()`
- Add `<PluginBottomBar sessionId={sessionId} />` after `</SafeAreaView>` content block
- Pass `bottomBarHeight={56 + insets.bottom}` to `<PluginRenderer>`
- Remove `handleCreateInstance` (moved to PluginBottomBar Tabs modal)

### Modify `apps/mobile/src/components/PluginHeader.tsx`

- Remove deprecated `onOpenDrawer` → restore it as live prop (wired in Phase 2)
- For now: hamburger icon renders but is a no-op (or hidden until Phase 2)
- Remove any sidebar-toggle references

### Done criteria
- [ ] Bottom bar visible at screen bottom with 6 items, thumb-reachable
- [ ] Tapping AI/Editor/Terminal/Git/Browser switches active plugin
- [ ] "Tabs" opens modal listing extra plugins (Explorer, workspace-search initially)
- [ ] Content area is full screen width (no 52px rail)
- [ ] All theme tokens, no hardcoded colors, all files ≤ 400 lines
- [ ] WHAT/WHY/HOW/SEE headers on new file

---

## Phase 2: Session Drawer (Swipe-from-Left)

**Goal**: Replace expanded sidebar panel with a swipe-from-left overlay drawer showing per-plugin sessions.

**Dependency**: `react-native-gesture-handler` already installed (2.31.1). `@react-navigation/drawer` is **NOT installed** — use a custom `Animated.View` overlay instead (simpler, no new dep).

### Create `apps/mobile/src/components/SessionDrawer.tsx` (~350 lines)

- Custom animated overlay: `Animated.Value` drives `translateX` from `-width` to `0`
- Width: `Dimensions.get('window').width * 0.82`
- Open triggers: (a) hamburger tap in PluginHeader, (b) swipe from left 30px edge via `PanResponder`
- Background: `colors.bg.raised`
- **Content is context-sensitive to active plugin**:
  - Reads `activeTabId` → finds `pluginId` → reads `useSessionRegistry(pluginId)`
  - AI active → AI chat list (title, preview, timestamp). Tap → switch thread. "New Chat" button.
  - Terminal active → terminal session list. Tap → switch session. "New Terminal" button.
  - Editor active → open files list from editor store. Tap → switch file.
  - Git/Browser/extras → show app branding or "No sessions" placeholder
- Top section: search `TextInput` + create button (plugin-dependent)
- Bottom section: Home (→ SessionsHome) + Settings (→ Settings) nav buttons with icons
- Scrim: sibling `Pressable` with `colors.bg.scrim` behind drawer, tap → close
- `BackHandler` on Android: if drawer open, close it and consume event
- **Reuse**: `session-registry.ts` store — plugins already register their sessions here (AI does). Terminal and Editor need to register too (small wiring in Phase 2).

### Modify `WorkspaceScreen.tsx`

- Add `drawerOpen` state + `handleOpenDrawer` / `handleCloseDrawer`
- Render `<SessionDrawer>` as absolute-positioned overlay (not wrapping content)
- Pass `onOpenDrawer={handleOpenDrawer}` to `<PluginHeader>`

### Modify `PluginHeader.tsx`

- Hamburger (Menu icon) visible when `onOpenDrawer` is provided
- First item in header row, calls `onOpenDrawer` on press

### Wire session registration for Terminal + Editor

- `plugins/workspace/terminal/index.tsx`: in the panel's useEffect, call `register('terminal', { sessions, activeId, onSelect, onCreate })`
- `plugins/workspace/editor/index.tsx`: similar — register open files as sessions

### Done criteria
- [ ] Swipe from left edge opens drawer overlay at ~82% width
- [ ] Hamburger in PluginHeader opens same drawer
- [ ] Drawer shows sessions for the currently active plugin (AI chats, terminal sessions, editor files)
- [ ] "New" button creates a session via the plugin's registered callback
- [ ] Home/Settings buttons navigate correctly and close drawer
- [ ] Tap scrim or swipe left closes drawer
- [ ] Android back button closes drawer when open
- [ ] All files ≤ 400 lines

---

## Phase 3: Delete Sidebar + ServerToolsSheet

**Goal**: Remove dead code.

### Delete files
- `apps/mobile/src/components/WorkspaceSidebar.tsx` (330 lines)
- `apps/mobile/src/components/WorkspaceSidebarChats.tsx` (161 lines)
- `apps/mobile/src/components/ServerToolsSheet.tsx` (230 lines)

### Clean up imports
- Remove all imports of these 3 files from WorkspaceScreen, SessionsHomeScreen, or anywhere else
- Remove `SERVER_SCOPED_IDS` set from plugin-registry if it exists

### Done criteria
- [ ] Zero references to deleted files in codebase
- [ ] App compiles, ~721 lines of dead code removed

---

## Phase 4: Promote Server Plugins into Workspace Tabs

**Goal**: Processes, Ports, Monitor, System Search appear in the "Tabs" modal like any other extra plugin.

### Modify plugin registrations

For each of the 4 plugins in `apps/mobile/src/plugins/server/`:
- Change `scope: 'server'` → `scope: 'workspace'`
- Change component props from `ServerPluginPanelProps` to `WorkspacePluginPanelProps`
- Extract `serverId` from `props.session.serverId` instead of `props.serverId`
- Keep `kind: 'extra'`

### Modify `apps/mobile/src/stores/plugin-registry.ts`

- Remove the `scope === 'server'` guard in `openTab()` that rejects server plugins
- Remove `SERVER_SCOPED_IDS` filtering in `initialize()` (if not already done in Phase 3)

### Modify `packages/shared/src/plugin-types.ts`

- Consider removing `ServerPluginDefinition` and `ServerPluginPanelProps` if no server-scoped plugins remain
- Or keep them as dead types and clean up in Phase 6

### Modify `apps/mobile/src/plugins/load.ts`

- Move imports from `./server/` to reflect that they're now workspace-scoped extras
- Optionally move files from `plugins/server/` to `plugins/extra/` directory

### Keep `server-plugins-store.ts`

- Still needed — plugins subscribe to processes/ports/monitor data from their own `useEffect`
- The ref-counting pattern works correctly for this

### Done criteria
- [ ] All 4 former server plugins appear in "Tabs" modal
- [ ] Tapping them opens a workspace tab with content
- [ ] Data subscriptions (processes WS, ports poll, monitor poll) still work
- [ ] No `ServerToolsSheet` references remain

---

## Phase 5a: Search Plugin

**Goal**: Full-text codebase search. Server already has `fs.grep` RPC.

### Create `apps/mobile/src/plugins/extra/search/SearchPanel.tsx` (~250 lines)

- Search input at top with case-sensitive toggle
- Calls server RPC: `client.request('fs.grep', { pattern, path, caseSensitive, maxResults: 200 })`
- Results grouped by file path (collapsible sections)
- Each match row: line number + highlighted match text (split into normal/highlight spans)
- Tap result → open file in editor: `eventBus.emit('editor.openFile', { path, line })`
- Empty state, loading state, error state using shared StateViews
- `NotConnected` guard

### Create `apps/mobile/src/plugins/extra/search/index.tsx` (~40 lines)

- Plugin registration: `{ id: 'search', name: 'Search', scope: 'workspace', kind: 'extra', icon: Search }`

### Done criteria
- [ ] Search appears in Tabs modal
- [ ] Typing a query returns grep results grouped by file
- [ ] Tapping a result opens the file in editor
- [ ] Case-sensitive toggle works

---

## Phase 5b: Tools Plugin (On-Device)

**Goal**: Text transforms, encoding, hashing — no server RPCs needed.

### Create `apps/mobile/src/plugins/extra/tools/ToolsPanel.tsx` (~250 lines)

- Category tabs: Format | Encode | Hash | String
- Tool selector: horizontal scroll of tool names within category
- Input: multiline `TextInput` with char count
- Output: selectable `Text` with copy button
- "Convert" button between input/output

### Create `apps/mobile/src/plugins/extra/tools/transforms.ts` (~120 lines)

- Format: JSON prettify, JSON minify
- Encode: Base64 encode/decode, URL encode/decode
- Hash: SHA-256 (via `expo-crypto` or `crypto` from React Native)
- String: lowercase, uppercase, reverse, trim

### Create `apps/mobile/src/plugins/extra/tools/index.tsx` (~40 lines)

- Registration: `{ id: 'tools', name: 'Tools', scope: 'workspace', kind: 'extra', icon: Wrench }`

### Done criteria
- [ ] Tools appears in Tabs modal
- [ ] Each transform category works
- [ ] Copy output to clipboard works

---

## Phase 6: Polish

1. Move `plugins/server/*` directories to `plugins/extra/*` if not done in Phase 4
2. Clean up `ServerPluginDefinition` / `ServerPluginPanelProps` types if unused
3. Audit keyboard avoidance — bottom bar should dodge keyboard when composer is focused
4. Test Android hardware back button: drawer open → close drawer, drawer closed → go home
5. Verify `PluginRenderer` opacity-swap still works correctly with more plugins mounted
6. Update `plans/followups.md` with any new items

### Done criteria
- [ ] Directory structure: `plugins/core/` (ai only), `plugins/workspace/` (terminal, editor, git, browser, workspace-search), `plugins/extra/` (explorer, search, processes, ports, monitor, system-search, tools)
- [ ] No dead types or imports
- [ ] All files pass TypeScript compilation

---

## Dependency Graph

```
Phase 1 (Bottom Tab Bar) ─────────────────────────┐
  ├── Phase 2 (Session Drawer)                     │
  │     └── Phase 3 (Delete Sidebar+ServerTools)   │
  └── Phase 4 (Promote Server Plugins) ◄───────────┘
        ├── Phase 5a (Search Plugin)
        └── Phase 5b (Tools Plugin)
              └── Phase 6 (Polish)
```

Phases 2 and 4 can run in parallel after Phase 1.
Phases 5a and 5b are independent of each other.

---

## Key Files Reference

| File | Role | Current Lines |
|------|------|--------------|
| `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Main workspace layout | 305 |
| `apps/mobile/src/components/WorkspaceSidebar.tsx` | **DELETE** — sidebar rail | 330 |
| `apps/mobile/src/components/WorkspaceSidebarChats.tsx` | **DELETE** — sidebar chats | 161 |
| `apps/mobile/src/components/ServerToolsSheet.tsx` | **DELETE** — server tools sheet | 230 |
| `apps/mobile/src/components/PluginRenderer.tsx` | Panel opacity-swap (keep) | 125 |
| `apps/mobile/src/components/PluginHeader.tsx` | Per-plugin header | ~210 |
| `apps/mobile/src/stores/plugin-registry.ts` | Plugin registration store | ~320 |
| `apps/mobile/src/stores/session-registry.ts` | Per-plugin session registration | ~90 |
| `apps/mobile/src/stores/server-plugins-store.ts` | Processes/ports/monitor subs | ~340 |
| `apps/mobile/src/plugins/load.ts` | Plugin import side-effects | ~30 |
| `packages/shared/src/plugin-types.ts` | PluginDefinition types | ~140 |
| `apps/mobile/src/theme/tokens.ts` | Design tokens | ~200 |

## Net Change

| | Lines |
|---|---|
| Deleted (sidebar, chats, ServerToolsSheet) | -721 |
| Created (BottomBar, Drawer, Search, Tools) | +1,030 |
| Modified (WorkspaceScreen, PluginHeader, registry, load, server plugins) | ~+50 |
| **Net** | **+359** |
