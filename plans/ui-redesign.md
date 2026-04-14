# UI Redesign Plan
_Updated: 2026-04-13_

## Source of Truth

This plan consolidates learnings from:
- **t3code** — compact model picker, provider icons, COMING SOON states
- **lunel** (`/Users/sunny/claude-code-remote/lunel/app`) — full codebase deep-read
- **litter** (`/Users/sunny/claude-code-remote/litter`) — theme system architecture

---

## Lunel Analysis — What to Copy

Lunel is the closest reference architecture. Key file: `lunel/app/plugins/core/ai/Panel.tsx`.

### Design philosophy (already adopted in stavi tokens)
- No borders — bg layering only
- Opacity-based text hierarchy (primary/secondary/tertiary/muted)
- Single accent color used sparingly
- 4px grid spacing
- IBM Plex Sans + JetBrains Mono
- No shadows in dark mode

### Lunel patterns stavi is missing

| Gap | Lunel | Stavi | File to fix |
|-----|-------|-------|-------------|
| Press animation | Spring scale 1→0.97 (Reanimated native thread) | None | All pressables |
| Bottom bar border | None — bg contrast only | `hairlineWidth` border | PluginBottomBar.tsx |
| Haptic feedback | Every nav press, send, approval | Zero | All interactive |
| Header tab strip | Scrollable chips when >1 instance open | Just shows plugin name | PluginHeader.tsx |
| Bottom sheet | Reanimated + gesture-to-dismiss | Modal animationType="slide" | PluginBottomBar.tsx |
| Drawer animation | Reanimated spring | Animated.timing (JS thread) | WorkspaceScreen.tsx |
| ThinkingIndicator | Reanimated withRepeat (native) | Animated.loop (JS thread) | ai/index.tsx |
| Access chip icon | Shield icon | `icon: null` | Composer.tsx |
| scrollToEnd | onContentSizeChange only | setTimeout(100) + onContentSizeChange race | ai/index.tsx |

---

## Litter Theme System — What to Learn

Litter uses: VS Code theme JSON → semantic resolver → singleton accessor (`LitterTheme.accent`, `LitterTheme.textPrimary`).

**Key pattern: singleton accessor instead of importing `colors` everywhere.**

```ts
// Litter pattern (Android/Kotlin analog):
object LitterTheme {
  val accent get() = LitterThemeManager.activeTheme.accent
  val textPrimary get() = LitterThemeManager.activeTheme.textPrimary
}

// React Native equivalent to adopt in stavi:
// Instead of importing `colors` everywhere, expose a reactive Theme object
// backed by a Zustand store. When theme changes, all consumers rerender.
```

Litter also separates light/dark theme selection independently — user picks "Dracula" for dark and "Codex Light" for light from a catalog.

**What stavi should adopt now:** The singleton accessor pattern. Currently `colors` is imported as a static object everywhere. A `useTheme()` hook or a reactive `Theme` singleton prepares us for dark/light switching without touching every file.

**What stavi can skip for now:** VS Code JSON compatibility, automatic token derivation. The handcrafted tokens in `tokens.ts` are good.

---

## Tab Restructure

### Bottom nav — proposed order
```
[ AI ]  [ Terminal ]  [ Git ]  [ Editor ]  [ ⊞ Tools ]
  0         1           2         3
```

Tools sheet contains: Explorer, Search, Monitor, Ports, Processes

### The key change: header tab strip for multi-instance switching

When a plugin allows multiple instances and ≥2 are open, PluginHeader shows a horizontal scrollable chip strip below the title row:

```
┌──────────────────────────────────────┐
│ ☰  AI                            +  │   ← title row (56px)
│ [workspace AI] [/tmp AI] [project AI]│   ← tab strip (36px, only when >1)
└──────────────────────────────────────┘
```

Tapping a chip switches the active instance. This eliminates the need to open the drawer to switch AI sessions.

---

## Implementation Phases

