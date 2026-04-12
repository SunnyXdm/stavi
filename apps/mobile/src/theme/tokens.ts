// ============================================================
// Stavi Design System — Token-Based, Borderless, Dark-First
// ============================================================
// Philosophy: Depth through background layering, not borders.
// Opacity-based text hierarchy. Accent scarcity.
// Calm, borderless aesthetic — warmer grays, mint teal accent.
// No shadows in dark mode. No borders. Just bg layers.

// ----------------------------------------------------------
// Colors
// ----------------------------------------------------------

export const colors = {
  // Background layers — depth through progressive lightening
  // Each layer is ~10-12 lightness steps apart for clear visual separation
  bg: {
    base: '#161616',       // App background, deepest layer
    raised: '#212121',     // Cards, panels, elevated surfaces
    overlay: '#2a2a2a',    // Modals, sheets, floating UI
    elevated: '#333333',   // Tooltips, popovers, highest layer
    input: '#1e1e1e',      // Text inputs, search bars (between base and raised)
    active: '#383838',     // Pressed/selected state backgrounds
    scrim: 'rgba(0, 0, 0, 0.5)', // Modal backdrop overlay
  },

  // Foreground — single base color, opacity-based hierarchy
  // Optimized for readability on #161616 base — WCAG AA compliant
  fg: {
    primary: '#fafafa',    // 100% — headings, important text, interactive labels
    secondary: '#c0c0c0',  // 75% — body text, descriptions
    tertiary: '#9e9e9e',   // 62% — placeholders, captions, timestamps
    muted: '#666666',      // 40% — disabled text, decorative labels
    onAccent: '#0a0f0d',   // Dark text on accent-colored backgrounds
  },

  // Accent — mint teal, used sparingly for interactive elements and focus states
  // Single hue family — never mix accent colors
  accent: {
    primary: '#5fccb0',    // Buttons, active tabs, links — calm mint teal
    secondary: '#4db89d',  // Hover/pressed accent (slightly darker)
    subtle: 'rgba(95, 204, 176, 0.12)', // Accent tint backgrounds
    glow: 'rgba(95, 204, 176, 0.25)',   // Focus rings, selection highlights
  },

  // Semantic colors — status indicators only, never for decoration
  semantic: {
    success: '#4ade80',    // Git staged, test passed, connected
    warning: '#fbbf24',    // Unstaged changes, pending approval
    error: '#f87171',      // Errors, disconnected, test failed
    info: '#60a5fa',       // Information banners, tips

    successSubtle: 'rgba(74, 222, 128, 0.12)',
    warningSubtle: 'rgba(251, 191, 36, 0.12)',
    errorSubtle: 'rgba(248, 113, 113, 0.12)',
    infoSubtle: 'rgba(96, 165, 250, 0.12)',
  },

  // Terminal ANSI palette — optimized for readability on #161616
  terminal: {
    black: '#1e1e1e',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#fbbf24',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e5e5e5',
    brightBlack: '#4a4a4a',
    brightRed: '#fca5a5',
    brightGreen: '#86efac',
    brightYellow: '#fde68a',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#fafafa',
  },

  // Utility
  transparent: 'transparent',
  divider: 'rgba(255, 255, 255, 0.06)', // Very subtle separation when layering isn't enough
} as const;

// ----------------------------------------------------------
// Typography
// ----------------------------------------------------------

export const typography = {
  // Font families — distinct sans/mono split for data distinction
  fontFamily: {
    sans: 'IBMPlexSans',         // UI text — clean, technical, humanist
    sansMedium: 'IBMPlexSans-Medium',
    sansSemiBold: 'IBMPlexSans-SemiBold',
    sansBold: 'IBMPlexSans-Bold',
    mono: 'JetBrainsMono',       // Code, terminal, data — ligatures disabled
    monoMedium: 'JetBrainsMono-Medium',
    monoBold: 'JetBrainsMono-Bold',
    monoFallback: 'monospace',   // Fallback if JetBrains Mono unavailable
  },

  // Type scale — 1.2 modular scale
  fontSize: {
    xs: 11,
    sm: 13,
    base: 15,
    md: 17,
    lg: 20,
    xl: 24,
    '2xl': 29,
    '3xl': 35,
  },

  // Line heights (multipliers)
  lineHeight: {
    tight: 1.2,
    normal: 1.5,
    relaxed: 1.7,
  },

  // Font weights
  fontWeight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const,
  },

  // Letter spacing
  letterSpacing: {
    tight: -0.3,
    normal: 0,
    wide: 0.5,
    wider: 1.0,
  },
} as const;

// ----------------------------------------------------------
// Spacing — 4px grid
// ----------------------------------------------------------

export const spacing = {
  0: 0,
  1: 4,
  2: 8,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  8: 32,
  10: 40,
  12: 48,
  16: 64,
} as const;

// ----------------------------------------------------------
// Radii
// ----------------------------------------------------------

export const radii = {
  none: 0,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;

// ----------------------------------------------------------
// Motion
// ----------------------------------------------------------

export const motion = {
  duration: {
    fast: 100,
    normal: 200,
    slow: 300,
    verySlow: 500,
  },
  easing: {
    easeOut: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
    easeIn: 'cubic-bezier(0.55, 0.085, 0.68, 0.53)',
    easeInOut: 'cubic-bezier(0.645, 0.045, 0.355, 1)',
    spring: { damping: 20, stiffness: 300, mass: 0.8 },
  },
} as const;

// ----------------------------------------------------------
// Shadows — ONLY for light theme future use. Never in dark mode.
// ----------------------------------------------------------

export const shadows = {
  // Intentionally empty for dark theme — use bg layering instead.
  // Adding shadows in dark mode is an anti-pattern.
} as const;

// ----------------------------------------------------------
// Z-index scale
// ----------------------------------------------------------

export const zIndex = {
  base: 0,
  dropdown: 10,
  sticky: 20,
  overlay: 30,
  modal: 40,
  toast: 50,
} as const;

// ----------------------------------------------------------
// Composite theme object
// ----------------------------------------------------------

export const theme = {
  colors,
  typography,
  spacing,
  radii,
  motion,
  shadows,
  zIndex,
} as const;

export type Theme = typeof theme;
export type Colors = typeof colors;
export type Typography = typeof typography;
export type Spacing = typeof spacing;
