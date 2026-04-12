# Stavi Design System

**A Mobile IDE for AI Coding Agents**
Dark-first. Borderless. Token-driven. Built for developers who read code on small screens.

Source of truth: `src/theme/tokens.ts` and `src/theme/styles.ts`

---

## Core Philosophy

### "Terminal Aesthetics, Human Warmth"

Stavi looks like a tool a developer built for themselves — precise, dark, minimal —
but never cold. The mint teal accent is the single point of life in an otherwise
monochrome interface. Every pixel either communicates information or gets out of the way.

### Guiding Principles

| Principle | Description |
|---|---|
| **Borderless** | Depth through background layering. Zero borders between UI regions. |
| **Token-first** | Every value (color, size, spacing) comes from `tokens.ts`. No magic numbers. |
| **Accent scarcity** | Mint teal means "interactive" or "active." If everything glows, nothing does. |
| **Dark-only** | No light theme. Optimized for one mode, done well. |
| **IDE density** | More information per pixel than a consumer app. Tight spacing, small type where appropriate. |
| **State preservation** | Panels stay alive via opacity-swap. Terminal sessions, editor state, WebView content persist. |
| **Accessible** | WCAG AA contrast minimums. 44px touch targets. Reduced-motion support. |

---

## Visual Identity

Stavi is a developer-tool-first dark IDE. Its design language is distinct from content-reading apps.

| Property | Value |
|---|---|
| **Base background** | `#161616` (cool neutral — breathes more than pure black) |
| **Raised surface** | `#212121` |
| **Accent color** | Mint teal `#5fccb0` (cool, signals interactivity) |
| **Font — UI** | IBM Plex Sans |
| **Font — Code** | JetBrains Mono |
| **Personality** | Developer-tool precision |
| **Content type** | Code, terminals, diffs |
| **Theme support** | Dark only |
| **Density** | IDE-compact |

The gray scale is intentionally warmer than a pure `#0a0a0a` dark — reducing eye strain
during long coding sessions without sacrificing depth.

---

## Color Architecture

### Background Layers

The UI is stacked in layers. Each layer is a progressively lighter background.
Borders are never needed because the contrast between layers creates visual separation.

```
┌─────────────────────────────────────────┐
│  bg.elevated  #333333  tooltips, pops   │  ← Highest
├─────────────────────────────────────────┤
│  bg.active    #383838  pressed/selected │
├─────────────────────────────────────────┤
│  bg.overlay   #2a2a2a  modals, sheets   │
├─────────────────────────────────────────┤
│  bg.raised    #212121  cards, panels    │
├─────────────────────────────────────────┤
│  bg.input     #1e1e1e  text inputs      │  ← Between base and raised
├─────────────────────────────────────────┤
│  bg.base      #161616  app background   │  ← Deepest
└─────────────────────────────────────────┘

  bg.scrim  rgba(0,0,0,0.5)  modal backdrop
```

### Foreground — Opacity-Based Hierarchy

A single white base color, stepped down in opacity. This guarantees consistent
contrast ratios on any background layer.

```
fg.primary    #fafafa   100%   Headings, interactive labels, important text
fg.secondary  #c0c0c0    75%   Body text, descriptions
fg.tertiary   #9e9e9e    62%   Captions, timestamps, placeholders
fg.muted      #666666    40%   Disabled text, decorative labels
fg.onAccent   #0a0f0d    ---   Dark text on accent-colored backgrounds
```

### Accent — Mint Teal

Used sparingly. Mint teal means "this is interactive" or "this is active."

```
accent.primary    #5fccb0                   Buttons, active tabs, links
accent.secondary  #4db89d                   Pressed/hover state (slightly darker)
accent.subtle     rgba(95,204,176,0.12)     Accent-tinted backgrounds
accent.glow       rgba(95,204,176,0.25)     Focus rings, selection highlights
```

**Use accent for:**
- Primary action buttons (filled background)
- Active bottom bar icon + label
- Focus rings on inputs
- Toggle on-state
- Open-tab indicator dot

