// WHAT: Plugin Registry — Zustand store for plugin lifecycle, now keyed per session.
// WHY:  Phase 2 introduces per-session tab state so switching sessions restores the
//       correct tab layout. Server-scoped plugins are rejected from the tab system.
// HOW:  openTabsBySession / activeTabIdBySession keyed by sessionId.
//       Version bumped to 3; old state is dropped (one-time tab reset).
// SEE:  apps/mobile/src/navigation/WorkspaceScreen.tsx, packages/shared/src/plugin-types.ts

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ComponentType } from 'react';
import type {
  PluginDefinition,
  PluginInstance,
  PluginStatus,
} from '@stavi/shared';

// ----------------------------------------------------------
// Component registry (module-level, not serialized)
// ----------------------------------------------------------

const componentRegistry = new Map<string, ComponentType<any>>();

export function getPluginComponent(pluginId: string): ComponentType<any> | undefined {
  return componentRegistry.get(pluginId) as ComponentType<any> | undefined;
}

// ----------------------------------------------------------
// Instance ID generator
// ----------------------------------------------------------

let instanceCounter = 0;

function createInstanceId(): string {
  return `tab_${Date.now()}_${++instanceCounter}`;
}

// ----------------------------------------------------------
// Store State
// ----------------------------------------------------------

interface PluginRegistryState {
  definitions: Record<string, PluginDefinition>;
  openTabsBySession: Record<string, PluginInstance[]>;
  activeTabIdBySession: Record<string, string | null>;
  isReady: boolean;
}

interface PluginRegistryActions {
  register(definition: PluginDefinition, component?: ComponentType<any>): void;
  unregister(pluginId: string): void;

  /** Open a tab for a workspace-scoped plugin in the given session. Returns instance id. */
  openTab(pluginId: string, initialState?: Record<string, unknown>, sessionId?: string): string;

  closeTab(instanceId: string, sessionId?: string): void;
  setActiveTab(instanceId: string, sessionId?: string): void;
  setPluginStatus(pluginId: string, status: PluginStatus, error?: string): void;

  /** Ensure default workspace plugins have tabs for a given session. */
  initialize(sessionId?: string): void;

  // Phase 3 per-session named methods
  /** Populate default workspace plugin tabs on first entry; restore prior state on subsequent entries. */
  initializeForSession(sessionId: string): void;
  openTabInSession(sessionId: string, pluginId: string, initialState?: Record<string, unknown>): string;
  closeTabInSession(sessionId: string, instanceId: string): void;
  setActiveTabInSession(sessionId: string, instanceId: string): void;

  getDefinition(pluginId: string): PluginDefinition | undefined;
  getCorePlugins(): PluginDefinition[];
  getExtraPlugins(): PluginDefinition[];
  canCloseTab(instanceId: string, sessionId?: string): boolean;

