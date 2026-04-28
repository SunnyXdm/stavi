// WHAT: Design-system tokens — single source of truth for all visual values.
// WHY:  Every component derives its colors, typography, spacing, and radii from
//       this file. Changing a token here propagates everywhere. Zero hardcoded
//       values in components.
// HOW:  Plain `as const` object exported from this module. No runtime computation,
//       no theme context — just static data. lightColors is exported for future
//       phase wiring but is intentionally inert in the current app build.
// SEE:  DESIGN.md (source of truth for all values), theme/styles.ts (pre-composed
//       StyleSheet entries derived from these tokens), theme/provider-brands.ts
//       (brand colors — NOT theme tokens)

// ----------------------------------------------------------
// Dark Mode Colors  (active palette — app is dark-mode-only in Phase 7b)
// ----------------------------------------------------------

export const colors = {
  // Background layers — depth through progressive lightening
  bg: {
    base:       '#08090a',            // App Background — DESIGN.md §2
    raised:     '#0f1011',            // Panel Background — DESIGN.md §2
    overlay:    '#191a1b',            // Surface Background — DESIGN.md §2
    surfaceAlt: '#222327',            // Surface Alt — DESIGN.md §2 (new in 7b)
    elevated:   '#222327',            // Elevated Surface — aliases surfaceAlt
    input:      '#0d0e0f',            // Between base and raised
    active:     '#2a2d30',            // Active/pressed surface
    scrim:      'rgba(0, 0, 0, 0.5)',
  },

  fg: {
    primary:   '#f7f8f8',             // Primary Text — DESIGN.md §2
    secondary: '#d0d6e0',             // Secondary Text — cool blue-gray per DESIGN.md
    tertiary:  '#8a8f98',             // Muted Text — DESIGN.md §2
    muted:     '#62666d',             // Subtle Text — DESIGN.md §2
    onAccent:  '#ffffff',             // Text on accent-filled backgrounds
  },

  accent: {
    primary:   '#5e6ad2',             // Linear indigo — DESIGN.md §2
    secondary: '#7170ff',             // Accent Hover/Active — DESIGN.md §2
    subtle:    'rgba(94, 106, 210, 0.12)',  // Recomputed from #5e6ad2
    glow:      'rgba(94, 106, 210, 0.25)',  // Recomputed from #5e6ad2
  },

  semantic: {
    success:       '#10b981',         // DESIGN.md §2
    warning:       '#f59e0b',         // DESIGN.md §2
    error:         '#cf2d56',         // DESIGN.md §2
    info:          '#60a5fa',         // DESIGN.md §2
    successSubtle: 'rgba(16, 185, 129, 0.12)',
    warningSubtle: 'rgba(245, 158, 11, 0.12)',
    errorSubtle:   'rgba(207, 45, 86, 0.12)',
    infoSubtle:    'rgba(96, 165, 250, 0.12)',
  },

  // Terminal ANSI palette — optimized for readability on bg.base
  terminal: {
    black:         '#1e1e1e',
    red:           '#f87171',
    green:         '#4ade80',
    yellow:        '#fbbf24',
    blue:          '#60a5fa',
    magenta:       '#c084fc',
    cyan:          '#22d3ee',
    white:         '#e5e5e5',
    brightBlack:   '#4a4a4a',
    brightRed:     '#fca5a5',
    brightGreen:   '#86efac',
    brightYellow:  '#fde68a',
    brightBlue:    '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan:    '#67e8f9',
    brightWhite:   '#fafafa',
  },

  transparent:   'transparent',
  divider:       'rgba(255, 255, 255, 0.08)',  // Primary Border — DESIGN.md §2
  dividerSubtle: 'rgba(255, 255, 255, 0.05)',  // Subtle Border — DESIGN.md §2
} as const;

// ----------------------------------------------------------
// Light Mode Colors  (INERT — exported for future phase wiring only)
// No ThemeProvider, no useColorScheme, no conditional rendering.
// The app remains dark-mode-only in Phase 7b.
// ----------------------------------------------------------

