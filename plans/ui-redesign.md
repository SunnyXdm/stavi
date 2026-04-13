# UI Redesign Plan — Match t3code Quality
_Written: 2026-04-12_

## t3code UI Patterns (from screenshots)

The t3code web app has:
1. **Clean dark chat area** — almost empty, minimal chrome
2. **Model chip at bottom** — shows current model (e.g. "GPT-5.4") with "..." menu
3. **Compact popover menus** — slide up from the chip, NOT a full-screen modal
4. **Provider hierarchy**: Provider → Model list with nested submenu arrows (►)
5. **COMING SOON labels** — greyed out rows for Cursor, OpenCode, Gemini
6. **Provider icons** — small colored logo per provider
7. **Effort/Mode/Access in the popover** — checkmarks for selected options, no separate sheet
8. **Branch indicator** — "main" text at bottom right

## Our Current UI

- ConfigSheet: Full 70%-height Modal bottom sheet with scrollable content
- Composer: Shows model chip (provider + model name) that opens the sheet
- Works but feels heavy vs t3code's lightweight popover

## Redesign Plan

### Phase 1: Quick wins (no redesign needed)

1. **Add provider accent colors** to ConfigSheet model rows:
   - Claude: purple/violet (#7C3AED)  
   - Codex/OpenAI: green (#10B981)
   - OpenCode: orange (future)

2. **Add "COMING SOON" row** for OpenCode in the provider list

3. **Fix effort label**: t3code uses "Extra High / High (default) / Medium / Low"
   — our labels are "Low / Medium / High / Max". Rename Max→Extra High for parity.

4. **Checkmark style**: Use a checkmark at the left of selected item (t3code style)
   instead of right-side icon + border.

### Phase 2: Compact popover (medium effort)

Replace the full-screen Modal with a `View` positioned above the composer chip.
Use `Animated` for slide-up. The popover should:
- Appear above the model chip
- Show provider list with ► expand arrows
- Show sub-menu when provider is tapped
- Include effort/mode/access as list items with checkmarks
- Dismiss on backdrop tap or chip tap

Implementation: Use `react-native-reanimated` for smooth animation, or just
`Animated.spring` from core RN.

### Phase 3: Composer redesign (heavy)

t3code's composer shows:
- Multiline text input (large area)
- Model chip bottom-left with icon + name
- Send button bottom-right (circular, accent color)
- "Ask for follow-up..." placeholder text

Our composer is currently missing visual polish. Key improvements:
- Bigger input area
- Show effort level inline on the chip
- Add subtle border/shadow on focus
- Match font styling

### Phase 4: Message bubbles

t3code messages:
- User messages: right-aligned, subtle background
- Assistant messages: left-aligned, no bubble (flat text)
- Tool calls: indented, monospace, collapsible

Our MessageBubble.tsx already has most of this. Need to verify rendering.

---

## Token-efficient implementation notes

- Start with Phase 1 (ConfigSheet.tsx changes only, ~50 lines)
- Then Phase 2 (new Popover component, ~150 lines)
- Each phase can be shipped independently
