# DESIGN.md

## 1. Visual Theme & Atmosphere

Stavi is a mobile workspace for coding, terminals, AI threads, and server tools. The design should feel **precise, calm, and technical**, with enough warmth that the AI surfaces do not feel cold. The overall direction is:

* **Linear** for shell structure, density, and dark-mode precision
* **Cursor** for subtle warmth and developer-tool character
* **Intercom** only for conversational softness in AI flows and onboarding

This is a **React Native app**, not a marketing site. Prioritize:

* fast scanning
* clean hierarchy
* strong session/server state clarity
* low visual noise
* comfortable long-duration use

The UI should feel like a serious tool, not a playful consumer app.

**Key characteristics:**

* dark-mode-first, light mode fully supported
* restrained accent usage
* compact but touch-friendly spacing
* low-radius geometry
* high legibility at mobile sizes
* subtle depth through surfaces and borders, not heavy shadows
* code/tooling feel without making every screen look like a terminal

---

## 2. Color Palette & Roles

### Dark Mode

* **App Background**: `#08090a`
* **Panel Background**: `#0f1011`
* **Surface Background**: `#191a1b`
* **Surface Alt**: `#222327`
* **Primary Text**: `#f7f8f8`
* **Secondary Text**: `#d0d6e0`
* **Muted Text**: `#8a8f98`
* **Subtle Text**: `#62666d`
* **Primary Border**: `rgba(255,255,255,0.08)`
* **Subtle Border**: `rgba(255,255,255,0.05)`
* **Primary Accent**: `#5e6ad2`
* **Accent Hover / Active**: `#7170ff`
* **Success**: `#10b981`
* **Warning**: `#f59e0b`
* **Error**: `#cf2d56`
* **Info**: `#60a5fa`

### Light Mode

* **App Background**: `#f2f1ed`
* **Panel Background**: `#ebeae5`
* **Surface Background**: `#e6e5e0`
* **Surface Alt**: `#dedcd6`
* **Primary Text**: `#26251e`
* **Secondary Text**: `rgba(38,37,30,0.72)`
* **Muted Text**: `rgba(38,37,30,0.55)`
* **Subtle Text**: `rgba(38,37,30,0.38)`
* **Primary Border**: `rgba(38,37,30,0.10)`
* **Subtle Border**: `rgba(38,37,30,0.06)`
* **Primary Accent**: `#f54e00`
* **Accent Hover / Active**: `#ff5600`
* **Success**: `#1f8a65`
* **Warning**: `#b7791f`
* **Error**: `#c2415d`
* **Info**: `#2563eb`

### Rules

* Accent color is for **active state, selection, primary actions, and key highlights only**.
* Do not use multiple bright accent colors in the shell.
* Server/tool state colors should be semantic, not decorative.
* AI surfaces may feel slightly warmer than terminal/system surfaces, but must still use the same token system.

---

## 3. Typography Rules

### Font Family

* **Primary / UI**: `Inter`
* **Monospace**: `Berkeley Mono` or platform monospace fallback
* **Fallbacks**: system defaults for React Native platforms

### Hierarchy

| Role          | Size | Weight | Line Height | Notes                       |
| ------------- | ---- | ------ | ----------- | --------------------------- |
| Screen Title  | 28   | 600    | 32          | Main screen headers         |
| Section Title | 20   | 600    | 24          | Session groups, sheets      |
| Card Title    | 17   | 600    | 22          | Rows, cards, plugin panels  |
| Body          | 16   | 400    | 22          | Standard content            |
| Body Strong   | 16   | 500    | 22          | Important body text         |
| Meta          | 13   | 500    | 18          | Labels, timestamps          |
| Micro         | 11   | 500    | 14          | Badges, status text         |
| Mono Body     | 13   | 400    | 18          | Terminal / technical labels |

### Rules

* Keep typography mostly sans-serif.
* Use monospace only for code, paths, terminal content, ids, and highly technical labels.
* Avoid oversized marketing-style headings inside the app.
* Prioritize vertical rhythm and readable line height over aggressive typographic personality.

---

## 4. Component Stylings

### Buttons

**Primary Button**

* Filled with primary accent
* White or near-white text in dark mode, dark text in light mode if needed for contrast
* Radius: `8`
* Height: `40–44`

**Secondary Button**

* Surface background with subtle border
* Primary text color
* Radius: `8`