### Phase 1 — Feel (P0, highest ROI)
These make the whole app feel dramatically more polished.

**1a. Remove bottom bar border**
- `PluginBottomBar.tsx` — delete `borderTopWidth` and `borderTopColor`
- Pure bg contrast: nav bar is `bg.raised` (#212121) over content `bg.base` (#161616)

**1b. AnimatedPressable with spring scale**
- New component: `components/AnimatedPressable.tsx`
- Uses Reanimated: `useSharedValue`, `withSpring`, `useAnimatedStyle`
- Spring config: `{ damping: 15, stiffness: 400, mass: 0.6 }`
- Scale: `pressIn → 0.96`, `pressOut → 1.0`
- Apply to: bottom nav items, all composer chips, send button, approval buttons, sheet items

**1c. Haptic feedback**
- Package: `react-native-haptic-feedback` (already likely in package.json) or `expo-haptics`
- Triggers: nav tab press, send message, approve/reject, open Tools sheet

### Phase 2 — Tab UX (P1)

**2a. PluginHeader internal tab strip**
- Read `openTabs` from plugin registry
- Filter to tabs of the active plugin type
- Render horizontal ScrollView of chips when count > 1
- Active chip: accent color bg, primary text
- Inactive chip: transparent bg, tertiary text
- Tap → `setActiveTab(id)`
- Height: 36px additional, only visible when >1 instance

**2b. Better active indicator on bottom bar**
- Replace icon+label color change with an animated dot or pill under the active item
- Use Reanimated `useAnimatedStyle` to slide the indicator when switching tabs

**2c. Tools sheet → proper bottom sheet**
- Replace `Modal animationType="slide"` with a Reanimated bottom sheet
- Gesture-to-dismiss (swipe down closes)
- Animated backdrop opacity (0→0.5 in 100ms)
- Spring-driven position: `{ damping: 20, stiffness: 300 }`

### Phase 3 — Animation quality (P2)

**3a. Drawer → Reanimated spring**
- `WorkspaceScreen.tsx` — replace `Animated.timing` with Reanimated spring
- Drawer slides with natural deceleration, not linear timing

**3b. ThinkingIndicator → Reanimated**
- Replace 3x `Animated.Value` + `Animated.loop` with Reanimated `withRepeat`/`withDelay`
- Native thread = no JS jank during heavy streaming

**3c. Fix scrollToEnd race**
- `ai/index.tsx` — remove the `setTimeout(100)` block entirely
- Keep only the `onContentSizeChange` handler (already correct)

### Phase 4 — Composer polish (P2)

**4a. Fix Access chip icon**
- Add `Shield` icon (lucide) to the Access chip in `Composer.tsx`
- Supervised: `Shield`, Auto: `ShieldCheck`, Full: `ShieldOff`

**4b. Voice input button**
- Mic icon left of the text input
- Requires `expo-av` for recording + `/api/transcribe` endpoint on server

### Phase 5 — Theme system (P3)

**5a. Theme singleton adapter**
- New file: `theme/ThemeStore.ts`
- Zustand store: `{ activeTheme: 'dark' | 'light', colors: Colors }`
- Export `useThemeColors()` hook (wraps `useStore`)
- Migrate imports: `import { colors } from '../theme'` → `const colors = useThemeColors()`
- This is a refactor-only step — no visual change

**5b. Light theme tokens**
- Add `lightColors` to `tokens.ts` alongside existing dark `colors`
- System auto-switch + manual override in settings

---

## What's Already Done (do not redo)

From `competitive-research.md` + previous session:
- ✅ ConfigSheet → ModelPopover (compact popover, not full modal)
- ✅ Provider icons (ProviderIcon.tsx)
- ✅ Effort level chips in composer toolbar
- ✅ Mode toggle (Chat / Plan)
- ✅ Access level chip
- ✅ FlashList for messages
- ✅ CommandPartsDropdown for tool groups
- ✅ ThinkingIndicator (dots)
