# Phase 8g Verification Script

Target: 5 minutes

## Prerequisites
- Server running: `cd packages/server-core && bun src/server.ts`
- Mobile app connected to server

---

## 1. File size compliance

```bash
wc -l \
  apps/mobile/src/plugins/workspace/ai/index.tsx \
  apps/mobile/src/plugins/workspace/ai/useOrchestration.ts \
  apps/mobile/src/plugins/workspace/ai/hooks/useThreadManager.ts \
  apps/mobile/src/plugins/workspace/ai/utils/event-reducer.ts \
  apps/mobile/src/plugins/workspace/ai/hooks/useModelSelection.ts \
  apps/mobile/src/plugins/workspace/ai/api.ts \
  apps/mobile/src/plugins/workspace/ai/aiPanelStyles.ts \
  apps/mobile/src/plugins/workspace/ai/components/CommandPartsDropdown.tsx \
  apps/mobile/src/plugins/workspace/ai/components/ThinkingIndicator.tsx
# PASS: all < 400 lines each
```

## 2. No DrawerContent references

```bash
grep -rn "DrawerContent" apps/mobile/src/ --include="*.ts" --include="*.tsx"
# PASS: no output (file deleted in 8e, all comments cleaned in 8g)
```

## 3. No hardcoded colors/fonts in split files

```bash
grep -En "(#[0-9a-fA-F]{3,6}|rgba\(|fontSize: [0-9]|fontWeight: '[0-9])" \
  apps/mobile/src/plugins/workspace/ai/index.tsx \
  apps/mobile/src/plugins/workspace/ai/useOrchestration.ts \
  apps/mobile/src/plugins/workspace/ai/hooks/useThreadManager.ts \
  apps/mobile/src/plugins/workspace/ai/utils/event-reducer.ts \
  apps/mobile/src/plugins/workspace/ai/hooks/useModelSelection.ts
# PASS: no output
```

## 4. tsc clean

```bash
cd apps/mobile && npx tsc --noEmit
# PASS: exit 0, no errors
```

## 5. Functional smoke test

```
- Open a workspace
- PASS: AI panel loads with chat header bar (title + New Chat button)
- Tap "New Chat"
- PASS: New empty chat created, message area clears
- Send a message in the new chat
- PASS: Message appears, AI responds
- Switch to Terminal tab, then back to AI tab
- PASS: AI message history preserved (opacity:0 pattern intact)
```

## 6. Sidebar chat list still works

```
- Have 2+ chats
- Expand sidebar (swipe right)
- PASS: Both chats listed under "CHATS" section
- Tap non-active chat
- PASS: AI panel switches to that chat's history
```

## 7. MENTAL-MODEL.md reflects Phase 8 reality

```bash
grep -n "sidebar\|Sidebar\|Phase 8e\|Phase 8f\|Phase 8g" docs/MENTAL-MODEL.md
# PASS: sidebar layout section present, all three phases in Phase History table
```

## 8. followups.md updated

```bash
grep -n "CLOSED in Phase 8g\|Phase 8g" plans/followups.md
# PASS: several items closed, Phase 8g section exists
```
