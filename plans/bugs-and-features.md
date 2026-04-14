# Bugs & Feature Gaps — Full List
_Written: 2026-04-13_

## Bugs

### BUG-1: Default tab is Terminal, should be AI ✦ HIGH
**Root cause**: `plugin-registry.ts` `initialize()` skips `allowMultipleInstances` plugins (AI) when building the initial tab list. Terminal is `navOrder: 2` but is a singleton — it gets a tab. AI is `allowMultipleInstances: true` — it gets no tab. So `tabs[0]` ends up being terminal.
**Fix**: In `initialize()`, create a default empty tab for multi-instance core nav plugins (AI). Also prefer AI as the initial `activeTabId`.

### BUG-2: Cannot reconnect to same server without restarting app ✦ HIGH
**Root cause**: Race condition in `stavi-client.ts`. When `disconnect()` is called, it calls `this.ws.close(1000, ...)` and immediately sets `isIntentionalClose = true`. Then when `connect()` is called, `isIntentionalClose = false` again. But the OLD WebSocket's `onclose` event fires asynchronously AFTER `isIntentionalClose` is reset to `false`. Since the close was with code 1000 (clean), `wasClean = true`, so the handler hits:
```ts
} else if (!this.isIntentionalClose) {
  this._setState('disconnected');  // ← fires during new connect attempt
}
```
This overwrites the 'authenticating'/'connecting' state set by the new connect, causing the connection store to flicker to 'disconnected' mid-connect, which the UI often can't recover from.
**Fix**: In `_openWebSocket()`, nullify the old WebSocket's `onclose` handler before closing it: `this.ws.onclose = null`.

### BUG-3: Android terminal shows raw ANSI escape codes ✦ HIGH
**Root cause**: Terminal history is written to the native view before `onTerminalReady` fires. The native TerminalView needs to be initialized (sized correctly) before receiving data. Writing history at wrong size causes ANSI parser to break. Also the `toybox: Unknown command 999999999` line at the top suggests the terminal resize is sending numerical data as text to the PTY (native Kotlin issue — the `Commands.resize()` may be sending to stdin instead of as a PTY IOCTL).
**Fix (JS layer)**: Defer writing history until `onTerminalReady` has fired. Use a `pendingHistory` ref per session.
**Fix (native layer)**: Investigate Kotlin `Commands.resize` implementation — it should send IOCTL not text.

### BUG-4: iOS terminal shows raw ANSI escape codes ✦ HIGH  
**Root cause**: iOS fallback is a `ScrollView + Text` component that renders the PTY output as-is. ANSI escape codes are not processed and appear as literal text (`[38;2;87;199;255m`, etc.).
**Fix (quick)**: Strip ANSI escape sequences before rendering in the iOS fallback.
**Fix (proper)**: Implement xterm.js via WebView (same approach as lunel) for proper terminal emulation on iOS.

### BUG-5: Drawer shows all plugin sessions, should show current plugin only
**Root cause**: `DrawerContent.tsx` renders all `sections` (AI, Terminal, Git, Editor) regardless of active plugin. Lunel's drawer shows only sessions for the currently active plugin.
**Fix**: Filter `sections` to only the active plugin's `pluginId`.

---

## Feature Gaps

### FEAT-1: AI empty state needs "+ New Session" button
**Current**: Empty state shows a dim icon and text "Pick a provider below, then send the first message". No clear CTA.
**Desired**: Centered "+ New AI Session" button that triggers the directory picker.

### FEAT-2: Header title should show provider name, not generic "AI"
**Current**: Header shows "AI" always.
**Desired**: Show "Claude" or "Codex" when an AI session is active with a selected provider. Show directory name in tab strip.

### FEAT-3: Directory picker should always be accessible from AI header
**Current**: "+" in header calls `handleHeaderCreateInstance → handleCreateInstance` which does show the dir picker. But when there are no AI tabs at all, the "+" isn't shown because `activePluginAllowsMultiple` requires an active tab.
**Fix**: After BUG-1 fix (default AI tab exists), the "+" will always show for AI.

### FEAT-4: No browser plugin (like lunel)
**Desired**: WebView-based browser plugin. Minimal: shows a URL bar + WebView. Nav bar item.

### FEAT-5: No keyboard toolbar on terminal
**Desired**: A row of buttons above the keyboard with common terminal inputs:
`Tab` `Ctrl+C` `↑` `↓` `←` `→` `Esc` `|` `` ` `` `~`
Lunel has this; it makes terminal usable on mobile.

### FEAT-6: Settings screen missing
**Desired**: A proper settings screen accessible from the drawer. Should include:
- Server info / disconnect
- Appearance (theme, font size)
- Terminal settings (font size)
- About

### FEAT-7: Drawer "Servers" nav goes home but Settings is missing
**Current**: Drawer has "Servers" nav but no "Settings" nav.
**Fix**: Add Settings nav → navigate to WorkspaceSettings screen.

---

## Implementation Order

**Phase 1 — Bugs first (everything below is pure JS, no native changes)**

1. BUG-2: Reconnect fix (stavi-client.ts, 2 lines)
2. BUG-1: Default AI tab in initialize() (plugin-registry.ts, ~15 lines)
3. FEAT-1: AI empty state "+ New Session" button (ai/index.tsx)
4. BUG-5: Drawer filter to current plugin (DrawerContent.tsx, 5 lines)
5. FEAT-2: Header title shows provider (PluginHeader.tsx + ai/index.tsx)
6. BUG-4: iOS ANSI stripping (NativeTerminal.tsx)
7. BUG-3: Defer history write until terminal ready (terminal/index.tsx)
8. FEAT-5: Terminal keyboard toolbar (new component)

**Phase 2 — New features** ✅ COMPLETE

9. FEAT-4: Browser plugin — ✅ `apps/mobile/src/plugins/core/browser/index.tsx`
10. FEAT-6 + FEAT-7: Settings screen + drawer nav — ✅ `apps/mobile/src/navigation/SettingsScreen.tsx`
11. BUG-3 native: Investigate Kotlin resize IOCTL issue (pending — requires Android native work)

**Phase 3 — Polish (pending)**
12. Proper iOS terminal via xterm.js WebView
13. AnimatedPressable with Reanimated spring scale on all pressables
14. Haptic feedback throughout app
15. Remove bottom bar border (`borderTopWidth: StyleSheet.hairlineWidth` in PluginBottomBar.tsx)