**Never use accent for:**
- Large background fills
- Decorative icons
- Section headers
- Status indicators (use semantic colors)

### Semantic Colors

Status indicators only. Never decorative.

```
success   #4ade80   Git staged, test passed, connected
warning   #fbbf24   Unstaged changes, pending, caution
error     #f87171   Errors, disconnected, test failed
info      #60a5fa   Information banners, tips, hints

Each has a Subtle variant at 12% opacity for tinted backgrounds:
  successSubtle   rgba(74, 222, 128, 0.12)
  warningSubtle   rgba(251, 191, 36, 0.12)
  errorSubtle     rgba(248, 113, 113, 0.12)
  infoSubtle      rgba(96, 165, 250, 0.12)
```

### Terminal ANSI Palette

Optimized for readability on `#161616`. Matches xterm-256 conventions.

```
Standard                          Bright
──────────────────────────────    ──────────────────────────────
black     #1e1e1e                brightBlack     #4a4a4a
red       #f87171                brightRed       #fca5a5
green     #4ade80                brightGreen     #86efac
yellow    #fbbf24                brightYellow    #fde68a
blue      #60a5fa                brightBlue      #93c5fd
magenta   #c084fc                brightMagenta   #d8b4fe
cyan      #22d3ee                brightCyan      #67e8f9
white     #e5e5e5                brightWhite     #fafafa
```

### Utility Colors

```
transparent   'transparent'                   Invisible backgrounds
divider       rgba(255, 255, 255, 0.06)       Ultra-subtle separator (last resort)
```

