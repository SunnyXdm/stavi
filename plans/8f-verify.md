# Phase 8f Verification Script

Target: 5 minutes

## Prerequisites
- Server running: `cd packages/server-core && bun src/server.ts`
- Mobile app connected to server

---

## 1. Default to AI on workspace open

```
- Create a NEW workspace (never opened before)
- PASS: AI Chat panel is visible immediately — not Terminal, not Editor
- PASS: PluginHeader shows "AI" (or provider name if already configured)
- FAIL: Any other plugin panel is the first visible
```

## 2. New Chat button in AI panel header

```
- Open any workspace
- Navigate to AI tab
- PASS: A thin header bar appears above the message area showing the current
  chat title on the left and a "New Chat" button (PenLine icon + label) on the right
- Tap "New Chat"
- PASS: A new empty chat is created
- PASS: The message area clears to the empty-chat state
- PASS: The previous chat is preserved (visible in expanded sidebar)
```

## 3. New Chat from sidebar

```
- Expand the sidebar (swipe right or tap the icon edge)
- Tap the PenLine icon next to "CHATS" label
- PASS: New empty chat created
- PASS: AI tab is active
- PASS: Message area shows empty state for the new chat
```

## 4. Chat switching via sidebar

```
- Have 2+ chats with messages in a workspace
- Expand sidebar
- PASS: Both chats listed under "CHATS" section
- PASS: Active chat has accent left border + highlighted background
- Tap the non-active chat
- PASS: AI panel switches to show that chat's message history
- PASS: AI tab becomes the active plugin tab (if you were on Terminal before)
- PASS: activeThreadId updates — no stale messages shown
```

## 5. First message auto-creates chat (empty workspace)

```
- Open a workspace with zero chats (or create a new workspace)
- PASS: Empty state shows "Start a conversation" prompt
- Type a message in the composer and send
- PASS: Chat is auto-created via ensureActiveThread
- PASS: Your message appears + AI responds
- PASS: Sidebar chat list now shows 1 chat
```

## 6. Multiple chats persist across switches

```
- Create 3 chats with unique messages each
- Switch between them via sidebar
- PASS: Each chat retains its own message history (opacity:0 hide, not unmount)
- PASS: Active chat indicator in sidebar moves to the selected chat
```

## 7. Re-open workspace retains last active tab

```
- Open workspace, switch to Terminal tab
- Navigate to Home, re-open the same workspace
- PASS: Terminal tab is still active (last-active respected)
- (Default-to-AI only fires on first init when activeTabId is null)
```

---

## Automated checks

```bash
# 1. No hardcoded colors/fonts in changed files
grep -En "(#[0-9a-fA-F]{3,6}|rgba\(|fontSize: [0-9]|fontWeight: '[0-9])" \
  apps/mobile/src/plugins/workspace/ai/useOrchestration.ts \
  apps/mobile/src/plugins/workspace/ai/index.tsx
# PASS: no output

# 2. createNewChat exported from useOrchestration
grep -n "createNewChat" apps/mobile/src/plugins/workspace/ai/useOrchestration.ts
# PASS: appears in function definition + return value

# 3. onCreateSession wired in ai/index.tsx
grep -n "createNewChat" apps/mobile/src/plugins/workspace/ai/index.tsx
# PASS: appears in useEffect + chatHeader button handler

# 4. initialize defaults to AI tab (navOrder 0)
grep -n "navOrder.*=== 0\|navOrder === 0" apps/mobile/src/stores/plugin-registry.ts
# PASS: line present

# 5. tsc clean
cd apps/mobile && npx tsc --noEmit
# PASS: exit 0
```
