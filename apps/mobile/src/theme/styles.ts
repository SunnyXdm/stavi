// ============================================================
// Design System Primitives — reusable style creators
// ============================================================
// Use these instead of hardcoding styles in components.
// Example: textStyles.heading instead of { fontSize: 20, fontWeight: '700' }

import { StyleSheet } from 'react-native';
import { colors, typography, spacing, radii } from './tokens';

// ----------------------------------------------------------
// Text styles
// ----------------------------------------------------------

export const textStyles = StyleSheet.create({
  // Headings
  h1: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
    letterSpacing: typography.letterSpacing.tight,
    lineHeight: typography.fontSize['3xl'] * typography.lineHeight.tight,
  },
  h2: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
    letterSpacing: typography.letterSpacing.tight,
    lineHeight: typography.fontSize['2xl'] * typography.lineHeight.tight,
  },
  h3: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    lineHeight: typography.fontSize.xl * typography.lineHeight.tight,
  },
  h4: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    lineHeight: typography.fontSize.lg * typography.lineHeight.tight,
  },

  // Body
  body: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.secondary,
    lineHeight: typography.fontSize.base * typography.lineHeight.normal,
  },
  bodySmall: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.secondary,
    lineHeight: typography.fontSize.sm * typography.lineHeight.normal,
  },

  // Labels
  label: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.primary,
    letterSpacing: typography.letterSpacing.wide,
  },
  labelSmall: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
    letterSpacing: typography.letterSpacing.wider,
    textTransform: 'uppercase' as const,
  },

  // Caption
  caption: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.tertiary,
    lineHeight: typography.fontSize.xs * typography.lineHeight.normal,
  },

  // Code / Mono
  code: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.primary,
  },
  codeSmall: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
  },
});

// ----------------------------------------------------------
// Surface styles (background layers)
// ----------------------------------------------------------

export const surfaceStyles = StyleSheet.create({
  base: {
    backgroundColor: colors.bg.base,
  },
  raised: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
  },
  overlay: {
    backgroundColor: colors.bg.overlay,
    borderRadius: radii.lg,
  },
  elevated: {
    backgroundColor: colors.bg.elevated,
    borderRadius: radii.md,
  },
  input: {
    backgroundColor: colors.bg.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
});

// ----------------------------------------------------------
// Layout helpers
// ----------------------------------------------------------

export const layoutStyles = StyleSheet.create({
  flex1: { flex: 1 },
  row: { flexDirection: 'row' },
  rowCenter: { flexDirection: 'row', alignItems: 'center' },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  center: { alignItems: 'center', justifyContent: 'center' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  screenPadding: { paddingHorizontal: spacing[4] },
});

// ----------------------------------------------------------
// Interactive element styles
// ----------------------------------------------------------

export const interactiveStyles = StyleSheet.create({
  // Primary button
  buttonPrimary: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing[6],
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44, // Accessibility minimum touch target
  },
  buttonPrimaryText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },

  // Ghost button (no background)
  buttonGhost: {
    borderRadius: radii.md,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
  },
  buttonGhostText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },

  // Icon button
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Pressable feedback
  pressableActive: {
    backgroundColor: colors.bg.active,
    borderRadius: radii.md,
  },
});