  // Per-session accessors
  getOpenTabs(sessionId?: string): PluginInstance[];
  getActiveTabId(sessionId?: string): string | null;
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

const DEFAULT_SESSION = '__workspace__';

export const usePluginRegistry = create<PluginRegistryState & PluginRegistryActions>()(
  persist(
    (set, get) => ({
      definitions: {},
      openTabsBySession: {},
      activeTabIdBySession: {},
      isReady: false,

      register: (definition, component) => {
        const comp = component ?? (definition as any).component;
        if (comp) {
          componentRegistry.set(definition.id, comp as ComponentType<any>);
        }
        set((state) => ({
          definitions: { ...state.definitions, [definition.id]: definition },
        }));
      },

      unregister: (pluginId) => {
        componentRegistry.delete(pluginId);
        set((state) => {
          const { [pluginId]: _, ...remaining } = state.definitions;
          const nextBySession: Record<string, PluginInstance[]> = {};
          const nextActiveById: Record<string, string | null> = {};
          for (const [sid, tabs] of Object.entries(state.openTabsBySession)) {
            const filtered = tabs.filter((t) => t.pluginId !== pluginId);
            nextBySession[sid] = filtered;
            const activeWasRemoved = state.activeTabIdBySession[sid] &&
              tabs.find((t) => t.id === state.activeTabIdBySession[sid])?.pluginId === pluginId;
            nextActiveById[sid] = activeWasRemoved
              ? (filtered[filtered.length - 1]?.id ?? null)
              : (state.activeTabIdBySession[sid] ?? null);
          }
          return {
            definitions: remaining,
            openTabsBySession: nextBySession,
            activeTabIdBySession: nextActiveById,
          };
        });
      },

      openTab: (pluginId, initialState, sessionId = DEFAULT_SESSION) => {
        const state = get();
        const definition = state.definitions[pluginId];
        if (!definition) {
          console.warn(`[PluginRegistry] Cannot open tab: plugin "${pluginId}" not registered`);
          return '';
        }
        // Server-scoped plugins cannot be opened as tabs
        if (definition.scope === 'server') {
          console.warn(`[PluginRegistry] Rejected openTab for server-scoped plugin "${pluginId}"`);
          return '';
        }

        const sessionTabs = state.openTabsBySession[sessionId] ?? [];

        if (!definition.allowMultipleInstances) {
          const existing = sessionTabs.find((t) => t.pluginId === pluginId);
          if (existing) {
            set((s) => ({
              activeTabIdBySession: { ...s.activeTabIdBySession, [sessionId]: existing.id },
            }));
            return existing.id;
          }
        }

        const instance: PluginInstance = {
          id: createInstanceId(),
          pluginId,
          title: definition.name,
          status: 'active',
          initialState,
        };

        set((s) => ({
          openTabsBySession: {
            ...s.openTabsBySession,
            [sessionId]: [...(s.openTabsBySession[sessionId] ?? []), instance],
          },
          activeTabIdBySession: { ...s.activeTabIdBySession, [sessionId]: instance.id },
        }));

        definition.onActivate?.(instance.id);
        return instance.id;
      },

      closeTab: (instanceId, sessionId = DEFAULT_SESSION) => {
        const state = get();
        const tabs = state.openTabsBySession[sessionId] ?? [];
        const tab = tabs.find((t) => t.id === instanceId);
        if (!tab) return;

        const definition = state.definitions[tab.pluginId];
        if (definition?.kind === 'core' && !definition.allowMultipleInstances) return;

        definition?.onDeactivate?.(instanceId);
        const newTabs = tabs.filter((t) => t.id !== instanceId);
        const currentActive = state.activeTabIdBySession[sessionId];
        const newActive = currentActive === instanceId
          ? (newTabs[newTabs.length - 1]?.id ?? null)
          : currentActive ?? null;

        set((s) => ({
          openTabsBySession: { ...s.openTabsBySession, [sessionId]: newTabs },
          activeTabIdBySession: { ...s.activeTabIdBySession, [sessionId]: newActive },
        }));
      },

      setActiveTab: (instanceId, sessionId = DEFAULT_SESSION) => {
        const state = get();
        const tabs = state.openTabsBySession[sessionId] ?? [];
        const nextTab = tabs.find((t) => t.id === instanceId);
        if (!nextTab) return;

        const currentActive = state.activeTabIdBySession[sessionId];
        const previousTab = currentActive ? tabs.find((t) => t.id === currentActive) : null;
        if (previousTab && previousTab.id !== instanceId) {
          state.definitions[previousTab.pluginId]?.onDeactivate?.(previousTab.id);
        }
        state.definitions[nextTab.pluginId]?.onActivate?.(instanceId);

        set((s) => ({
          activeTabIdBySession: { ...s.activeTabIdBySession, [sessionId]: instanceId },
        }));
      },

      setPluginStatus: (pluginId, status, error) => {
        set((state) => {
          const nextBySession: Record<string, PluginInstance[]> = {};
          for (const [sid, tabs] of Object.entries(state.openTabsBySession)) {
            nextBySession[sid] = tabs.map((t) =>
              t.pluginId === pluginId ? { ...t, status, error } : t,
            );
          }
          return { openTabsBySession: nextBySession };
        });
      },

      initialize: (sessionId = DEFAULT_SESSION) => {
        const state = get();
        const corePlugins = Object.values(state.definitions)
          .filter((d) => d.kind === 'core' && d.scope !== 'server')
          .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99));

        let tabs = [...(state.openTabsBySession[sessionId] ?? [])];
        const existingPluginIds = new Set(tabs.map((t) => t.pluginId));

        for (const def of corePlugins) {
          if (def.allowMultipleInstances) {
            if (!existingPluginIds.has(def.id)) {
              tabs.push({ id: createInstanceId(), pluginId: def.id, title: def.name, status: 'active' });
              existingPluginIds.add(def.id);
            }
            continue;
          }
          if (!existingPluginIds.has(def.id)) {
            tabs.push({ id: createInstanceId(), pluginId: def.id, title: def.name, status: 'active' });
            existingPluginIds.add(def.id);
          }
        }

        // Remove stale tabs (plugin no longer registered or is server-scoped)
        tabs = tabs.filter((t) => {
          const def = state.definitions[t.pluginId];
          return def && def.scope !== 'server';
        });

        const aiTab = tabs.find((t) => state.definitions[t.pluginId]?.navOrder === 0);
        const currentActive = state.activeTabIdBySession[sessionId];
        const activeTabId = (currentActive && tabs.some((t) => t.id === currentActive))
          ? currentActive
          : (aiTab?.id ?? tabs[0]?.id ?? null);

        set((s) => ({
          openTabsBySession: { ...s.openTabsBySession, [sessionId]: tabs },
          activeTabIdBySession: { ...s.activeTabIdBySession, [sessionId]: activeTabId },
          isReady: true,
        }));
      },

      // Phase 3 per-session named methods — delegate to existing methods with swapped arg order
      initializeForSession: (sessionId) => get().initialize(sessionId),
      openTabInSession: (sessionId, pluginId, initialState) => get().openTab(pluginId, initialState, sessionId),
      closeTabInSession: (sessionId, instanceId) => get().closeTab(instanceId, sessionId),
      setActiveTabInSession: (sessionId, instanceId) => get().setActiveTab(instanceId, sessionId),

      getDefinition: (pluginId) => get().definitions[pluginId],

      getCorePlugins: () =>
        Object.values(get().definitions)
          .filter((d) => d.kind === 'core')
          .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99)),

