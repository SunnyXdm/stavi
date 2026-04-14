// WHAT: Per-server connection store for all Stavi server connections.
// WHY:  Phase 5 adds serverId dedup on addServer, reconnect UX callbacks, and
//       imports SavedConnection from @stavi/shared (unified shape).
// HOW:  Zustand + AsyncStorage. StaviClient per server; addServer pre-flights
//       server.getConfig for serverId dedup (1s→64s backoff per StaviClient).
// SEE:  stores/stavi-client.ts, stores/connection-preflight.ts, @stavi/shared

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedConnection } from '@stavi/shared';
import {
  createStaviClient,
  type StaviClient,
  type StaviClientState,
  type StaviConnectionConfig,
} from './stavi-client';
import { prefetchServerId } from './connection-preflight';

// Re-export for consumers that import SavedConnection from this file.
export type { SavedConnection } from '@stavi/shared';

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

export interface PerServerConnection {
  serverId: string; // local saved-connection id
  savedConnection: SavedConnection;
  clientState: ConnectionState;
  client: StaviClient;
  error: string | null;
}

/** Listener fired when a server reconnects after a drop. */
export type ReconnectListener = (serverId: string) => void;

interface ConnectionStoreState {
  savedConnections: SavedConnection[];
  connectionsById: Record<string, PerServerConnection>;
  _wasConnectedById: Record<string, boolean>;
}

interface ConnectionStoreActions {
  // addServer: pre-flights server.getConfig for serverId dedup.
  // addServer pre-flights server.getConfig. Same-serverId, different-address → merge.
  // Same-serverId, same-address → throws "already added".
  addServer(conn: Omit<SavedConnection, 'id' | 'createdAt'>): Promise<SavedConnection>;
  connectServer(serverId: string): Promise<void>;
  disconnectServer(serverId: string): void;
  getClientForServer(serverId: string): StaviClient | undefined;
  getStatusForServer(serverId: string): ConnectionState;
  getServerStatus(serverId: string): ConnectionState;
  forgetServer(serverId: string): void;
  updateSavedConnection(id: string, updates: Partial<Omit<SavedConnection, 'id'>>): void;
  autoConnectSavedServers(): void;
  onReconnect(listener: ReconnectListener): () => void;
}

// ----------------------------------------------------------
// Map StaviClient states to connection store states
// ----------------------------------------------------------
function mapClientState(s: StaviClientState): ConnectionState {
  if (s === 'disconnected') return 'disconnected';
  if (s === 'authenticating') return 'authenticating';
  if (s === 'connecting') return 'connecting';
  if (s === 'connected') return 'connected';
  if (s === 'reconnecting') return 'reconnecting';
  return 'idle';
}

// ----------------------------------------------------------
// Reconnect listeners (module-level; not persisted)
// ----------------------------------------------------------
const _reconnectListeners = new Set<ReconnectListener>();
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
            if (!current) return state;

            const mapped = mapClientState(clientState);

            // Fire reconnect listeners when transitioning from reconnecting → connected.
            const wasReconnecting = state._wasConnectedById[savedConnection.id];
            if (wasReconnecting && mapped === 'connected') {
              for (const listener of _reconnectListeners) {
                try {
                  listener(savedConnection.id);
                } catch {}
              }
            }

            return {
              connectionsById: {
                ...state.connectionsById,
                [savedConnection.id]: {
                  ...current,
                  clientState: mapped,
                  error: errorMsg ?? null,
                },
              },
              _wasConnectedById: {
                ...state._wasConnectedById,
                // Mark as "was connected" once we first reach connected state
                [savedConnection.id]:
                  mapped === 'connected'
                    ? true
                    : mapped === 'disconnected' || mapped === 'idle'
                    ? false
                    : state._wasConnectedById[savedConnection.id] ?? false,
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
        _wasConnectedById: {},

        addServer: async (conn) => {
          // Phase 5: Pre-flight to learn remote serverId for dedup.
          const remoteServerId = await prefetchServerId(
            conn.host,
            conn.port,
            conn.bearerToken,
            conn.tls,
          );

          if (remoteServerId) {
            // Check for existing saved connection with the same remote serverId.
            const existing = get().savedConnections.find(
              (c) => c.serverId === remoteServerId,
            );

            if (existing) {
              // Dedup-merge: If the user is adding a different address for the same
              // daemon, keep the newer entry and transfer lastConnectedAt.
              // (Example: user adds 192.168.1.5:8022 then macbook.local:8022 — same daemon.)
              // Update the existing entry with the new address (host/port) and reset
              // the runtime client so next connect uses the new address.
              const isSameAddress =
                existing.host === conn.host && existing.port === conn.port;

              if (isSameAddress) {
                // Exact duplicate — reject.
                throw new Error(
                  `Server already added (serverId: ${remoteServerId}). Use "Edit" to update the address.`,
                );
              }

              // Different address, same server: merge — update address, keep history.
              const merged: SavedConnection = {
                ...existing,
                host: conn.host,
                port: conn.port,
                bearerToken: conn.bearerToken,
                tls: conn.tls,
                name: conn.name || existing.name,
              };

              set((state) => ({
                savedConnections: state.savedConnections.map((c) =>
                  c.id === existing.id ? merged : c,
                ),
                connectionsById: state.connectionsById[existing.id]
                  ? {
                      ...state.connectionsById,
                      [existing.id]: {
                        ...state.connectionsById[existing.id],
                        savedConnection: merged,
                      },
                    }
                  : state.connectionsById,
              }));

              return merged;
            }
          }

          const saved: SavedConnection = {
            ...conn,
            id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: Date.now(),
            serverId: remoteServerId ?? undefined,
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

            // Bind remote serverId after connect (best-effort).
            void runtime.client
              .request<{ serverId?: string }>('server.getConfig', {}, 10000)
              .then((cfg) => {
                if (cfg.serverId && savedConnection.serverId !== cfg.serverId) {
                  get().updateSavedConnection(serverId, { serverId: cfg.serverId });
                }
              })
              .catch(() => {});

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
            _wasConnectedById: {
              ...state._wasConnectedById,
              [serverId]: false,
            },
          }));
        },

        getClientForServer: (serverId) => {
          const savedConnection = get().savedConnections.find((conn) => conn.id === serverId);
          if (!savedConnection) return undefined;
          return ensureRuntimeConnection(savedConnection).client;
        },

        getStatusForServer: (serverId) =>
          get().connectionsById[serverId]?.clientState ?? 'idle',

        // Backward-compatible alias.
        getServerStatus: (serverId) => get().getStatusForServer(serverId),

        forgetServer: (serverId) => {
          const runtime = get().connectionsById[serverId];
          runtime?.client.disconnect();
          set((state) => {
            const nextConnections = { ...state.connectionsById };
            delete nextConnections[serverId];
            const nextWas = { ...state._wasConnectedById };
            delete nextWas[serverId];
            return {
              savedConnections: state.savedConnections.filter((conn) => conn.id !== serverId),
              connectionsById: nextConnections,
              _wasConnectedById: nextWas,
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
          for (const c of get().savedConnections) void get().connectServer(c.id).catch(() => {});
        },

        onReconnect: (listener) => {
          _reconnectListeners.add(listener);
          return () => { _reconnectListeners.delete(listener); };
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
