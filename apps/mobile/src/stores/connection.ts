// ============================================================
// Connection Store — Stavi server connection management
// ============================================================
// Zustand store that wraps the StaviClient for state management.
// Handles saved connections (persisted to AsyncStorage) and
// exposes connect/disconnect for the UI layer.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createStaviClient,
  type StaviClient,
  type StaviClientState,
  type StaviConnectionConfig,
} from './stavi-client';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type ConnectionState =
  | 'idle'
  | 'authenticating'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'error'
  | 'disconnected';

export interface SavedConnection {
  id: string;
  name: string;
  host: string;
  port: number;
  bearerToken: string;
  tls?: boolean;
  createdAt: number;
  lastConnectedAt?: number;
}

export interface PerServerConnection {
  serverId: string;
  savedConnection: SavedConnection;
  clientState: ConnectionState;
  client: StaviClient;
  error: string | null;
}

interface ConnectionStoreState {
  savedConnections: SavedConnection[];
  connectionsById: Record<string, PerServerConnection>;
}

interface ConnectionStoreActions {
  addServer(conn: Omit<SavedConnection, 'id' | 'createdAt'>): SavedConnection;
  connectServer(serverId: string): Promise<void>;
  disconnectServer(serverId: string): void;
  getClientForServer(serverId: string): StaviClient | undefined;
  getStatusForServer(serverId: string): ConnectionState;
  getServerStatus(serverId: string): ConnectionState;
  forgetServer(serverId: string): void;
  updateSavedConnection(id: string, updates: Partial<Omit<SavedConnection, 'id'>>): void;
  autoConnectSavedServers(): void;
}

// ----------------------------------------------------------
// Map StaviClient states to our store states
// ----------------------------------------------------------

function mapClientState(clientState: StaviClientState): ConnectionState {
  switch (clientState) {
    case 'disconnected':
      return 'disconnected';
    case 'authenticating':
      return 'authenticating';
    case 'connecting':
      return 'connecting';
    case 'connected':
      return 'connected';
    case 'reconnecting':
      return 'reconnecting';
    default:
      return 'idle';
  }
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const useConnectionStore = create<ConnectionStoreState & ConnectionStoreActions>()(
  persist(
    (set, get) => {
      function ensureRuntimeConnection(savedConnection: SavedConnection): PerServerConnection {
        const existing = get().connectionsById[savedConnection.id];
        if (existing) {
          return existing;
        }

        const client = createStaviClient();
        const runtime: PerServerConnection = {
          serverId: savedConnection.id,
          savedConnection,
          clientState: 'idle',
          client,
          error: null,
        };

        client.onStateChange((clientState, errorMsg) => {
          set((state) => {
            const current = state.connectionsById[savedConnection.id];
            if (!current) {
              return state;
            }
            return {
              connectionsById: {
                ...state.connectionsById,
                [savedConnection.id]: {
                  ...current,
                  clientState: mapClientState(clientState),
                  error: errorMsg ?? null,
                },
              },
            };
          });
        });

        set((state) => ({
          connectionsById: {
            ...state.connectionsById,
            [savedConnection.id]: runtime,
          },
        }));

        return runtime;
      }

      return {
        savedConnections: [],
        connectionsById: {},

        addServer: (conn) => {
          const saved: SavedConnection = {
            ...conn,
            id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: Date.now(),
          };
          set((state) => ({
            savedConnections: [...state.savedConnections, saved],
          }));
          ensureRuntimeConnection(saved);
          return saved;
        },

        connectServer: async (serverId) => {
          const savedConnection = get().savedConnections.find((conn) => conn.id === serverId);
          if (!savedConnection) {
            throw new Error(`Unknown server: ${serverId}`);
          }

          const runtime = ensureRuntimeConnection(savedConnection);
          const config: StaviConnectionConfig = {
            host: savedConnection.host,
            port: savedConnection.port,
            bearerToken: savedConnection.bearerToken,
            tls: savedConnection.tls,
          };

          set((state) => ({
            connectionsById: {
              ...state.connectionsById,
              [serverId]: {
                ...runtime,
                savedConnection,
                clientState: 'authenticating',
                error: null,
              },
            },
          }));

          try {
            await runtime.client.connect(config);
            set((state) => ({
              savedConnections: state.savedConnections.map((conn) =>
                conn.id === serverId ? { ...conn, lastConnectedAt: Date.now() } : conn,
              ),
              connectionsById: {
                ...state.connectionsById,
                [serverId]: {
                  ...state.connectionsById[serverId],
                  savedConnection: {
                    ...savedConnection,
                    lastConnectedAt: Date.now(),
                  },
                },
              },
            }));
          } catch (err) {
            set((state) => ({
              connectionsById: {
                ...state.connectionsById,
                [serverId]: {
                  ...state.connectionsById[serverId],
                  clientState: 'error',
                  error: err instanceof Error ? err.message : String(err),
                },
              },
            }));
            throw err;
          }
        },

        disconnectServer: (serverId) => {
          const runtime = get().connectionsById[serverId];
          runtime?.client.disconnect();
          set((state) => ({
            connectionsById: {
              ...state.connectionsById,
              ...(runtime
                ? {
                    [serverId]: {
                      ...runtime,
                      clientState: 'disconnected',
                      error: null,
                    },
                  }
                : {}),
            },
          }));
        },

        getClientForServer: (serverId) => {
          const savedConnection = get().savedConnections.find((conn) => conn.id === serverId);
          if (!savedConnection) {
            return undefined;
          }
          return ensureRuntimeConnection(savedConnection).client;
        },

        getStatusForServer: (serverId) => {
          return get().connectionsById[serverId]?.clientState ?? 'idle';
        },

        // Backward-compatible alias used by existing call sites.
        getServerStatus: (serverId) => {
          return get().getStatusForServer(serverId);
        },

        forgetServer: (serverId) => {
          const runtime = get().connectionsById[serverId];
          runtime?.client.disconnect();
          set((state) => {
            const nextConnections = { ...state.connectionsById };
            delete nextConnections[serverId];
            return {
              savedConnections: state.savedConnections.filter((conn) => conn.id !== serverId),
              connectionsById: nextConnections,
            };
          });
        },

        updateSavedConnection: (id, updates) => {
          set((state) => ({
            savedConnections: state.savedConnections.map((conn) =>
              conn.id === id ? { ...conn, ...updates } : conn,
            ),
            connectionsById: state.connectionsById[id]
              ? {
                  ...state.connectionsById,
                  [id]: {
                    ...state.connectionsById[id],
                    savedConnection: {
                      ...state.connectionsById[id].savedConnection,
                      ...updates,
                    },
                  },
                }
              : state.connectionsById,
          }));
        },

        autoConnectSavedServers: () => {
          for (const connection of get().savedConnections) {
            void get().connectServer(connection.id).catch(() => {});
          }
        },
      };
    },
    {
      name: 'stavi-connection',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        savedConnections: state.savedConnections,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        for (const connection of state.savedConnections) {
          state.getClientForServer(connection.id);
        }
      },
    },
  ),
);

export type { StaviConnectionConfig } from './stavi-client';
