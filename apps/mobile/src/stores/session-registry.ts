// ============================================================
// Session Registry — cross-plugin session management
// ============================================================
// Plugins register their active sessions here so the drawer
// sidebar and PluginHeader can display per-tool instance tabs.
//
// Design: Zustand store with a simple register/unregister API.
// Each plugin reports its sessions, active session, and callbacks.

import { create } from 'zustand';
import type { SessionRegistration, SessionEntry } from '@stavi/shared';

// ----------------------------------------------------------
// Store State
// ----------------------------------------------------------

interface SessionRegistryState {
  /** Registered sessions per plugin ID */
  registrations: Record<string, SessionRegistration>;
}

interface SessionRegistryActions {
  /** Register (or update) sessions for a plugin */
  register(pluginId: string, registration: SessionRegistration): void;

  /** Unregister a plugin's sessions (on plugin unmount) */
  unregister(pluginId: string): void;

  /** Get registration for a specific plugin */
  getRegistration(pluginId: string): SessionRegistration | undefined;

  /** Get all registrations as an array of [pluginId, registration] */
  getAllRegistrations(): Array<[string, SessionRegistration]>;
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const useSessionRegistry = create<SessionRegistryState & SessionRegistryActions>()(
  (set, get) => ({
    registrations: {},

    register: (pluginId, registration) => {
      set((state) => ({
        registrations: {
          ...state.registrations,
          [pluginId]: registration,
        },
      }));
    },

    unregister: (pluginId) => {
      set((state) => {
        const { [pluginId]: _, ...remaining } = state.registrations;
        return { registrations: remaining };
      });
    },

    getRegistration: (pluginId) => {
      return get().registrations[pluginId];
    },

    getAllRegistrations: () => {
      return Object.entries(get().registrations);
    },
  }),
);
