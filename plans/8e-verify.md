# Phase 8e Verification Script

Target: 10 minutes

## Prerequisites
- Server running: `cd packages/server-core && bun src/server.ts`
- Mobile app built and connected: `cd apps/mobile && npx react-native run-android`
- At least one workspace exists

---

## 1. Sidebar renders (no bottom bar)

```
- Open a workspace
- PASS: Left icon rail visible (~52px wide) with tool icons stacked vertically
- PASS: No bottom tab bar anywhere in the workspace view
- PASS: Content area takes full remaining width
```

## 2. Tool switching via sidebar

```
- Tap each icon in the icon rail (AI, Terminal, Editor, Git, Explorer, Browser)
- PASS: Content area switches to that plugin's panel on each tap
- PASS: Active icon gets accent highlight (indigo left border + subtle background)
- PASS: Inactive icons are dimmed (fg.tertiary color)
```

## 3. Sidebar expand/collapse

```
# Via swipe:
- Swipe right on the icon rail
- PASS: Sidebar animates to ~260px, showing icon + label text
- Swipe left on expanded sidebar
- PASS: Sidebar collapses back to 52px icon-only rail

# Via tap outside:
- Expand sidebar
- Tap anywhere in the content area
- PASS: Sidebar collapses

# Via tap icon edge:
- Tap the sidebar when expanded (no plugin icon) — should toggle collapse
```

## 4. Active chats list (expanded sidebar)

```
- Have 2+ chats in a workspace (send messages in AI tab to create them)
- Expand sidebar
- PASS: Chats section visible below plugin icons with "CHATS" label
- PASS: Each chat shows its title, truncated to one line
- PASS: Active chat has accent left border + highlighted background
- Tap a different chat
- PASS: AI panel switches to show that chat's messages
- PASS: Previously active tab stays selected if it was AI
```

## 5. New Chat button

```
- Expand sidebar
- Tap the PenLine icon next to "CHATS" label
- PASS: New chat is created (or AI tab opens if no session registered)
```

## 6. Home and Settings navigation

```
- Expand or stay collapsed sidebar
- Tap Home icon (bottom of sidebar)
- PASS: Navigates to SessionsHome screen

- Return to workspace
- Tap Settings icon (bottom of sidebar)
- PASS: Navigates to Settings screen
```

## 7. Android hardware back button

```
- Open a workspace
- Press Android hardware back button
- PASS: Navigates to SessionsHome (not exits the app)
```

## 8. Small phone compatibility

```
- On a device/emulator with 360px logical width
- PASS: Icon rail is 52px, content area is 308px — still usable
- PASS: No layout overflow
```

## 9. Keyboard + sidebar interaction

```
- Open AI tab (with composer)
- Tap the composer input to open keyboard
- PASS: Icon rail remains visible (not hidden by keyboard)
- PASS: Sidebar does NOT auto-expand when keyboard opens
- PASS: Content area adjusts to keyboard height; sidebar stays 52px wide
```

## 10. PluginRenderer opacity pattern (state preservation)

```
- Open AI tab, send a message, wait for response
- Switch to Terminal tab
- Switch back to AI tab
- PASS: Message history is preserved (panel was hidden via opacity, not unmounted)
- PASS: No re-subscription or re-fetch of AI messages
```

## 11. useOrchestration reactive connection state

```
- Open a workspace with AI tab
- Kill the server
- PASS: UI reflects disconnected state (spinner/error state in AI panel)
- Restart server
- PASS: UI updates to show connected state without requiring full app restart
  (Previously this was stale because getState() was called once on mount)
```

---

## Automated grep checks

Run these after implementation:

```bash
# 1. No imports of PluginBottomBar
grep -rn "PluginBottomBar" apps/mobile/src/ --include="*.ts" --include="*.tsx"
# PASS: no output

# 2. No imports of DrawerContent
grep -rn "\".*DrawerContent\"" apps/mobile/src/ --include="*.ts" --include="*.tsx"  
# PASS: no output

# 3. No hardcoded hex colors or rgba in new files
grep -En "(#[0-9a-fA-F]{3,6}|rgba\()" apps/mobile/src/components/WorkspaceSidebar.tsx apps/mobile/src/components/WorkspaceSidebarChats.tsx apps/mobile/src/navigation/WorkspaceScreen.tsx apps/mobile/src/components/PluginHeader.tsx
# PASS: no output

# 4. No drawer animation vars in WorkspaceScreen
grep -n "drawerAnim\|openDrawer\|closeDrawer\|DRAWER_WIDTH\|bottomBarHeight" apps/mobile/src/navigation/WorkspaceScreen.tsx
# PASS: no output

# 5. PluginRenderer opacity pattern preserved
grep -n "opacity.*0\|panelHidden" apps/mobile/src/components/PluginRenderer.tsx
# PASS: panelHidden: { opacity: 0 } present

# 6. tsc --noEmit
cd apps/mobile && npx tsc --noEmit
# PASS: exit 0, no errors

# 7. All new files under 400 lines
wc -l apps/mobile/src/components/WorkspaceSidebar.tsx apps/mobile/src/components/WorkspaceSidebarChats.tsx apps/mobile/src/navigation/WorkspaceScreen.tsx apps/mobile/src/components/PluginHeader.tsx
# PASS: all < 400
```