The `divider` color exists for cases where bg layering alone cannot create
sufficient separation (e.g., the bottom bar's top edge). Use it rarely.

---

## Typography

### Font Families

```
UI Text:    IBM Plex Sans       Clean, technical, humanist sans-serif
            IBMPlexSans            Regular (400)
            IBMPlexSans-Medium     Medium (500)
            IBMPlexSans-SemiBold   SemiBold (600)
            IBMPlexSans-Bold       Bold (700)

Code:       JetBrains Mono      Monospaced, ligatures disabled
            JetBrainsMono          Regular
            JetBrainsMono-Medium   Medium
            JetBrainsMono-Bold     Bold

Fallback:   monospace           System monospace if JetBrains Mono unavailable
```

IBM Plex Sans was chosen over Inter for its technical/IBM heritage — it reads like
developer documentation, not a consumer app.

### Type Scale — 1.2 Modular (Minor Third)

```
Token    Size    Usage
─────    ────    ─────────────────────────────────
xs       11px    Badges, captions, timestamps, terminal small
sm       13px    Secondary text, labels, code blocks
base     15px    Body text, primary content, button labels
md       17px    Subheadings, emphasized text
lg       20px    Section headers, card titles
xl       24px    Page titles
2xl      29px    Hero headings (rare)
3xl      35px    Display text (very rare)
```

### Font Weights

```
regular    400    Body text, descriptions
medium     500    Labels, buttons, emphasis, nav labels
semibold   600    Headings h3-h4, sheet titles
bold       700    Headings h1-h2, strong emphasis
```

### Line Heights

```
tight      1.2    Headings, single-line UI elements
normal     1.5    Body text, multi-line descriptions
relaxed    1.7    Long-form reading (rarely used in IDE context)
```

### Letter Spacing

```
tight     -0.3    Large headings (h1, h2) — tightened for visual mass
normal     0      Body text, standard UI
wide       0.5    Labels (sm medium) — slight spread for legibility at small size
wider      1.0    Uppercase small labels — tracking prevents letters from colliding
```

### Pre-Built Text Styles (from styles.ts)

| Style | Font Size | Weight | Color | Letter Spacing | Line Height |
|---|---|---|---|---|---|
| `h1` | 35 (3xl) | bold | fg.primary | tight (-0.3) | 42 (3xl * 1.2) |
| `h2` | 29 (2xl) | bold | fg.primary | tight (-0.3) | 34.8 (2xl * 1.2) |
| `h3` | 24 (xl) | semibold | fg.primary | normal | 28.8 (xl * 1.2) |
| `h4` | 20 (lg) | semibold | fg.primary | normal | 24 (lg * 1.2) |
| `body` | 15 (base) | regular | fg.secondary | normal | 22.5 (base * 1.5) |
| `bodySmall` | 13 (sm) | regular | fg.secondary | normal | 19.5 (sm * 1.5) |
| `label` | 13 (sm) | medium | fg.primary | wide (0.5) | — |
| `labelSmall` | 11 (xs) | medium | fg.tertiary | wider (1.0) | uppercase |
| `caption` | 11 (xs) | regular | fg.tertiary | normal | 16.5 (xs * 1.5) |
| `code` | 13 (sm) | — | fg.primary | — | JetBrainsMono |
| `codeSmall` | 11 (xs) | — | fg.secondary | — | JetBrainsMono |

---

## Spacing

### 4px Base Grid

All spacing is a multiple of 4px. No exceptions.

```
Token    Value    Usage
─────    ─────    ────────────────────────────────
0        0px      No space
1        4px      Tight inline gaps (icon-to-label in nav)
2        8px      Related elements, icon button padding, nav item padding
3        12px     Comfortable padding (input padding, list item vertical)
4        16px     Standard padding (screen horizontal, card padding, sheet sections)
5        20px     Group separation
6        24px     Primary button horizontal padding
8        32px     Section separation
10       40px     Major section gaps
12       48px     Page-level spacing
16       64px     Maximum spacing (rare)
```

### Spacing Principles

1. **Proximity = relationship.** Use `spacing[2]` (8px) between siblings, `spacing[4]` (16px) between groups.
2. **Consistent screen padding.** All screens use `spacing[4]` (16px) horizontal padding via `layoutStyles.screenPadding`.
3. **No borders, more space.** Where you would add a border, add `spacing[3]` or `spacing[4]` gap instead.

---

## Border Radius

```
Token    Value     Usage
─────    ─────     ──────────────────────────────
none     0         Sharp corners (intentional, rare)
sm       4px       Small elements (badges, chips, sheet handle)
md       8px       Standard (buttons, inputs, icon buttons, elevated surfaces)
lg       12px      Large containers (cards, panels, overlays, raised surfaces)
xl       16px      Bottom sheets (top corners)
full     9999px    Circular (open-tab indicator dot, avatars, pills)
```

**Rule:** Default to `radii.md` (8px). Use `radii.lg` (12px) for card-level surfaces.
Consistency matters more than variety.

---

## Motion

### Durations

```
fast        100ms    Micro-interactions (press feedback, icon swap)
normal      200ms    Standard transitions (tab switch, opacity change)
slow        300ms    Complex animations (sheet slide, panel transition)
verySlow    500ms    Dramatic reveals (first-load, onboarding)
```

### Easings

```
easeOut      cubic-bezier(0.25, 0.46, 0.45, 0.94)    Entering elements
easeIn       cubic-bezier(0.55, 0.085, 0.68, 0.53)   Exiting elements
easeInOut    cubic-bezier(0.645, 0.045, 0.355, 1)     Moving/resizing
spring       damping:20 stiffness:300 mass:0.8        Playful interactions (bouncy)
```

### Motion Principles

1. **Purposeful** — Animation communicates state change, never decorates.
2. **Fast** — Users never wait for animation to finish before interacting.
3. **Consistent** — Same action = same animation = same duration everywhere.
4. **Reduced-motion aware** — Respect user preferences; provide static alternatives.

---

## Shadows

### Why None in Dark Mode

Shadows are an anti-pattern in dark UIs:

- On dark backgrounds, shadows are invisible (dark-on-dark).
- To make shadows visible, you need unrealistically bright values, which look artificial.
- Background layering achieves the same depth effect naturally.
- The `shadows` object in `tokens.ts` is intentionally empty.

**If you need elevation:** Use a higher background layer (`bg.raised` -> `bg.overlay` -> `bg.elevated`).
Never add `shadowColor`, `shadowOffset`, `elevation`, or any shadow property.

---

## Components

### Bottom Bar

The primary navigation surface. Plugin-driven, not hardcoded.

```
┌──────┬──────┬──────┬──────┬──────┐
│  ◇   │  ◇   │  ◇   │  ◇   │  ⊞   │
│Term  │  AI  │ Edit │ Git  │ Tabs │
└──────┴──────┴──────┴──────┴──────┘

Height:        56px + safe area inset bottom
Background:    bg.raised (#212121)
Top edge:      hairlineWidth border, divider color (sole exception to borderless)
Icon size:     22px, Lucide icon set
Icon color:    fg.tertiary (#9e9e9e) default, accent.primary (#5fccb0) active
Label:         xs (11px), medium weight
Label color:   fg.tertiary default, accent.primary active
Item layout:   flex:1, center-aligned, paddingVertical: spacing[2] (8px)
```

### Plugin Panels

Full-screen panels rendered with opacity-swap for state preservation.

```
Container:     flex:1, bg.base background
Active panel:  opacity:1, pointerEvents:'auto'
Inactive:      opacity:0, pointerEvents:'none'
Mounting:      Lazy — panels mount only on first activation
Re-renders:    Inactive panels never re-render (custom memo comparator)
Position:      absoluteFillObject (all panels stacked)
```

### Plugin Bottom Sheet (Tabs)

Modal for accessing extra plugins (monitor, processes, explorer, search, ports).

```
Trigger:       "Tabs" button (LayoutGrid icon) in bottom bar
Backdrop:      bg.scrim rgba(0,0,0,0.5)
Sheet bg:      bg.overlay (#2a2a2a)
Top corners:   radii.xl (16px)
Handle:        36x4px, bg fg.muted, radii.full, centered, marginBottom spacing[4]
Title:         lg (20px), semibold, fg.primary, paddingHorizontal spacing[4]
Max height:    60% of screen
Animation:     slide (native Modal animationType)

Item layout:
  Row:         icon (20px, fg.secondary) + text column + open indicator
  Padding:     spacing[3] (12px) vertical
  Gap:         spacing[3] (12px)
  Name:        base (15px), medium, fg.primary
  Description: sm (13px), fg.tertiary, marginTop 2px
  Open dot:    8x8px, radii.full, accent.primary
```

### Cards / Raised Surfaces

```
Background:    bg.raised (#212121)
Padding:       spacing[4] (16px)
Radius:        radii.lg (12px)
Border:        NONE
Shadow:        NONE
Gap between:   spacing[4] (16px)
```

### Buttons

**Primary (accent-filled)**
```
Background:    accent.primary (#5fccb0)
Text:          fg.onAccent (#0a0f0d), base (15px), semibold
Padding:       spacing[3] (12px) vertical, spacing[6] (24px) horizontal
Radius:        radii.md (8px)
Min height:    44px (accessibility touch target)
Pressed:       accent.secondary (#4db89d)
```

**Ghost (transparent)**
```
Background:    transparent
Text:          fg.secondary (#c0c0c0), base (15px), medium
Padding:       spacing[3] (12px) vertical, spacing[4] (16px) horizontal
Radius:        radii.md (8px)
Min height:    44px
Pressed:       bg.active (#383838)
```

**Icon Button**
```
Size:          40x40px
Radius:        radii.md (8px)
Alignment:     center
Pressed:       bg.active (#383838) via pressableActive style
```

### Inputs

```
Background:    bg.input (#1e1e1e)
Text:          fg.primary (#fafafa)
Placeholder:   fg.tertiary (#9e9e9e)
Padding:       spacing[3] (12px) vertical, spacing[4] (16px) horizontal
Radius:        radii.md (8px)
Border:        NONE
Focus:         accent.glow ring (2px)
```

### Modal / Overlay Surfaces

```
Background:    bg.overlay (#2a2a2a)
Radius:        radii.lg (12px) or radii.xl (16px) for sheets
Padding:       spacing[4] (16px)
Backdrop:      bg.scrim rgba(0,0,0,0.5)
```

### Status Badges

```
Background:    semantic.[status]Subtle (12% opacity tint)
Text:          semantic.[status] (full color)
Font:          xs (11px), medium weight
Padding:       spacing[1] (4px) vertical, spacing[2] (8px) horizontal
Radius:        radii.sm (4px)
```

### Empty States

```
Container:     center-aligned, flex:1
Icon:          32px, fg.tertiary
Heading:       body size, fg.secondary
Description:   bodySmall, fg.tertiary
CTA:           Ghost button or primary button
```

---

## States

### Interactive States

```
Default     →  Base styling (bg per surface level, fg per text role)
Pressed     →  bg.active (#383838) via pressableActive style
Focused     →  accent.glow ring (focus ring, accessibility)
Disabled    →  fg.muted (#666666) text, no pointer events, no bg change
```

### Selection States

```
Unselected  →  Default bg, fg.secondary text
Selected    →  accent.subtle bg, accent.primary text
             OR bg.active bg, fg.primary text
```

### Loading States

```
Skeleton    →  bg.raised with subtle pulse animation (motion.duration.slow)
Spinner     →  accent.primary color
Button      →  Reduced opacity (0.6), disabled pointer events
```

### Active Plugin Indicator

```
Bottom bar:  Icon + label switch from fg.tertiary to accent.primary
Panel:       opacity:1, pointerEvents:'auto'
Sheet dot:   8px circle in accent.primary (shows open tabs)
```

---

## Icons

### Library

Lucide React Native — consistent stroke-based icon set.

### Sizes

```
16px    Dense UI, inline with small text (rare)
20px    Bottom sheet items, secondary UI
22px    Bottom bar navigation icons
24px    Standard UI, button icons, headers
32px    Empty states, feature icons
```

### Colors

```
Default:     fg.tertiary (#9e9e9e)   Inactive, decorative
Active:      accent.primary (#5fccb0) or fg.primary (#fafafa)
Status:      semantic color (only for status indicators)
On surface:  fg.secondary (#c0c0c0)  Sheet items, list icons
```

**Never use colored icons decoratively.** Color on an icon means state or status.

---

## Accessibility

### Contrast Ratios

All fg/bg combinations meet WCAG AA:

```
fg.primary   (#fafafa) on bg.base (#161616)   →  16.2:1  ✓ AAA
fg.secondary (#c0c0c0) on bg.base (#161616)   →   9.8:1  ✓ AAA
fg.tertiary  (#9e9e9e) on bg.base (#161616)   →   6.0:1  ✓ AA
fg.muted     (#666666) on bg.base (#161616)   →   3.0:1  ✓ Large text only
fg.onAccent  (#0a0f0d) on accent   (#5fccb0)  →   8.9:1  ✓ AAA
```

### Touch Targets

- Minimum size: 44x44px (all buttons, nav items, pressables)
- Icon buttons: 40x40px hit area (acceptable — icon is centered in nav item flex area)
- Bottom bar items: flex:1 width, full bar height — exceeds minimum

### Focus Indicators

- `accent.glow` ring for focused inputs
- Never remove focus styles

### Motion

- Respect `prefers-reduced-motion`
- All animations should have static fallbacks
- Spring physics should degrade to linear on reduced-motion

---

## Anti-Patterns

| Bad Practice | Do This Instead |
|---|---|
| Add a border between sections | Use bg layering or spacing[4]+ gap |
| Add a border around cards | Use bg.raised on bg.base — contrast creates the edge |
| Add shadow to a dark surface | Use a higher bg layer (raised → overlay → elevated) |
| Use accent color for decoration | Accent = interactive or active. Use fg.tertiary for decoration |
| Use multiple accent hues | One accent family (mint teal). Semantic colors for status only |
| Hardcode a hex color in a component | Import from tokens.ts. Every value is a token |
| Use `display: 'none'` to hide panels | Use opacity:0 + pointerEvents:'none' (preserves state) |
| Use arbitrary spacing values | Use spacing[n] from the 4px grid. No 5px, 7px, 10px, 15px |
| Set `fontSize` without a token | Use typography.fontSize.* scale values only |
| Mix IBM Plex Sans and Inter | IBM Plex Sans is the sole UI font |
| Add a light theme | Stavi is dark-only. Design for one mode, done perfectly |
| Use elevation/shadow Android props | Shadows are invisible on dark backgrounds. Use bg layers |

---

## Token Naming Convention

```
[category].[subcategory].[variant]

colors.bg.base           Background, base layer
colors.bg.raised         Background, raised layer
colors.fg.primary        Foreground, primary opacity
colors.fg.onAccent       Foreground, on accent background
colors.accent.primary    Accent, primary strength
colors.accent.subtle     Accent, subtle (12% opacity)
colors.semantic.success  Semantic, success status
colors.terminal.red      Terminal, ANSI red

typography.fontSize.base    Type, size, base step
typography.fontWeight.bold  Type, weight, bold
typography.lineHeight.tight Type, leading, tight

spacing[4]               16px (4 * 4px grid)
radii.md                 8px
motion.duration.normal   200ms
zIndex.modal             40
```

---

## File Structure

```
src/theme/
  tokens.ts       Single source of truth — all design tokens
  styles.ts       Pre-built StyleSheet objects (text, surface, layout, interactive)
  index.ts        Barrel export — import { colors, textStyles } from '../theme'

src/components/
  PluginBottomBar.tsx     Navigation bar (plugin-driven)
  PluginRenderer.tsx      Panel manager (opacity-swap, lazy mount, memoized)

src/plugins/
  core/
    terminal/             Terminal emulator (xterm.js via WebView)
    ai/                   AI agent panel
    editor/               Code editor
    git/                  Git status + operations
  extra/
    monitor/              System monitor
    processes/            Process manager
    explorer/             File explorer
    search/               Search across files
    ports/                Port forwarding
```

---

## Quick Reference

### Background Selection

| Element | Token | Hex |
|---|---|---|
| App background | bg.base | #161616 |
| Cards, panels, bottom bar | bg.raised | #212121 |
| Modals, bottom sheets | bg.overlay | #2a2a2a |
| Tooltips, popovers | bg.elevated | #333333 |
| Text inputs, search bars | bg.input | #1e1e1e |
| Pressed/selected states | bg.active | #383838 |
| Modal backdrop | bg.scrim | rgba(0,0,0,0.5) |

### Text Selection

| Element | Color Token | Weight | Size |
|---|---|---|---|
| Page title | fg.primary | bold | 2xl (29) |
| Section header | fg.primary | semibold | xl (24) |
| Card title | fg.primary | semibold | lg (20) |
| Body text | fg.secondary | regular | base (15) |
| Label | fg.primary | medium | sm (13) |
| Uppercase label | fg.tertiary | medium | xs (11) |
| Caption / timestamp | fg.tertiary | regular | xs (11) |
| Disabled text | fg.muted | regular | — |
| Button on accent | fg.onAccent | semibold | base (15) |

### Z-Index Scale

| Layer | Value | Usage |
|---|---|---|
| base | 0 | Default content |
| dropdown | 10 | Dropdown menus |
| sticky | 20 | Sticky headers |
| overlay | 30 | Bottom sheets, overlays |
| modal | 40 | Modal dialogs |
| toast | 50 | Toast notifications (always on top) |

---

## Changelog

### v1.0.0
- Initial design system documentation
- Dark-first borderless philosophy established
- Token system: colors, typography, spacing, radii, motion, z-index
- Component specifications: bottom bar, panels, sheets, buttons, inputs
- IBM Plex Sans + JetBrains Mono font stack
- Mint teal (#5fccb0) accent system
- Terminal ANSI palette optimized for #161616
- Anti-patterns documented
- Visual identity reference (colors, fonts, personality)

---

*This is a living document. All values reference `src/theme/tokens.ts` — update
that file first, then reflect changes here. The code is the source of truth.*