      getExtraPlugins: () =>
        Object.values(get().definitions)
          .filter((d) => d.kind === 'extra')
          .sort((a, b) => a.name.localeCompare(b.name)),

      canCloseTab: (instanceId, sessionId = DEFAULT_SESSION) => {
        const tab = (get().openTabsBySession[sessionId] ?? []).find((t) => t.id === instanceId);
        if (!tab) return false;
        const def = get().definitions[tab.pluginId];
        if (!def) return false;
        return def.kind !== 'core' || (def.allowMultipleInstances ?? false);
      },

      getOpenTabs: (sessionId = DEFAULT_SESSION) => get().openTabsBySession[sessionId] ?? [],

      getActiveTabId: (sessionId = DEFAULT_SESSION) => get().activeTabIdBySession[sessionId] ?? null,
    }),
    {
      name: 'stavi-plugin-registry',
      version: 3,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        openTabsBySession: state.openTabsBySession,
        activeTabIdBySession: state.activeTabIdBySession,
      }),
      migrate: (_persistedState: unknown, _fromVersion: number) => {
        // Version 3: drop all persisted tab state (one-time reset).
        // Users lose their tab layout once; Phase 3 re-initializes per session.
        return { openTabsBySession: {}, activeTabIdBySession: {} };
      },
    },
  ),
);
