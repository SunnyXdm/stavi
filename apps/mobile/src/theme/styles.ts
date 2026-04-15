// WHAT: Pre-composed StyleSheet entries derived from design tokens.
// WHY:  Avoids repeating the same token combinations across components.
//       Centralising common patterns (headings, surfaces, buttons) ensures
//       consistency and makes system-wide changes a one-file edit.
// HOW:  StyleSheet.create() called once at module load. Components import
//       these and spread/compose them with local overrides.
// SEE:  theme/tokens.ts (source of all values used here)

import { StyleSheet } from 'react-native';
import { colors, typography, spacing, radii } from './tokens';

export const textStyles = StyleSheet.create({
  // Screen Title: 28 / 600 — DESIGN.md §3
  h1: { fontSize: typography.fontSize['2xl'], fontWeight: typography.fontWeight.bold, color: colors.fg.primary, letterSpacing: typography.letterSpacing.tight, lineHeight: 32 },
  // Section Title: 20 / 600 — DESIGN.md §3
  h2: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary, letterSpacing: typography.letterSpacing.tight, lineHeight: 24 },
  // Card Title: 17 / 600 — DESIGN.md §3
  h3: { fontSize: typography.fontSize.md, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary, lineHeight: 22 },
  // Body Strong: 16 / 500 — DESIGN.md §3
  h4: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.medium, color: colors.fg.primary, lineHeight: 22 },
  // Body: 16 / 400 — DESIGN.md §3
  body: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.regular, color: colors.fg.secondary, lineHeight: 22 },
  // Meta: 13 / regular — DESIGN.md §3
  bodySmall: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.regular, color: colors.fg.secondary, lineHeight: typography.fontSize.sm * typography.lineHeight.normal },
  label: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.fg.primary, letterSpacing: typography.letterSpacing.wide },
  // Micro: 11 / 500 — DESIGN.md §3
  labelSmall: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.fg.tertiary, letterSpacing: typography.letterSpacing.wider, textTransform: 'uppercase' as const },
  caption: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.regular, color: colors.fg.tertiary, lineHeight: typography.fontSize.xs * typography.lineHeight.normal },
  // Mono Body: 13 / 400 — DESIGN.md §3
  code: { fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.primary },
  codeSmall: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
});

export const surfaceStyles = StyleSheet.create({
  base:     { backgroundColor: colors.bg.base },
  raised:   { backgroundColor: colors.bg.raised, borderRadius: radii.card },
  overlay:  { backgroundColor: colors.bg.overlay, borderRadius: radii.card },
  elevated: { backgroundColor: colors.bg.elevated, borderRadius: radii.md },
  input:    { backgroundColor: colors.bg.input, borderRadius: radii.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
});

export const layoutStyles = StyleSheet.create({
  flex1:         { flex: 1 },
  row:           { flexDirection: 'row' },
  rowCenter:     { flexDirection: 'row', alignItems: 'center' },
  rowBetween:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center:        { alignItems: 'center', justifyContent: 'center' },
  fill:          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  screenPadding: { paddingHorizontal: spacing[4] },
});

export const interactiveStyles = StyleSheet.create({
  // Primary button: accent-filled, white text, radius 8 — DESIGN.md §4
  buttonPrimary:     { backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingHorizontal: spacing[6], paddingVertical: spacing[3], alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  buttonPrimaryText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
  // Ghost button: transparent, muted text — DESIGN.md §4
  buttonGhost:       { borderRadius: radii.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3], alignItems: 'center', justifyContent: 'center', minHeight: 44 },
  buttonGhostText:   { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.medium, color: colors.fg.secondary },
  iconButton:        { width: 40, height: 40, borderRadius: radii.md, alignItems: 'center', justifyContent: 'center' },
  pressableActive:   { backgroundColor: colors.bg.active, borderRadius: radii.md },
});
