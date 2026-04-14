// ============================================================
// Plugin Registry — Zustand store for plugin lifecycle
// ============================================================
// Design decisions:
// - Registry is reactive (Zustand, not a static Map that's read once)
// - Bottom bar is a proper subscriber, no AsyncStorage polling hack
// - allowMultipleInstances is respected (not a dead flag)
// - Context value is memoized (no cascading re-renders)

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentType } from 'react';
import type {
  PluginDefinition,
  PluginInstance,
  PluginStatus,
  PluginPanelProps,
  PluginAPI,
} from '@stavi/shared';

// ----------------------------------------------------------
// Store State
// ----------------------------------------------------------

interface PluginRegistryState {
  /** All registered plugin definitions, keyed by plugin ID */
  definitions: Record<string, PluginDefinition>;

  /** All registered plugin components (separate from definitions to avoid serialization issues) */
  // NOTE: Components are stored in a module-level Map, not in Zustand state,
  // because React components cannot be serialized by the persist middleware.

  /** Open tab instances */
  openTabs: PluginInstance[];

  /** Currently active tab instance ID */
  activeTabId: string | null;

  /** Whether the plugin system is initialized */
  isReady: boolean;
}

interface PluginRegistryActions {
  /** Register a plugin definition (called at boot for core, on install for third-party) */
  register(definition: PluginDefinition, component?: ComponentType<PluginPanelProps>): void;

  /** Unregister a plugin (third-party uninstall) */
  unregister(pluginId: string): void;

  /** Open a plugin tab. Returns the instance ID. */
  openTab(pluginId: string, initialState?: Record<string, unknown>): string;

  /** Close a tab (only extra plugins, core tabs are uncloseable) */
  closeTab(instanceId: string): void;

  /** Switch to a tab */
  setActiveTab(instanceId: string): void;

  /** Update a plugin instance's status */
  setPluginStatus(pluginId: string, status: PluginStatus, error?: string): void;

  /** Initialize: ensure all core plugins have tabs */
  initialize(): void;

  /** Get the definition for a plugin ID */
  getDefinition(pluginId: string): PluginDefinition | undefined;

  /** Get all core plugin definitions, sorted by navOrder */
  getCorePlugins(): PluginDefinition[];

  /** Get all extra plugin definitions */
  getExtraPlugins(): PluginDefinition[];

  /** Can this tab be closed? (core = no, extra = yes) */
  canCloseTab(instanceId: string): boolean;
}

// ----------------------------------------------------------
// Component registry (module-level, not serialized)
// ----------------------------------------------------------

const componentRegistry = new Map<string, ComponentType<PluginPanelProps>>();

export function getPluginComponent(pluginId: string): ComponentType<PluginPanelProps> | undefined {
  return componentRegistry.get(pluginId);
}

// ----------------------------------------------------------
// Instance ID generator
// ----------------------------------------------------------

let instanceCounter = 0;

