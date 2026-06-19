// WHAT: Persisted app-level preferences (haptics enabled, etc).
// WHY:  App-wide toggles like haptics aren't plugin-scoped, so they don't belong in
//       plugin-settings-store. A dedicated store keeps them simple and avoids
//       coupling to plugin infra.
// HOW:  Zustand + AsyncStorage persist. Mirror of theme-store pattern.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AppPreferencesState {
  haptics: boolean;
  /** True once the user has passed the first-run welcome screen. Gates the
   *  one-time onboarding intro so it isn't shown on every empty home. */
  hasOnboarded: boolean;
  /** True once AsyncStorage has rehydrated — used to defer the first-run
   *  decision until persisted prefs are known. */
  hasHydrated: boolean;
}

interface AppPreferencesActions {
  setHaptics(enabled: boolean): void;
  setHasOnboarded(value: boolean): void;
}

export const useAppPreferencesStore = create<AppPreferencesState & AppPreferencesActions>()(
  persist(
    (set) => ({
      haptics: true,
      hasOnboarded: false,
      hasHydrated: false,
      setHaptics: (haptics) => set({ haptics }),
      setHasOnboarded: (hasOnboarded) => set({ hasOnboarded }),
    }),
    {
      name: 'stavi-app-preferences',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ haptics: s.haptics, hasOnboarded: s.hasOnboarded }),
      onRehydrateStorage: () => () => {
        useAppPreferencesStore.setState({ hasHydrated: true });
      },
    },
  ),
);
