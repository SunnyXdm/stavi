// WHAT: Persistent store for the user's theme preference.
// WHY:  Theme is global app state that must be readable before any plugin
//       registers — so it lives in its own store, not plugin-settings-store.
//       Separate store also avoids coupling a core app concern to plugin infra.
// HOW:  Zustand + AsyncStorage persist. ThemeContext reads this to pick the
//       active palette. useColorScheme() is consulted only when mode='system'.
// SEE:  apps/mobile/src/theme/ThemeContext.tsx

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeStoreState {
  mode: ThemeMode;
}

interface ThemeStoreActions {
  setMode(mode: ThemeMode): void;
}

export const useThemeStore = create<ThemeStoreState & ThemeStoreActions>()(
  persist(
    (set) => ({
      mode: 'light',
      setMode: (mode) => set({ mode }),
    }),
    {
      name: 'stavi-theme',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      migrate: () => ({ mode: 'light' as ThemeMode }),
    },
  ),
);
