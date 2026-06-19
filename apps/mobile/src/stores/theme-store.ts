// WHAT: Persistent store for the user's theme preference.
// WHY:  Theme is global app state that must be readable before any plugin
//       registers — so it lives in its own store, not plugin-settings-store.
//       Separate store also avoids coupling a core app concern to plugin infra.
// HOW:  Zustand + AsyncStorage persist. ThemeContext reads this to pick the
//       active palette. useColorScheme() is consulted only when mode='system'.
//       Default follows the OS ('system'); `userSet` records an explicit user
//       choice so future migrations never stomp it.
// SEE:  apps/mobile/src/theme/ThemeContext.tsx

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeStoreState {
  mode: ThemeMode;
  /** True once the user explicitly picked a mode in Settings. */
  userSet: boolean;
}

interface ThemeStoreActions {
  setMode(mode: ThemeMode): void;
}

export const useThemeStore = create<ThemeStoreState & ThemeStoreActions>()(
  persist(
    (set) => ({
      mode: 'system',
      userSet: false,
      setMode: (mode) => set({ mode, userSet: true }),
    }),
    {
      name: 'stavi-theme',
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      // v3: default switched to 'system'. Preserve an explicit user choice;
      // reset only modes that were never deliberately picked.
      migrate: (persisted: unknown) => {
        const prev = persisted as Partial<ThemeStoreState> | undefined;
        if (prev?.userSet && prev.mode) {
          return { mode: prev.mode, userSet: true };
        }
        return { mode: 'system' as ThemeMode, userSet: false };
      },
    },
  ),
);
