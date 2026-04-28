// WHAT: ThemeContext — provides the active color palette and theme metadata to
//       all components via useTheme().
// WHY:  Components need a reactive token set that switches when the user changes
//       theme preference or the system appearance changes.
// HOW:  Reads mode from theme-store (persisted). Resolves 'system' via RN's
//       useColorScheme(). Provides { colors, typography, spacing, radii, motion,
//       zIndex, isDark, mode }.
//       Components call useTheme() and pass colors into their StyleSheet factory
//       — see createStyles() pattern used in migrated components.
// SEE:  apps/mobile/src/stores/theme-store.ts (persistence)
//       apps/mobile/src/theme/tokens.ts (dark + light palettes)
//
// DESIGN NOTE: lightColors follow DESIGN.md §2 (warm cream, orange accent).
// The accent color changes between themes:
//   dark  → #5e6ad2 (Linear indigo)   — clean on dark surfaces
//   light → #f54e00 (Cursor orange)   — brand identity on cream surfaces
// Both are already in tokens.ts and match DESIGN.md exactly.

import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import {
  colors as darkColors,
  lightColors,
  typography,
  spacing,
  radii,
  motion,
  zIndex,
  type Colors,
  type Typography,
  type Spacing,
} from './tokens';
import { useThemeStore, type ThemeMode } from '../stores/theme-store';

// ----------------------------------------------------------
// Context shape
// ----------------------------------------------------------

export interface ThemeContextValue {
  colors: Colors;
  typography: Typography;
  spacing: Spacing;
  radii: typeof radii;
  motion: typeof motion;
  zIndex: typeof zIndex;
  isDark: boolean;
  mode: ThemeMode;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ----------------------------------------------------------
// Provider
// ----------------------------------------------------------

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const mode = useThemeStore((s) => s.mode);
  const systemScheme = useColorScheme(); // 'light' | 'dark' | null

  const isDark = useMemo(() => {
    if (mode === 'light') return false;
    if (mode === 'dark') return true;
    // system
    return systemScheme !== 'light';
  }, [mode, systemScheme]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      colors: (isDark ? darkColors : lightColors) as Colors,
      typography,
      spacing,
      radii,
      motion,
      zIndex,
      isDark,
      mode,
    }),
    [isDark, mode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    // Fallback for components outside the provider (e.g. legacy static StyleSheet)
    return {
      colors: darkColors as Colors,
      typography,
      spacing,
      radii,
      motion,
      zIndex,
      isDark: true,
      mode: 'dark',
    };
  }
  return ctx;
}
