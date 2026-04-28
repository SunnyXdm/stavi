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
}

interface AppPreferencesActions {
  setHaptics(enabled: boolean): void;
}

export const useAppPreferencesStore = create<AppPreferencesState & AppPreferencesActions>()(
  persist(
    (set) => ({
      haptics: true,
      setHaptics: (haptics) => set({ haptics }),
    }),
    {
      name: 'stavi-app-preferences',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