function createInstanceId(): string {
  return `tab_${Date.now()}_${++instanceCounter}`;
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const usePluginRegistry = create<PluginRegistryState & PluginRegistryActions>()(
  persist(
    (set, get) => ({
      // --- State ---
      definitions: {},
      openTabs: [],
      activeTabId: null,
      isReady: false,

      // --- Actions ---

      register: (definition, component) => {
        if (component) {
          componentRegistry.set(definition.id, component);
        }
        set((state) => ({
          definitions: {
            ...state.definitions,
            [definition.id]: definition,
          },
        }));
      },

      unregister: (pluginId) => {
        componentRegistry.delete(pluginId);
        set((state) => {
          const { [pluginId]: _, ...remaining } = state.definitions;
          return {
            definitions: remaining,
            openTabs: state.openTabs.filter((t) => t.pluginId !== pluginId),
            activeTabId:
              state.openTabs.find((t) => t.id === state.activeTabId)?.pluginId === pluginId
                ? state.openTabs.find((t) => t.pluginId !== pluginId)?.id ?? null
                : state.activeTabId,
          };
        });
      },

      openTab: (pluginId, initialState) => {
        const state = get();
        const definition = state.definitions[pluginId];
        if (!definition) {
          console.warn(`[PluginRegistry] Cannot open tab: plugin "${pluginId}" not registered`);
          return '';
        }

        // Reuse existing singleton plugins only when multiple instances are disabled
        if (!definition.allowMultipleInstances) {
          const existing = state.openTabs.find((t) => t.pluginId === pluginId);
          if (existing) {
            set({ activeTabId: existing.id });
            return existing.id;
          }
        }

        // Create new instance
        const instance: PluginInstance = {
          id: createInstanceId(),
          pluginId,
          title: definition.name,
          status: 'active',
          initialState,
        };

        set((s) => ({
          openTabs: [...s.openTabs, instance],
          activeTabId: instance.id,
        }));

        // Fire lifecycle hook
        definition.onActivate?.(instance.id);

        return instance.id;
      },

      closeTab: (instanceId) => {
        const state = get();
        const tab = state.openTabs.find((t) => t.id === instanceId);
        if (!tab) return;

        // Singleton core plugins cannot be closed; multi-instance core tabs can be
        const definition = state.definitions[tab.pluginId];
        if (definition?.kind === 'core' && !definition.allowMultipleInstances) return;

        // Fire lifecycle hook
        definition?.onDeactivate?.(instanceId);

        const newTabs = state.openTabs.filter((t) => t.id !== instanceId);
        const newActiveId =
          state.activeTabId === instanceId
            ? newTabs[newTabs.length - 1]?.id ?? null
            : state.activeTabId;

        set({ openTabs: newTabs, activeTabId: newActiveId });
      },

      setActiveTab: (instanceId) => {
        const state = get();
        const previousTab = state.openTabs.find((t) => t.id === state.activeTabId);
        const nextTab = state.openTabs.find((t) => t.id === instanceId);

        if (!nextTab) return;

        // Fire lifecycle hooks
        if (previousTab && previousTab.id !== instanceId) {
          state.definitions[previousTab.pluginId]?.onDeactivate?.(previousTab.id);
        }
        state.definitions[nextTab.pluginId]?.onActivate?.(nextTab.id);

        set({ activeTabId: instanceId });
      },

      setPluginStatus: (pluginId, status, error) => {
        set((state) => ({
          openTabs: state.openTabs.map((t) =>
            t.pluginId === pluginId ? { ...t, status, error } : t,
          ),
        }));
      },

      initialize: () => {
        const state = get();
        const corePlugins = Object.values(state.definitions)
          .filter((d) => d.kind === 'core')
          .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));

        let tabs = [...state.openTabs];
        const existingPluginIds = new Set(tabs.map((t) => t.pluginId));

        for (const def of corePlugins) {
          if (def.allowMultipleInstances) {
            // Multi-instance core nav plugins (AI): ensure at least one default
            // empty tab exists so the bottom bar always lands on them first.
            if (!existingPluginIds.has(def.id)) {
              tabs.push({
                id: createInstanceId(),
                pluginId: def.id,
                title: def.name,
                status: 'active',
              });
              existingPluginIds.add(def.id);
            }
            continue;
          }
          // Singleton core plugins: create a tab if none exists
          if (!existingPluginIds.has(def.id)) {
            tabs.push({
              id: createInstanceId(),
              pluginId: def.id,
              title: def.name,
              status: 'active',
            });
            existingPluginIds.add(def.id);
          }
        }

        // Remove tabs for plugins that no longer exist
        tabs = tabs.filter((t) => t.pluginId in state.definitions);

        // Prefer AI as the default active tab on first launch.
        // On subsequent launches, restore the persisted activeTabId.
        const aiTab = tabs.find((t) => {
          const def = state.definitions[t.pluginId];
          return def?.navOrder === 0;
        });
        const activeTabId = state.activeTabId && tabs.some((t) => t.id === state.activeTabId)
          ? state.activeTabId
          : (aiTab?.id ?? tabs[0]?.id ?? null);

        set({ openTabs: tabs, activeTabId, isReady: true });
      },

      getDefinition: (pluginId) => get().definitions[pluginId],

      getCorePlugins: () =>
        Object.values(get().definitions)
          .filter((d) => d.kind === 'core')
          .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99)),

      getExtraPlugins: () =>
        Object.values(get().definitions)
          .filter((d) => d.kind === 'extra')
          .sort((a, b) => a.name.localeCompare(b.name)),

      canCloseTab: (instanceId) => {
        const tab = get().openTabs.find((t) => t.id === instanceId);
        if (!tab) return false;
        const def = get().definitions[tab.pluginId];
        if (!def) return false;
        // Extra plugins: always closeable
        // Multi-instance core plugins: closeable
        // Singleton core plugins: not closeable
        return def.kind !== 'core' || (def.allowMultipleInstances ?? false);
      },
    }),
    {
      name: 'stavi-plugin-registry',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      // Only persist tab state, not definitions (those are registered at boot)
      partialize: (state) => ({
        openTabs: state.openTabs,
        activeTabId: state.activeTabId,
      }),
      migrate: (persistedState: unknown, fromVersion: number) => {
        if (!persistedState || typeof persistedState !== 'object') return persistedState;
        const s = persistedState as Record<string, unknown>;

        if (fromVersion < 2) {
          // Rename pluginId 'search' → 'workspace-search'.
          // Drop tabs whose pluginId will no longer be registered (guard against future renames).
          if (Array.isArray(s.openTabs)) {
            s.openTabs = s.openTabs.map((tab: any) => {
              if (tab?.pluginId === 'search') return { ...tab, pluginId: 'workspace-search' };
              return tab;
            });
          }
        }

        return s;
      },
    },
  ),
);
