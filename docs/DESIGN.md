# Stavi Design System

> **Token-based. Borderless. Dark-first.**
> Depth through background layering, not borders. Opacity-based text hierarchy. Accent scarcity.
> Calm, borderless aesthetic — warmer grays, mint teal accent.

---

## Table of Contents

1. [Philosophy](#1-philosophy)
2. [File Structure](#2-file-structure)
3. [Color Tokens](#3-color-tokens)
4. [Typography Tokens](#4-typography-tokens)
5. [Spacing Scale](#5-spacing-scale)
6. [Border Radii](#6-border-radii)
7. [Shadows](#7-shadows)
8. [Motion Tokens](#8-motion-tokens)
9. [Z-Index Scale](#9-z-index-scale)
10. [Shared Style Objects](#10-shared-style-objects)
11. [Text Styles — Computed Values](#11-text-styles--computed-values)
12. [Surface Styles](#12-surface-styles)
13. [Layout Helpers](#13-layout-helpers)
14. [Interactive Element Styles](#14-interactive-element-styles)
15. [Typography Reference Table](#15-typography-reference-table)
16. [Component Patterns](#16-component-patterns)
17. [Plugin Renderer: The Opacity-Swap Pattern](#17-plugin-renderer-the-opacity-swap-pattern)
18. [Bottom Bar Navigation](#18-bottom-bar-navigation)
19. [Font Loading](#19-font-loading)
20. [Navigation Theme Integration](#20-navigation-theme-integration)
21. [Naming Conventions](#21-naming-conventions)
22. [Anti-Patterns (Explicitly Documented)](#22-anti-patterns-explicitly-documented)
23. [Design Decisions & Notes](#23-design-decisions--notes)

---

## 1. Philosophy

The design system is built around five core rules drawn directly from code comments:

| Rule | Implementation |
|------|----------------|
| **Depth through layering** | Five background shades (`bg.base` through `bg.elevated`) replace borders and shadows |
| **Opacity-based text hierarchy** | Four foreground levels (`fg.primary` through `fg.muted`) on a single base white |
| **Accent scarcity** | A single mint-teal hue family (`accent.*`) — never mix accent colors |
| **No shadows in dark mode** | The `shadows` object is intentionally empty; use `bg` layering instead |
| **No borders** | `StyleSheet.hairlineWidth` borders appear only where explicit separation is architecturally necessary |

> The `divider` color (`rgba(255, 255, 255, 0.06)`) is the sole concession: "Very subtle separation when layering isn't enough."

---

## 2. File Structure

```
apps/mobile/src/theme/
├── tokens.ts      # All raw token values — source of truth
├── styles.ts      # Composed StyleSheet objects built from tokens
└── index.ts       # Re-exports everything (single import point)
```

**Import pattern** (always from the barrel):

```ts
import { colors, typography, spacing, radii, motion, zIndex } from '../theme';
import { textStyles, surfaceStyles, layoutStyles, interactiveStyles } from '../theme/styles';
```

---

## 3. Color Tokens

Source: `apps/mobile/src/theme/tokens.ts` → `export const colors`

### 3.1 Background Layers

Background layers create visual depth. Each step is ~10–12 lightness units apart.

| Token | Hex | Usage |
|-------|-----|-------|
| `colors.bg.base` | `#161616` | App background, deepest layer |
| `colors.bg.raised` | `#212121` | Cards, panels, elevated surfaces |
| `colors.bg.overlay` | `#2a2a2a` | Modals, sheets, floating UI |
| `colors.bg.elevated` | `#333333` | Tooltips, popovers, highest layer |
| `colors.bg.input` | `#1e1e1e` | Text inputs, search bars (between base and raised) |
| `colors.bg.active` | `#383838` | Pressed/selected state backgrounds |
| `colors.bg.scrim` | `rgba(0, 0, 0, 0.5)` | Modal backdrop overlay |

**Layering order** (darkest → lightest):

```
base (#161616) → input (#1e1e1e) → raised (#212121) → overlay (#2a2a2a) → elevated (#333333) → active (#383838)
```

### 3.2 Foreground Colors

A single base white with opacity-based hierarchy. All are WCAG AA compliant on `#161616`.

| Token | Hex | Approx. Opacity | Usage |
|-------|-----|-----------------|-------|
| `colors.fg.primary` | `#fafafa` | ~100% | Headings, important text, interactive labels |
| `colors.fg.secondary` | `#c0c0c0` | ~75% | Body text, descriptions |
| `colors.fg.tertiary` | `#9e9e9e` | ~62% | Placeholders, captions, timestamps |
| `colors.fg.muted` | `#666666` | ~40% | Disabled text, decorative labels |
| `colors.fg.onAccent` | `#0a0f0d` | — | Dark text on accent-colored backgrounds |

### 3.3 Accent Colors

Single mint-teal hue family. **Never mix with other accent colors.**

| Token | Value | Usage |
|-------|-------|-------|
| `colors.accent.primary` | `#5fccb0` | Buttons, active tabs, links |
| `colors.accent.secondary` | `#4db89d` | Hover/pressed state (slightly darker) |
| `colors.accent.subtle` | `rgba(95, 204, 176, 0.12)` | Accent tint backgrounds |
| `colors.accent.glow` | `rgba(95, 204, 176, 0.25)` | Focus rings, selection highlights |

### 3.4 Semantic Colors

For status indicators **only** — never for decoration.

| Token | Hex | Usage |
|-------|-----|-------|
| `colors.semantic.success` | `#4ade80` | Git staged, test passed, connected |
| `colors.semantic.warning` | `#fbbf24` | Unstaged changes, pending approval |
| `colors.semantic.error` | `#f87171` | Errors, disconnected, test failed |
| `colors.semantic.info` | `#60a5fa` | Information banners, tips |
| `colors.semantic.successSubtle` | `rgba(74, 222, 128, 0.12)` | Success tint background |
| `colors.semantic.warningSubtle` | `rgba(251, 191, 36, 0.12)` | Warning tint background |
| `colors.semantic.errorSubtle` | `rgba(248, 113, 113, 0.12)` | Error tint background |
| `colors.semantic.infoSubtle` | `rgba(96, 165, 250, 0.12)` | Info tint background |

### 3.5 Terminal ANSI Palette

Optimized for readability on `#161616` base.

| Token | Hex |
|-------|-----|
| `colors.terminal.black` | `#1e1e1e` |
| `colors.terminal.red` | `#f87171` |
| `colors.terminal.green` | `#4ade80` |
| `colors.terminal.yellow` | `#fbbf24` |
| `colors.terminal.blue` | `#60a5fa` |
| `colors.terminal.magenta` | `#c084fc` |
| `colors.terminal.cyan` | `#22d3ee` |
| `colors.terminal.white` | `#e5e5e5` |
| `colors.terminal.brightBlack` | `#4a4a4a` |
| `colors.terminal.brightRed` | `#fca5a5` |
| `colors.terminal.brightGreen` | `#86efac` |
| `colors.terminal.brightYellow` | `#fde68a` |
| `colors.terminal.brightBlue` | `#93c5fd` |
| `colors.terminal.brightMagenta` | `#d8b4fe` |
| `colors.terminal.brightCyan` | `#67e8f9` |
| `colors.terminal.brightWhite` | `#fafafa` |

### 3.6 Utility

| Token | Value | Usage |
|-------|-------|-------|
| `colors.transparent` | `'transparent'` | Explicit transparent fills |
| `colors.divider` | `rgba(255, 255, 255, 0.06)` | Last-resort separation when layering isn't enough |

---

## 4. Typography Tokens

Source: `apps/mobile/src/theme/tokens.ts` → `export const typography`

### 4.1 Font Families

| Token | Value | Purpose |
|-------|-------|---------|
| `typography.fontFamily.sans` | `'IBMPlexSans'` | UI text — clean, technical, humanist |
| `typography.fontFamily.sansMedium` | `'IBMPlexSans-Medium'` | Medium weight sans |
| `typography.fontFamily.sansSemiBold` | `'IBMPlexSans-SemiBold'` | SemiBold weight sans |
| `typography.fontFamily.sansBold` | `'IBMPlexSans-Bold'` | Bold weight sans |
| `typography.fontFamily.mono` | `'JetBrainsMono'` | Code, terminal, data — ligatures disabled |
| `typography.fontFamily.monoMedium` | `'JetBrainsMono-Medium'` | Medium weight mono |
| `typography.fontFamily.monoBold` | `'JetBrainsMono-Bold'` | Bold weight mono |
| `typography.fontFamily.monoFallback` | `'monospace'` | System fallback if JetBrains Mono unavailable |

> **Design note:** The sans/mono split is intentional for data distinction. Mono is used for: file paths, host:port strings, git branch names, inline code snippets, token/bearer fields, line numbers, terminal output, ahead/behind counters.

### 4.2 Font Size Scale (1.2 modular scale)

| Token | Value (pt/px) |
|-------|--------------|
| `typography.fontSize.xs` | `11` |
| `typography.fontSize.sm` | `13` |
| `typography.fontSize.base` | `15` |
| `typography.fontSize.md` | `17` |
| `typography.fontSize.lg` | `20` |
| `typography.fontSize.xl` | `24` |
| `typography.fontSize['2xl']` | `29` |
| `typography.fontSize['3xl']` | `35` |

### 4.3 Line Height Multipliers

| Token | Value | Usage |
|-------|-------|-------|
| `typography.lineHeight.tight` | `1.2` | Headings, display text |
| `typography.lineHeight.normal` | `1.5` | Body text, descriptions |
| `typography.lineHeight.relaxed` | `1.7` | Long-form reading (defined but not currently used in components) |

### 4.4 Font Weights

| Token | Value |
|-------|-------|
| `typography.fontWeight.regular` | `'400'` |
| `typography.fontWeight.medium` | `'500'` |
| `typography.fontWeight.semibold` | `'600'` |
| `typography.fontWeight.bold` | `'700'` |

### 4.5 Letter Spacing

| Token | Value (px) |
|-------|-----------|
| `typography.letterSpacing.tight` | `-0.3` |
| `typography.letterSpacing.normal` | `0` |
| `typography.letterSpacing.wide` | `0.5` |
| `typography.letterSpacing.wider` | `1.0` |

**Usage guide:**
- `tight (-0.3)`: Large display headings (h1, h2), app title
- `normal (0)`: Most body text, h3/h4
- `wide (0.5)`: Labels, approval header text
- `wider (1.0)`: Section headers in UPPERCASE (git file sections, "SAVED SERVERS" label, approval header)

---

## 5. Spacing Scale

Source: `apps/mobile/src/theme/tokens.ts` → `export const spacing`

**4px grid system.** All values are exact multiples of 4.

| Token | Value (px) |
|-------|-----------|
| `spacing[0]` | `0` |
| `spacing[1]` | `4` |
| `spacing[2]` | `8` |
| `spacing[3]` | `12` |
| `spacing[4]` | `16` |
| `spacing[5]` | `20` |
| `spacing[6]` | `24` |
| `spacing[8]` | `32` |
| `spacing[10]` | `40` |
| `spacing[12]` | `48` |
| `spacing[16]` | `64` |

> Note: `spacing[7]`, `spacing[9]`, `spacing[11]`, and `spacing[13]`–`spacing[15]` are **not defined** in the scale.

---

## 6. Border Radii

Source: `apps/mobile/src/theme/tokens.ts` → `export const radii`

| Token | Value (px) |
|-------|-----------|
| `radii.none` | `0` |
| `radii.sm` | `4` |
| `radii.md` | `8` |
| `radii.lg` | `12` |
| `radii.xl` | `16` |
| `radii.full` | `9999` |

**Usage patterns from components:**

| Radius | Elements |
|--------|---------|
| `radii.sm` (4) | Tab pills, small chips, detail boxes inside cards |
| `radii.md` (8) | Inputs, small cards, buttons (primary/ghost/icon), error boxes, close button |
| `radii.lg` (12) | Main cards, raised/overlay surfaces, user message bubbles, logo container |
| `radii.xl` (16) | Bottom sheet (top corners only: `borderTopLeftRadius` + `borderTopRightRadius`) |
| `radii.full` (9999) | Sheet handle pill, status dots, streaming dots, step number badges, open indicator dot, send button |

---

## 7. Shadows

Source: `apps/mobile/src/theme/tokens.ts` → `export const shadows`

```ts
export const shadows = {
  // Intentionally empty for dark theme — use bg layering instead.
  // Adding shadows in dark mode is an anti-pattern.
} as const;
```

**The `shadows` object is deliberately empty.** This is a first-class design decision, not an omission. Shadows are reserved for a future light-theme implementation only.

---

## 8. Motion Tokens

Source: `apps/mobile/src/theme/tokens.ts` → `export const motion`

### 8.1 Durations

| Token | Value (ms) |
|-------|-----------|
| `motion.duration.fast` | `100` |
| `motion.duration.normal` | `200` |
| `motion.duration.slow` | `300` |
| `motion.duration.verySlow` | `500` |

### 8.2 Easing Curves

| Token | Value |
|-------|-------|
| `motion.easing.easeOut` | `'cubic-bezier(0.25, 0.46, 0.45, 0.94)'` |
| `motion.easing.easeIn` | `'cubic-bezier(0.55, 0.085, 0.68, 0.53)'` |
| `motion.easing.easeInOut` | `'cubic-bezier(0.645, 0.045, 0.355, 1)'` |
| `motion.easing.spring` | `{ damping: 20, stiffness: 300, mass: 0.8 }` |

> Motion tokens are defined but not yet consumed in current components. Navigation uses React Navigation's built-in `'fade'` animation. Reanimated spring configs should use the `motion.easing.spring` values.

---

## 9. Z-Index Scale

Source: `apps/mobile/src/theme/tokens.ts` → `export const zIndex`

| Token | Value |
|-------|-------|
| `zIndex.base` | `0` |
| `zIndex.dropdown` | `10` |
| `zIndex.sticky` | `20` |
| `zIndex.overlay` | `30` |
| `zIndex.modal` | `40` |
| `zIndex.toast` | `50` |

---

## 10. Shared Style Objects

Source: `apps/mobile/src/theme/styles.ts`

All shared styles are created via `StyleSheet.create()` for performance (processed and cached once by React Native). Four exported collections:

```ts
export { textStyles, surfaceStyles, layoutStyles, interactiveStyles }
```

**Rule:** Prefer these over inline style objects.

```tsx
// Correct
<Text style={textStyles.body}>Hello</Text>

// Anti-pattern — never do this
<Text style={{ fontSize: 15, color: '#c0c0c0' }}>Hello</Text>
```

---

## 11. Text Styles — Computed Values

Source: `apps/mobile/src/theme/styles.ts` → `textStyles`

### Headings

| Style | fontSize | fontWeight | color | letterSpacing | lineHeight (computed) |
|-------|----------|------------|-------|---------------|-----------------------|
| `textStyles.h1` | `35` | `'700'` | `#fafafa` | `-0.3` | `42` (35 × 1.2) |
| `textStyles.h2` | `29` | `'700'` | `#fafafa` | `-0.3` | `34.8` (29 × 1.2) |
| `textStyles.h3` | `24` | `'600'` | `#fafafa` | — | `28.8` (24 × 1.2) |
| `textStyles.h4` | `20` | `'600'` | `#fafafa` | — | `24` (20 × 1.2) |

> h1 and h2 specify `letterSpacing: -0.3` (tight). h3 and h4 do not set letterSpacing.

### Body

| Style | fontSize | fontWeight | color | lineHeight (computed) |
|-------|----------|------------|-------|-----------------------|
| `textStyles.body` | `15` | `'400'` | `#c0c0c0` | `22.5` (15 × 1.5) |
| `textStyles.bodySmall` | `13` | `'400'` | `#c0c0c0` | `19.5` (13 × 1.5) |

### Labels

| Style | fontSize | fontWeight | color | letterSpacing | textTransform |
|-------|----------|------------|-------|---------------|---------------|
| `textStyles.label` | `13` | `'500'` | `#fafafa` | `0.5` (wide) | — |
| `textStyles.labelSmall` | `11` | `'500'` | `#9e9e9e` | `1.0` (wider) | `'uppercase'` |

### Caption

| Style | fontSize | fontWeight | color | lineHeight (computed) |
|-------|----------|------------|-------|-----------------------|
| `textStyles.caption` | `11` | `'400'` | `#9e9e9e` | `16.5` (11 × 1.5) |

### Code / Monospace

| Style | fontSize | fontFamily | color | lineHeight |
|-------|----------|------------|-------|------------|
| `textStyles.code` | `13` | `'JetBrainsMono'` | `#fafafa` | — (not set) |
| `textStyles.codeSmall` | `11` | `'JetBrainsMono'` | `#c0c0c0` | — (not set) |

---

## 12. Surface Styles

Source: `apps/mobile/src/theme/styles.ts` → `surfaceStyles`

| Style | backgroundColor | borderRadius | paddingHorizontal | paddingVertical |
|-------|----------------|--------------|-------------------|-----------------|
| `surfaceStyles.base` | `#161616` | — | — | — |
| `surfaceStyles.raised` | `#212121` | `12` (lg) | — | — |
| `surfaceStyles.overlay` | `#2a2a2a` | `12` (lg) | — | — |
| `surfaceStyles.elevated` | `#333333` | `8` (md) | — | — |
| `surfaceStyles.input` | `#1e1e1e` | `8` (md) | `16` (spacing[4]) | `12` (spacing[3]) |

> `surfaceStyles.input` is the only surface style with built-in padding, making it drop-in ready for text input containers.

---

## 13. Layout Helpers

Source: `apps/mobile/src/theme/styles.ts` → `layoutStyles`

| Style | Properties |
|-------|-----------|
| `layoutStyles.flex1` | `{ flex: 1 }` |
| `layoutStyles.row` | `{ flexDirection: 'row' }` |
| `layoutStyles.rowCenter` | `{ flexDirection: 'row', alignItems: 'center' }` |
| `layoutStyles.rowBetween` | `{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }` |
| `layoutStyles.center` | `{ alignItems: 'center', justifyContent: 'center' }` |
| `layoutStyles.fill` | `{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }` |
| `layoutStyles.screenPadding` | `{ paddingHorizontal: 16 }` (spacing[4]) |

> `layoutStyles.fill` is equivalent to `StyleSheet.absoluteFillObject`. Both are used in the codebase.

---

## 14. Interactive Element Styles

Source: `apps/mobile/src/theme/styles.ts` → `interactiveStyles`

### Primary Button

| Property | Value |
|----------|-------|
| `backgroundColor` | `#5fccb0` (accent.primary) |
| `borderRadius` | `8` (radii.md) |
| `paddingHorizontal` | `24` (spacing[6]) |
| `paddingVertical` | `12` (spacing[3]) |
| `alignItems` | `'center'` |
| `justifyContent` | `'center'` |
| `minHeight` | `44` — accessibility minimum touch target |

### Primary Button Text

| Property | Value |
|----------|-------|
| `fontSize` | `15` (base) |
| `fontWeight` | `'600'` (semibold) |
| `color` | `#0a0f0d` (fg.onAccent) |

### Ghost Button

| Property | Value |
|----------|-------|
| `borderRadius` | `8` (radii.md) |
| `paddingHorizontal` | `16` (spacing[4]) |
| `paddingVertical` | `12` (spacing[3]) |
| `alignItems` | `'center'` |
| `justifyContent` | `'center'` |
| `minHeight` | `44` |

### Ghost Button Text

| Property | Value |
|----------|-------|
| `fontSize` | `15` (base) |
| `fontWeight` | `'500'` (medium) |
| `color` | `#c0c0c0` (fg.secondary) |

### Icon Button

| Property | Value |
|----------|-------|
| `width` | `40` |
| `height` | `40` |
| `borderRadius` | `8` (radii.md) |
| `alignItems` | `'center'` |
| `justifyContent` | `'center'` |

### Pressable Active Feedback

| Property | Value |
|----------|-------|
| `backgroundColor` | `#383838` (bg.active) |
| `borderRadius` | `8` (radii.md) |

---

## 15. Typography Reference Table

Every text-rendering situation across all components:

| Context | fontSize | fontWeight | color | fontFamily | letterSpacing | lineHeight |
|---------|----------|------------|-------|------------|---------------|------------|
| App title (ConnectScreen) | 35 | 700 | fg.primary | default | -0.3 | — |
| App subtitle | 15 | 400 | fg.tertiary | default | — | — |
| Section label (SAVED SERVERS) | 11 | 500 | fg.tertiary | default | 1.0 | — |
| Card name | 15 | 500 | fg.primary | default | — | — |
| Card host:port | 13 | 400 | fg.tertiary | mono | — | — |
| Add button text | 15 | 500 | accent.primary | default | — | — |
| Instructions title | 13 | 600 | fg.secondary | default | — | — |
| Step text | 13 | 400 | fg.secondary | default | — | 19.5 |
| Inline code snippet | — | — | accent.primary | mono | — | — |
| Modal header title | 20 | 600 | fg.primary | default | — | — |
| Field label | 13 | 500 | fg.secondary | default | — | — |
| Field input text | 15 | 400 | fg.primary | mono | — | — |
| Field hint text | 11 | 400 | fg.muted | default | — | — |
| Error text | 13 | 400 | semantic.error | default | — | — |
| Connect button text | 15 | 600 | fg.onAccent | default | — | — |
| Nav bar label (inactive) | 11 | 500 | fg.tertiary | default | — | — |
| Nav bar label (active) | 11 | 500 | accent.primary | default | — | — |
| Sheet title | 20 | 600 | fg.primary | default | — | — |
| Sheet item name | 15 | 500 | fg.primary | default | — | — |
| Sheet item description | 13 | 400 | fg.tertiary | default | — | — |
| AI thread tab (inactive) | 11 | 500 | fg.muted | default | — | — |
| AI thread tab (active) | 11 | 500 | fg.primary | default | — | — |
| Editor file tab (inactive) | 11 | 400 | fg.muted | mono | — | — |
| Editor file tab (active) | 11 | 400 | fg.primary | mono | — | — |
| Terminal tab (inactive) | 11 | 500 | fg.muted | default | — | — |
| Terminal tab (active) | 11 | 500 | fg.primary | default | — | — |
| Empty state message | 15 | 400 | fg.muted | default | — | — |
| Empty chat title | 20 | 600 | fg.primary | default | — | — |
| Empty chat subtitle | 15 | 400 | fg.tertiary | default | — | 22.5 |
| Working indicator text | 13 | 400 | fg.muted | default | — | — (italic) |
| User message text | 15 | 400 | fg.primary | default | — | 22.5 |
| Assistant message text | 15 | 400 | fg.secondary | default | — | 22.5 |
| Tool call header | 13 | 500 | fg.tertiary | default | — | — |
| Tool call label | 13 | 500 | fg.secondary | mono | — | — |
| Tool call detail | 11 | 400 | fg.muted | mono | — | — |
| Approval header | 13 | 600 | semantic.warning | default | 0.5 | — |
| Approval tool name | 13 | 500 | fg.secondary | default | — | — |
| Approval detail (code box) | 11 | 400 | fg.secondary | mono | — | 16.5 |
| Approval deny button | 13 | 500 | semantic.error | default | — | — |
| Approval always-allow button | 13 | 500 | fg.secondary | default | — | — |
| Approval approve button | 13 | 600 | fg.onAccent | default | — | — |
| Composer input | 15 | 400 | fg.primary | default | — | — |
| Branch name | 15 | 600 | fg.primary | mono | — | — |
| Ahead/behind counter | 11 | 400 | fg.tertiary | mono | — | — |
| Git section label (STAGED etc.) | 11 | 500 | fg.tertiary | default | 1.0 | — |
| Git section count | 11 | 400 | fg.muted | mono | — | — |
| Git file path | 13 | 400 | fg.secondary | mono | — | — |
| "Working tree clean" | 13 | 400 | fg.tertiary | default | — | — |
| Line number (editor) | 11 | 400 | fg.muted | mono | — | 20 (hardcoded) |
| Line content (editor) | 13 | 400 | fg.secondary | mono | — | 20 (hardcoded) |
| File name (explorer) | 13 | 400 | fg.secondary | mono | — | — |
| Empty list text | 13 | 400 | fg.muted | default | — | — |

---

## 16. Component Patterns

### 16.1 Card Pattern

Used for connection cards, instruction panels, add-server button:

```tsx
// Normal state
{
  backgroundColor: colors.bg.raised,   // #212121
  borderRadius: radii.lg,              // 12
  paddingHorizontal: spacing[4],       // 16
  paddingVertical: spacing[3],         // 12
  marginBottom: spacing[2],            // 8
}

// Press/active state — swap background
{
  backgroundColor: colors.bg.active,   // #383838
}
```

### 16.2 Bottom Sheet Pattern

```tsx
// Backdrop (full screen, taps to dismiss)
{
  flex: 1,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',  // bg.scrim
  justifyContent: 'flex-end',
}

// Sheet container
{
  backgroundColor: colors.bg.overlay,     // #2a2a2a
  borderTopLeftRadius: radii.xl,          // 16
  borderTopRightRadius: radii.xl,         // 16
  paddingTop: spacing[3],                 // 12
  maxHeight: '60%',
  paddingBottom: insets.bottom + spacing[4],
}

// Handle pill (center-aligned above content)
{
  width: 36,
  height: 4,
  backgroundColor: colors.fg.muted,       // #666666
  borderRadius: radii.full,              // 9999
  alignSelf: 'center',
  marginBottom: spacing[4],              // 16
}
```

### 16.3 Inner Tab Bar Pattern

Used in AI (thread tabs), Terminal (session tabs), and Editor (file tabs). Two variants:

**AI / Terminal tabs (height 36, active = bg.active):**
```tsx
// Container
{ backgroundColor: colors.bg.raised, height: 36 }

// Tab (inactive)
{
  flexDirection: 'row', alignItems: 'center',
  gap: spacing[1],       // 4
  paddingHorizontal: spacing[3],  // 12
  paddingVertical: spacing[1],    // 4
  borderRadius: radii.sm,         // 4
  height: 28,
}

// Tab (active)
{ backgroundColor: colors.bg.active }  // #383838
```

**Editor file tabs (height 32, active = bg.base):**
```tsx
// Container
{ backgroundColor: colors.bg.raised, height: 32 }

// Tab
{
  flexDirection: 'row', alignItems: 'center',
  gap: spacing[1],       // 4
  paddingHorizontal: spacing[3],  // 12
  height: 32,
  maxWidth: 160,
}

// Tab (active) — inverted: tab blends into content area below
{ backgroundColor: colors.bg.base }  // #161616
```

### 16.4 Error Box Pattern

```tsx
{
  backgroundColor: colors.semantic.errorSubtle,  // rgba(248,113,113,0.12)
  borderRadius: radii.md,                        // 8
  paddingHorizontal: spacing[4],                 // 16
  paddingVertical: spacing[3],                   // 12
}
```

### 16.5 Approval Card — Left Accent Border

The only component that uses a `borderLeft`. Used for critical-attention cards requiring immediate user action:

```tsx
{
  backgroundColor: colors.bg.raised,        // #212121
  borderRadius: radii.lg,                   // 12
  borderLeftWidth: 3,
  borderLeftColor: colors.semantic.warning, // #fbbf24
  overflow: 'hidden',
}
```

### 16.6 Search Bar Pattern

```tsx
{
  flexDirection: 'row',
  alignItems: 'center',
  backgroundColor: colors.bg.input,  // #1e1e1e
  marginHorizontal: spacing[3],      // 12
  marginVertical: spacing[2],        // 8
  borderRadius: radii.md,            // 8
  paddingHorizontal: spacing[3],     // 12
  gap: spacing[2],                   // 8
  height: 36,
}
```

### 16.7 Logo Diamond (ConnectScreen)

Icon container rotated 45° to form a diamond shape:

```tsx
{
  width: 56,
  height: 56,
  borderRadius: radii.lg,               // 12 — appears as rounded diamond corners
  backgroundColor: colors.accent.subtle, // rgba(95,204,176,0.12)
  alignItems: 'center',
  justifyContent: 'center',
  transform: [{ rotate: '45deg' }],
}
// Note: child icon is NOT rotated — it counteracts the parent rotation
```

### 16.8 Empty State Pattern

Consistent across all plugins when disconnected or no content:

```tsx
{
  flex: 1,
  backgroundColor: colors.bg.base,   // #161616
  alignItems: 'center',
  justifyContent: 'center',
  gap: spacing[3],    // 12
  padding: spacing[6], // 24
}
// Icon: size={32}, color={colors.fg.muted}  (#666666)
// Text: textStyles.body with { color: colors.fg.muted, textAlign: 'center' }
```

### 16.9 Streaming / Working Dot Pattern

Three dots with staggered opacities for "working" or "streaming" animations:

```tsx
// In MessageBubble (streaming indicator)
dot:  { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary, opacity: 0.4 }
dot1: { opacity: 0.8 }   // brightest
dot2: { opacity: 0.5 }
dot3: { opacity: 0.3 }   // dimmest

// In AI plugin WorkingIndicator (same dimensions)
workingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary }
// opacity applied inline: [0.8, 0.5, 0.3]
// gap between dots: 3 (workingDots) / 4 (streaming indicator) — not from spacing scale
```

### 16.10 Step Number Badge

Circular numbered badge with accent-tinted background:

```tsx
{
  width: 22,
  height: 22,
  borderRadius: radii.full,              // 9999
  backgroundColor: colors.accent.subtle, // rgba(95,204,176,0.12)
  color: colors.accent.primary,          // #5fccb0
  fontSize: 11,                          // xs
  fontWeight: '700',                     // bold
  textAlign: 'center',
  lineHeight: 22,                        // vertically centers text
  marginRight: spacing[3],               // 12
  overflow: 'hidden',
}
```

### 16.11 Inline Code Snippet

Used in instruction text and field hints:

```tsx
{
  fontFamily: typography.fontFamily.mono,  // 'JetBrainsMono'
  fontSize: typography.fontSize.xs,        // 11 (in hints) or no size override
  color: colors.accent.primary,            // #5fccb0
  backgroundColor: colors.bg.input,        // #1e1e1e (only in ConnectScreen code spans)
}
```

### 16.12 Accessibility Touch Targets

| Element | Size | Notes |
|---------|------|-------|
| Primary / ghost button | `minHeight: 44` | HIG/WCAG minimum |
| Connect button (modal) | `minHeight: 48` | Slightly larger — primary action |
| Icon button | `40 × 40` | `interactiveStyles.iconButton` |
| Approval card buttons | `minHeight: 36` | Compact in-flow, full-width flex row |
| Close button (modal) | `36 × 36` + `hitSlop={12}` | Effective touch area: 60 × 60 |
| Send/stop button (composer) | `40 × 40` + `hitSlop={8}` | Effective touch area: 56 × 56 |
| Nav bar items | `flex: 1`, `paddingVertical: 8` | Full-width tap zones |

### 16.13 File Status Color Mapping (Git)

```ts
getFileStatusColor(status, staged):
  if (staged)            → colors.semantic.success    // #4ade80
  if (status === 'added')    → colors.semantic.success    // #4ade80
  if (status === 'modified') → colors.semantic.warning    // #fbbf24
  if (status === 'deleted')  → colors.semantic.error      // #f87171
  if (status === 'untracked') → colors.fg.muted           // #666666
  default                    → colors.fg.tertiary         // #9e9e9e
```

### 16.14 File Icon Color Mapping (Explorer)

```ts
// Code file extensions: ts, tsx, js, jsx, kt, swift, py, rs, go, java, rb, cpp, c, h
FileCode icon → colors.semantic.info   // #60a5fa (blue)
FileText icon → colors.fg.tertiary     // #9e9e9e (gray)
Folder icon   → colors.semantic.warning // #fbbf24 (yellow)
```

---

## 17. Plugin Renderer: The Opacity-Swap Pattern

Source: `apps/mobile/src/components/PluginRenderer.tsx`

### Core Behavior

All plugin panels that have ever been visited remain **mounted** in the React tree. Switching between plugins changes `opacity` (0 ↔ 1) — never unmounts:

```tsx
// panelHidden style
const styles = {
  panel: { ...StyleSheet.absoluteFillObject },   // pos absolute, fills container
  panelHidden: { opacity: 0 },                   // hidden but ALIVE
}

// Touch events blocked on hidden panels
<View
  style={[styles.panel, !isActive && styles.panelHidden]}
  pointerEvents={isActive ? 'auto' : 'none'}
>
  <Component ... />
</View>
```

### Why Opacity-Swap (Not Unmount)

Documented directly in source comments:

1. **Preserves WebView state** — React Native WebViews lose their entire session on unmount
2. **Preserves terminal sessions** — Native terminal emulator state (scrollback, cursor position, running process) destroyed on unmount
3. **Preserves editor content** — Open file state in module-level variables survives React reconciliation
4. **No Reanimated `ref.current = undefined` crash** — This bug only occurs with `display: none`, not `opacity: 0`

### Lazy Mounting

Panels only mount on **first activation**, not on app load:

```tsx
const mountedTabIds = useRef(new Set<string>());

// Mount the active tab
if (activeTabId) {
  mountedTabIds.current.add(activeTabId);
}

// Skip rendering tabs that haven't been visited yet
if (!mountedTabIds.current.has(tab.id)) return null;
```

### MemoizedPanel: Aggressive Memoization

Custom `React.memo` comparator prevents inactive panels from ever re-rendering:

```tsx
memo(Panel, (prev, next) => {
  if (prev.isActive !== next.isActive) return false;         // must re-render: activation changed
  if (prev.tab.id !== next.tab.id) return false;             // must re-render: instance changed
  if (prev.bottomBarHeight !== next.bottomBarHeight) return false; // layout change
  if (!next.isActive) return true;                           // BLOCK: inactive panel, never re-render
  return prev.tab.status === next.tab.status;                // active: only re-render on status change
})
```

### Terminal's Internal Opacity-Swap

The Terminal plugin applies the same pattern for its own multiple sessions. Module-level Maps store refs and unsubscribe functions outside React to survive reconciliation:

```tsx
const terminalRefs = new Map<string, React.RefObject<NativeTerminalRef | null>>();
const sessionUnsubscribes = new Map<string, () => void>();

// Each session: opacity swap, absolute positioned
<View style={{
  position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
  opacity: isVisible ? 1 : 0,
  pointerEvents: isVisible ? 'auto' : 'none',
}}>
  <NativeTerminal ref={getTerminalRef(key)} ... />
</View>
```

### Editor's Module-Level State

The Editor plugin uses module-level mutable state (outside React) to persist open files across opacity swaps:

```ts
let openFiles: OpenFile[] = [];
let activeFilePath: string | null = null;
const fileChangeListeners = new Set<() => void>();
```

Components subscribe to changes via a listener set; updates call `notifyListeners()` to trigger `forceUpdate`.

---

## 18. Bottom Bar Navigation

Source: `apps/mobile/src/components/PluginBottomBar.tsx`

### Dimensions

| Property | Value |
|----------|-------|
| Base height | `56` px |
| Total height | `56 + insets.bottom` (safe area aware) |
| Nav item icon size | `22` px |
| Tabs button icon size | `22` px |
| Nav item inner gap (icon → label) | `2` px (hardcoded, not from spacing scale) |
| Nav item paddingVertical | `8` px (spacing[2]) |

### Container

```tsx
{
  flexDirection: 'row',
  backgroundColor: colors.bg.raised,       // #212121
  borderTopWidth: StyleSheet.hairlineWidth, // ~0.5px on @2x
  borderTopColor: colors.divider,          // rgba(255,255,255,0.06)
}
```

### Nav Items

```tsx
// Container
{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 8, gap: 2 }

// Icon (inactive)
color={colors.fg.tertiary}    // #9e9e9e, size={22}

// Icon (active)
color={colors.accent.primary} // #5fccb0, size={22}

// Label text (inactive)
{ fontSize: 11, fontWeight: '500', color: colors.fg.tertiary }

// Label text (active) — only color changes
{ color: colors.accent.primary }
```

### Plugin-Driven Nav Order

Nav items are built dynamically from plugin definitions. Plugins with `navOrder != null` appear in the bar:

| Plugin | `navOrder` | `navLabel` |
|--------|------------|-----------|
| AI | `0` | `'AI'` (from `name`) |
| Editor | `2` | `'Editor'` (from `name`) |
| Terminal | `3` | `'Term'` (explicit `navLabel`) |
| Git | `4` | `'Git'` (from `name`) |

Plugins with `kind: 'extra'` appear in the Tabs sheet, not the main nav. Sheet items are sorted alphabetically.

### Tabs Sheet Dimensions

| Property | Value |
|----------|-------|
| `maxHeight` | `'60%'` of screen |
| `borderTopLeftRadius` | `16` (radii.xl) |
| `borderTopRightRadius` | `16` (radii.xl) |
| Handle: `width × height` | `36 × 4` |
| Item `paddingVertical` | `12` (spacing[3]) |
| Item `gap` (icon → text) | `12` (spacing[3]) |
| Open indicator dot | `8 × 8`, `borderRadius: 9999`, `backgroundColor: accent.primary` |

---

## 19. Font Loading

### Font Files

Located at `apps/mobile/src/assets/fonts/`. **Seven TTF files total:**

**IBM Plex Sans:**
- `IBMPlexSans-Regular.ttf`
- `IBMPlexSans-Medium.ttf`
- `IBMPlexSans-SemiBold.ttf`
- `IBMPlexSans-Bold.ttf`

**JetBrains Mono:**
- `JetBrainsMono-Regular.ttf`
- `JetBrainsMono-Medium.ttf`
- `JetBrainsMono-Bold.ttf`

> Note: There is **no** `JetBrainsMono-SemiBold` — only Regular, Medium, Bold for mono. The `monoMedium` and `monoBold` tokens exist; `monoSemiBold` does not.

### Linking via `react-native.config.js`

```js
// apps/mobile/react-native.config.js
module.exports = {
  assets: ['./src/assets/fonts'],
};
```

Fonts are linked to native platforms via `@react-native-community/cli`:
- **Android:** Copied to `android/app/src/main/assets/fonts/`
- **iOS:** Bundled in `ios/Stavi/` and registered in `Info.plist` as `UIAppFonts`

### Font Naming Convention

React Native `fontFamily` values exactly match the filename (minus `.ttf`):
- `'IBMPlexSans'` → `IBMPlexSans-Regular.ttf`
- `'IBMPlexSans-Medium'` → `IBMPlexSans-Medium.ttf`
- `'JetBrainsMono'` → `JetBrainsMono-Regular.ttf`

This is the standard React Native convention for custom fonts.

---

## 20. Navigation Theme Integration

Source: `apps/mobile/src/App.tsx`

The `NavigationContainer` receives a fully token-wired theme:

```tsx
theme={{
  dark: true,
  colors: {
    primary:      colors.accent.primary,     // #5fccb0
    background:   colors.bg.base,            // #161616
    card:         colors.bg.raised,          // #212121
    text:         colors.fg.primary,         // #fafafa
    border:       colors.divider,            // rgba(255,255,255,0.06)
    notification: colors.semantic.error,     // #f87171
  },
  fonts: {
    regular: { fontFamily: 'IBMPlexSans',         fontWeight: '400' },
    medium:  { fontFamily: 'IBMPlexSans-Medium',  fontWeight: '500' },
    bold:    { fontFamily: 'IBMPlexSans-Bold',    fontWeight: '700' },
    heavy:   { fontFamily: 'IBMPlexSans-Bold',    fontWeight: '900' }, // reuses Bold — no 900-weight file
  },
}}
```

**Stack navigator options applied globally:**
- `headerShown: false` — no native header bars
- `animation: 'fade'` — cross-fade between Connect and Workspace screens
- `contentStyle: { backgroundColor: colors.bg.base }` — prevent flash of white

**StatusBar:**
```tsx
<StatusBar
  barStyle="light-content"            // white icons/text
  backgroundColor={colors.bg.base}    // #161616 (Android only)
/>
```

---

## 21. Naming Conventions

### Token Naming

| Category | Pattern | Examples |
|----------|---------|---------|
| Background layers | `bg.{layer}` | `bg.base`, `bg.raised`, `bg.overlay`, `bg.elevated`, `bg.input`, `bg.active`, `bg.scrim` |
| Foreground levels | `fg.{level}` | `fg.primary`, `fg.secondary`, `fg.tertiary`, `fg.muted`, `fg.onAccent` |
| Accent variants | `accent.{variant}` | `accent.primary`, `accent.secondary`, `accent.subtle`, `accent.glow` |
| Semantic states | `semantic.{state}` / `semantic.{state}Subtle` | `semantic.success`, `semantic.errorSubtle` |
| Terminal ANSI | `terminal.{name}` / `terminal.bright{Name}` | `terminal.cyan`, `terminal.brightGreen` |
| Font family | `fontFamily.{family}{Weight?}` | `fontFamily.sans`, `fontFamily.sansBold`, `fontFamily.mono`, `fontFamily.monoMedium` |
| Font size | `fontSize.{key}` | `fontSize.xs`, `fontSize.base`, `fontSize['2xl']` |
| Spacing | `spacing[{n}]` | `spacing[4]` = 16px |
| Radii | `radii.{name}` | `radii.none`, `radii.md`, `radii.full` |
| Motion duration | `motion.duration.{speed}` | `motion.duration.fast`, `motion.duration.normal` |
| Z-index | `zIndex.{layer}` | `zIndex.modal`, `zIndex.toast` |

### StyleSheet Key Conventions

| Pattern | Key Examples |
|---------|-------------|
| Container wrappers | `container`, `wrapper`, `area` |
| State suffixes | `...Active`, `...Pressed`, `...Hidden` |
| Content areas | `content`, `scrollContent`, `listContent`, `formContent` |
| Header sections | `...Header`, `...Row` |
| Text elements | match token names: `h1`–`h4`, `body`, `bodySmall`, `label`, `labelSmall`, `caption`, `code`, `codeSmall` |
| Compound names | full description: `branchHeader`, `sheetHandle`, `sendButtonActive`, `connectButtonPressed` |

### Plugin Component Naming

| Type | Pattern | Examples |
|------|---------|---------|
| Panel component | `{Name}Panel` | `AIPanel`, `GitPanel`, `TerminalPanel`, `EditorPanel`, `ExplorerPanel` |
| Plugin definition export | `{name}Plugin` | `aiPlugin`, `gitPlugin`, `terminalPlugin`, `explorerPlugin` |
| Plugin kind | `'core'` or `'extra'` | `kind: 'core'` (in bottom nav), `kind: 'extra'` (in Tabs sheet) |

---

## 22. Anti-Patterns (Explicitly Documented)

The codebase records these as explicit lessons learned:

### Shadows in dark mode

> From `tokens.ts`: "Intentionally empty for dark theme — use bg layering instead. Adding shadows in dark mode is an anti-pattern."

Do not add `shadowColor`, `shadowOffset`, `shadowOpacity`, `elevation` etc. in dark mode components. Use a lighter `bg.*` token to elevate instead.

### `display: none` for hiding panels

> From `PluginRenderer.tsx`: "No Reanimated ref.current=undefined bug (we never use display:none)"

Hiding with `display: none` causes Reanimated to lose animated value refs. Use `opacity: 0` + `pointerEvents: 'none'` instead.

### Unmounting stateful panels

> From `PluginRenderer.tsx`: "All mounted panels stay alive (opacity-swap, not display:none). This preserves WebView state, terminal sessions, editor content"

Do not conditionally render `{isActive && <Panel />}`. All visited panels must stay mounted.

### Hardcoding style values

> From `styles.ts`: "Use these [shared style primitives] instead of hardcoding styles in components. Example: textStyles.heading instead of `{ fontSize: 20, fontWeight: '700' }`"

Always reference `colors.*`, `typography.*`, `spacing[n]`, `radii.*` tokens.

### Mixing accent colors

> From `tokens.ts` accent section: "Single hue family — never mix accent colors"

Only the four `accent.*` tokens are allowed for interactive/focus highlights. No other colors should be used for interactive state.

### Semantic colors for decoration

> From `tokens.ts` semantic section: "status indicators only, never for decoration"

`semantic.success`, `.warning`, `.error`, `.info` (and their `*Subtle` variants) are reserved for meaning-bearing status. They must not be repurposed as visual decoration.

### Borders in dark mode (general)

The "borderless" philosophy should be maintained. The two legitimate exceptions are:
1. `StyleSheet.hairlineWidth` + `colors.divider` for structural separation between same-bg-color regions (bar → content, modal header → form)
2. `borderLeftWidth: 3` + semantic color for the approval card left accent (explicit attention signal)

### AsyncStorage polling for reactive state

> From `PluginBottomBar.tsx`: "Uses Zustand store directly (NOT AsyncStorage polling)"

Use Zustand stores directly — do not poll AsyncStorage for reactive state.

### `innerApi` hacks / `setTimeout(0)` workarounds

> From `PluginBottomBar.tsx`: "No innerApi hack, no setTimeout(0), no stateRef workaround. Clean reactive data flow."

Avoid `innerApi` hacks and `setTimeout(0)` workarounds — use clean reactive data flow.

---

## 23. Design Decisions & Notes

### Background Layer Lightness Steps

The six background values step through approximate lightness evenly:

| Value | Approx. Lightness |
|-------|------------------|
| `#161616` (base) | L ≈ 9 |
| `#1e1e1e` (input) | L ≈ 12 |
| `#212121` (raised) | L ≈ 13 |
| `#2a2a2a` (overlay) | L ≈ 17 |
| `#333333` (elevated) | L ≈ 20 |
| `#383838` (active) | L ≈ 22 |

Each visible transition is ~3–7 lightness units — perceptible but not stark.

### Why `bg.active` Is Brighter Than `bg.elevated`

`bg.active` (`#383838`) is used for pressed/selected states **on top of** `bg.raised` (`#212121`) surfaces. It must contrast upward from its parent surface. `bg.elevated` (`#333333`) is a standalone layer, not layered on top of `bg.raised`.

### Editor Tab Active Inversion

The editor inverts the active-tab convention relative to the AI and Terminal plugins:

| Plugin | Active tab color | Reason |
|--------|-----------------|--------|
| AI / Terminal | `bg.active` (`#383838`) | Active tab is "selected" highlight above bar |
| Editor | `bg.base` (`#161616`) | Active tab blends into code content below — visual continuity |

### Why `fg.onAccent` Is Near-Black (`#0a0f0d`)

Not pure black (`#000000`) — the slight warm-green tint (`0a` red, `0f` green, `0d` blue) harmonizes with the mint-teal accent hue family for perceptual color harmony.

### Terminal ANSI Colors Mirror Semantic Colors

Semantic and terminal colors are identical for the shared hues:

| Semantic | Terminal | Hex |
|---------|---------|-----|
| `semantic.error` | `terminal.red` | `#f87171` |
| `semantic.success` | `terminal.green` | `#4ade80` |
| `semantic.warning` | `terminal.yellow` | `#fbbf24` |
| `semantic.info` | `terminal.blue` | `#60a5fa` |

This is intentional: a failing test's red terminal output matches the error badge color, reinforcing meaning.

### Monospace as Visual Grammar

JetBrains Mono is used for any content that is "from the machine":
file paths, host/port/IP, bearer tokens, git branches, ahead/behind counts, line numbers, source code, terminal output, and version counters. This creates a clear visual grammar: sans-serif = "interface," monospace = "data."

### Key Package Versions

| Package | Version |
|---------|---------|
| `react` | `19.2.3` |
| `react-native` | `0.85.0` |
| `react-native-reanimated` | `4.3.0` |
| `react-native-gesture-handler` | `2.31.1` |
| `react-native-safe-area-context` | `5.7.0` |
| `@react-navigation/native` | `7.2.2` |
| `@react-navigation/native-stack` | `7.14.10` |
| `lucide-react-native` | `1.8.0` |
| `zustand` | `5.0.12` |
| `react-native-svg` | `15.15.4` |