**Ghost Button**

* Transparent background
* Secondary text by default, primary text on active/pressed
* Use for toolbar or lightweight actions

### Cards & Rows

* Use surface backgrounds with subtle borders
* Radius: `10`
* Avoid large shadows
* Session rows should feel compact, tappable, and structured

### Inputs

* Surface background
* Subtle border
* Clear focused state using accent border or glow
* Radius: `8`
* Comfortable text padding for touch devices

### Tabs

* Active tab indicated by accent text and/or accent underline or pill fill
* Inactive tabs use muted text
* Keep tabs compact and clean

### Badges / Status

* Small rounded badges for status
* Use semantic colors sparingly
* Prefer dots + short labels over large pills when space is tight

### Sheets / Modals

* Use elevated surface tone, not dramatic shadows
* Rounded top corners for bottom sheets
* Clear handle area and strong title hierarchy

---

## 5. Layout Principles

### Spacing

Use an 8pt system:

* `4, 8, 12, 16, 20, 24, 32`

### Border Radius

* `8` for inputs and buttons
* `10` for cards and panels
* `12` for major sheets
* Avoid mixing many radius values

### Structure

The app has three main visual modes:

* **Home / Session Manager**: structured lists, grouped by server
* **Workspace**: dense but calm multi-tool shell
* **Sheets / Overlays**: focused transient tasks

### Rules

* Group with spacing first, borders second, background third
* Prefer simple stacked layouts over over-designed card mosaics
* Keep navigation and tool chrome visually quieter than content

---

## 6. Depth & Elevation

Depth should come mainly from:

* surface tone changes
* border contrast
* layering of panels

Do **not** rely on heavy shadows.

### Dark Mode

* Root → Panel → Surface → Elevated Surface
* Each level becomes slightly lighter

### Light Mode

* Root → Warm panel → Surface → Elevated surface
* Each level becomes slightly darker / more defined

Shadows, if used, should be soft and minimal.

---

## 7. Interaction & Motion

### Interaction

* Pressed states should slightly darken or tint the component
* Active states should use accent color clearly but sparingly
* Focused inputs should be obvious
* Selected session/server/plugin state must be instantly scannable

### Motion

* Fast and subtle
* `150–220ms` transitions
* No bounce, no playful motion
* Sheets and drawers should feel smooth and native

### Feedback

* Loading: minimal spinners or skeleton rows
* Success: subtle confirmation, not celebratory
* Errors: concise and direct

---

## 8. Screen-by-Screen Intent

### Sessions Home

* Most important quality: **clarity of grouping**
* Server headers must feel distinct from session rows
* Session rows should surface title, folder, status, and recency cleanly
* Tools entry point for server-scoped tools should feel secondary but visible

### Workspace

* Most important quality: **focus**
* The shell should recede so the active plugin dominates
* Bottom plugin bar should be clean and stable
* Drawer should feel like contextual sub-navigation, not global navigation

### AI Plugin

* Slightly warmer and more conversational than terminal/system surfaces
* Message grouping, authorship, and action affordances should be extremely clear
* Keep chat UI professional, not bubbly or playful

### Terminal / Git / System Tools

* More utilitarian and denser
* Less warmth, more precision
* Prioritize scanability and state visibility

---

## 9. Do's and Don'ts

### Do

* Design for long sessions, not quick novelty
* Keep chrome quiet and content strong
* Use one accent color per theme
* Make state visible: connected, active, running, errored, archived
* Preserve strong contrast and hierarchy in both themes
* Make everything feel native to mobile, not like a shrunk desktop app

### Don't

* Don't overuse gradients, glow, or blur
* Don't make every surface a card
* Don't use decorative illustration styles inside core workflows
* Don't mix warm playful marketing patterns into system-heavy screens
* Don't make dark mode pure black everywhere or light mode pure white everywhere
* Don't let AI surfaces visually overpower the rest of the workspace

---

## 10. Final Design Direction

Stavi should feel like:

* **Linear's precision** in shell, hierarchy, and density
* **Cursor's subtle warmth** in light mode and developer character
* **Intercom's humanity** only in AI and onboarding moments

The result should be a **serious React Native developer tool** with:

* dark-mode-first confidence
* light-mode warmth without softness
* clean session/server management
* calm, legible plugin surfaces
* a design language that can scale as the product gets more complex