export const lightColors = {
  bg: {
    base:       '#f2f1ed',            // App Background — DESIGN.md §2 light
    raised:     '#ebeae5',            // Panel Background
    overlay:    '#e6e5e0',            // Surface Background
    surfaceAlt: '#dedcd6',            // Surface Alt
    elevated:   '#dedcd6',
    input:      '#e8e7e2',
    active:     '#d8d6d0',
    scrim:      'rgba(0, 0, 0, 0.3)',
  },
  fg: {
    primary:   '#26251e',
    secondary: 'rgba(38, 37, 30, 0.72)',
    tertiary:  'rgba(38, 37, 30, 0.55)',
    muted:     'rgba(38, 37, 30, 0.38)',
    onAccent:  '#ffffff',
  },
  accent: {
    primary:   '#f54e00',             // DESIGN.md §2 light
    secondary: '#ff5600',
    subtle:    'rgba(245, 78, 0, 0.10)',
    glow:      'rgba(245, 78, 0, 0.20)',
  },
  semantic: {
    success:       '#1f8a65',         // DESIGN.md §2 light
    warning:       '#b7791f',
    error:         '#c2415d',
    info:          '#2563eb',
    successSubtle: 'rgba(31, 138, 101, 0.10)',
    warningSubtle: 'rgba(183, 121, 31, 0.10)',
    errorSubtle:   'rgba(194, 65, 93, 0.10)',
    infoSubtle:    'rgba(37, 99, 235, 0.10)',
  },
  terminal: {
    black:         '#1e1e1e',
    red:           '#d73527',
    green:         '#1f8a65',
    yellow:        '#b7791f',
    blue:          '#2563eb',
    magenta:       '#7c3aed',
    cyan:          '#0891b2',
    white:         '#26251e',
    brightBlack:   '#6b7280',
    brightRed:     '#ef4444',
    brightGreen:   '#10b981',
    brightYellow:  '#f59e0b',
    brightBlue:    '#3b82f6',
    brightMagenta: '#8b5cf6',
    brightCyan:    '#06b6d4',
    brightWhite:   '#111111',
  },
  transparent:   'transparent',
  divider:       'rgba(38, 37, 30, 0.10)',
  dividerSubtle: 'rgba(38, 37, 30, 0.06)',
} as const;

// ----------------------------------------------------------
// Typography
// ----------------------------------------------------------

export const typography = {
  fontFamily: {
    sans:         'Inter',
    sansMedium:   'Inter-Medium',
    sansSemiBold: 'Inter-SemiBold',
    sansBold:     'Inter-Bold',
    // Berkeley Mono unavailable as TTF; JetBrains Mono is the monospace.
    mono:         'JetBrainsMono',
    monoMedium:   'JetBrainsMono-Medium',
    monoBold:     'JetBrainsMono-Bold',
    monoFallback: 'monospace',
  },
  // DESIGN.md §3 — Typography hierarchy
  fontSize: {
    xs:    11,   // Micro (badges, status text)
    sm:    13,   // Meta / Mono Body
    base:  16,   // Body — DESIGN.md specifies 16 (was 15 before 7b)
    md:    17,   // Card Title
    lg:    20,   // Section Title
    xl:    24,
    '2xl': 28,   // Screen Title — DESIGN.md specifies 28
    '3xl': 35,
  },
  lineHeight: {
    tight:   1.2,
    normal:  1.5,
    relaxed: 1.7,
  },
  fontWeight: {
    regular:  '400' as const,
    medium:   '500' as const,
    semibold: '600' as const,
    bold:     '700' as const,
  },
  letterSpacing: {
    tight:  -0.3,
    normal: 0,
    wide:   0.5,
    wider:  1.0,
  },
} as const;

// ----------------------------------------------------------
// Spacing  (8pt grid per DESIGN.md §5)
// ----------------------------------------------------------

export const spacing = {
  0:  0,
  1:  4,
  2:  8,
  3:  12,
  4:  16,
  5:  20,
  6:  24,
  8:  32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// ----------------------------------------------------------
// Border Radii  (DESIGN.md §5)
// ----------------------------------------------------------

export const radii = {
  none: 0,
  sm:   4,
  md:   8,    // inputs and buttons
  card: 10,   // cards and panels — DESIGN.md §4 (new in 7b)
  lg:   12,   // major sheets and containers
  xl:   16,
  full: 9999,
} as const;

// ----------------------------------------------------------
// Motion
// ----------------------------------------------------------

export const motion = {
  duration: { fast: 100, normal: 200, slow: 300, verySlow: 500 },
  easing: {
    easeOut:   'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    easeIn:    'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
    easeInOut: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
    spring:    { damping: 20, stiffness: 300, mass: 0.8 },
  },
} as const;

export const shadows = {} as const;

export const zIndex = {
  base:     0,
  dropdown: 10,
  sticky:   20,
  overlay:  30,
  modal:    40,
  toast:    50,
} as const;

// ----------------------------------------------------------
// Theme bundle
// ----------------------------------------------------------

// Derive a widened Colors type so both darkColors and lightColors satisfy it.
// DeepString<T> replaces every leaf value with `string`, making the type
// compatible with both `as const` palettes without losing the key structure.
type DeepString<T> = { [K in keyof T]: T[K] extends object ? DeepString<T[K]> : string };
export type Colors     = DeepString<typeof colors>;
export type Typography = typeof typography;
export type Spacing    = typeof spacing;

export const theme = { colors, typography, spacing, radii, motion, shadows, zIndex } as const;
export type Theme = typeof theme;
