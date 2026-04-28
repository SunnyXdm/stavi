// WHAT: Persisted Zustand store for plugin-specific settings.
// WHY:  Plugins declare a settings schema; this store holds the values keyed by
//       pluginId → key. Defaults come from the schema, not stored, so changing a
//       default in a schema is automatically picked up for users who haven't changed it.
// HOW:  Zustand + persist + AsyncStorage. usePluginSetting() is a narrow selector
//       that reads one field at a time to avoid unnecessary re-renders.
// SEE:  packages/shared/src/plugin-types.ts (PluginSettingsSchema)
//       apps/mobile/src/stores/plugin-registry.ts (definitions)
//       apps/mobile/src/components/SettingsRenderer.tsx (UI)

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePluginRegistry } from './plugin-registry';

// ----------------------------------------------------------
// State + Actions
// ----------------------------------------------------------

interface PluginSettingsState {
  /** settingsByPlugin[pluginId][key] = stored value (overrides schema default) */
  settingsByPlugin: Record<string, Record<string, unknown>>;
}

interface PluginSettingsActions {
  getSetting(pluginId: string, key: string): unknown;
  setSetting(pluginId: string, key: string, value: unknown): void;
  resetPlugin(pluginId: string): void;
  resetAll(): void;
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const usePluginSettingsStore = create<PluginSettingsState & PluginSettingsActions>()(
  persist(
    (set, get) => ({
      settingsByPlugin: {},

      getSetting(pluginId, key) {
        return get().settingsByPlugin[pluginId]?.[key];
      },

      setSetting(pluginId, key, value) {
        set((state) => ({
          settingsByPlugin: {
            ...state.settingsByPlugin,
            [pluginId]: {
              ...(state.settingsByPlugin[pluginId] ?? {}),
              [key]: value,
            },
          },
        }));
      },

      resetPlugin(pluginId) {
        set((state) => {
          const next = { ...state.settingsByPlugin };
          delete next[pluginId];
          return { settingsByPlugin: next };
        });
      },

      resetAll() {
        set({ settingsByPlugin: {} });
      },
    }),
    {
      name: 'stavi-plugin-settings',
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);

// ----------------------------------------------------------
// usePluginSetting — narrow per-field hook
// ----------------------------------------------------------

/**
 * Returns the current value for a single plugin setting, falling back to the
 * schema default if the user hasn't changed it. Uses a narrow Zustand selector
 * so only this field's value triggers a re-render.
 */
export function usePluginSetting<T = unknown>(pluginId: string, key: string): T {
  // Narrow selector: only re-render when this exact (pluginId, key) value changes
  const stored = usePluginSettingsStore(
    (s) => s.settingsByPlugin[pluginId]?.[key],
  );

  // Look up schema default from plugin registry (stable reference, no re-render)
  const schemaDefault = usePluginRegistry((s) => {
    const definition = s.definitions[pluginId];
    if (!definition?.settings) return undefined;
    for (const section of definition.settings.sections) {
      const field = section.fields.find((f) => f.key === key);
      if (field) return field.default;
    }
    return undefined;
  });

  return (stored !== undefined ? stored : schemaDefault) as T;
}
