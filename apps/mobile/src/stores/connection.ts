// WHAT: Per-server connection store for all Stavi server connections.
// WHY:  Phase 5 adds serverId dedup on addServer, reconnect UX callbacks, and
//       imports SavedConnection from @stavi/shared (unified shape).
//       Phase 6 adds relay-transport path and relay reconnect (fresh handshake
//       on every drop — session state is NEVER reused across reconnects).
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
import { RelayTransport } from '../transports/RelayTransport';
import { logEvent } from '../services/telemetry';

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
// Relay reconnect state (module-level; not persisted)
// ----------------------------------------------------------
// Tracks per-server relay reconnect attempt counts and pending timers.
// INVARIANT: every relay reconnect MUST create a fresh RelayTransport and
// run a new Noise NK handshake. No session state is ever resumed.
// This map is cleared on successful connect and on intentional disconnect.
const _relayReconnectAttempts = new Map<string, number>();
const _relayReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

const MAX_RELAY_RECONNECT_ATTEMPTS = 7;

function scheduleRelayReconnect(serverId: string, connectServer: (id: string) => Promise<void>): void {
  // Cancel any pending timer for this server.
  const existing = _relayReconnectTimers.get(serverId);
  if (existing) clearTimeout(existing);

  const attempts = _relayReconnectAttempts.get(serverId) ?? 0;
  if (attempts >= MAX_RELAY_RECONNECT_ATTEMPTS) {
    console.warn(`[relay reconnect] Max attempts (${MAX_RELAY_RECONNECT_ATTEMPTS}) reached for ${serverId}`);
    _relayReconnectAttempts.delete(serverId);
    return;
  }

  // Same exponential backoff as StaviClient._scheduleReconnect: 1s * 2^n, cap 64s.
  const delay = Math.min(1000 * Math.pow(2, attempts), 64000);
  _relayReconnectAttempts.set(serverId, attempts + 1);

  console.log(`[relay reconnect] Scheduling reconnect for ${serverId} in ${delay}ms (attempt ${attempts + 1}/${MAX_RELAY_RECONNECT_ATTEMPTS})`);

  const timer = setTimeout(() => {
    _relayReconnectTimers.delete(serverId);
    // connectServer creates a NEW RelayTransport → NEW Noise NK handshake.
    // REQUIREMENT (master plan): every reconnect MUST renegotiate keys.
    // Do NOT cache or resume any prior NoiseSession here.
    void connectServer(serverId).catch((err: unknown) => {
      console.warn(`[relay reconnect] connectServer failed for ${serverId}:`, err);
    });
  }, delay);

  _relayReconnectTimers.set(serverId, timer);
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
            if (!current) return state;

            const mapped = mapClientState(clientState);

            // Fire reconnect listeners when transitioning from reconnecting → connected.
            const wasReconnecting = state._wasConnectedById[savedConnection.id];
            if (wasReconnecting && mapped === 'connected') {
              logEvent('server.reconnected', { serverId: savedConnection.id, name: savedConnection.name });
              for (const listener of _reconnectListeners) {
                try {
                  listener(savedConnection.id);
                } catch {}
              }
            }

            // Relay reconnect: when the transport drops unexpectedly (state →
            // 'reconnecting'), schedule a new connectServer call that creates a
            // FRESH RelayTransport and runs a NEW Noise NK handshake.
            // REQUIREMENT: session state is NEVER reused across reconnects.
            // Only fire for relay connections (relayUrl present); LAN reconnect
            // is owned by StaviClient._scheduleReconnect internally.
            if (
              mapped === 'reconnecting' &&
              savedConnection.relayUrl
            ) {
              scheduleRelayReconnect(savedConnection.id, (id) => get().connectServer(id));
            }

            // Clear relay reconnect counter once successfully connected.
            if (mapped === 'connected') {
              if (!wasReconnecting) {
                logEvent('server.connected', { serverId: savedConnection.id, name: savedConnection.name });
              }
              _relayReconnectAttempts.delete(savedConnection.id);
              const t = _relayReconnectTimers.get(savedConnection.id);
              if (t) { clearTimeout(t); _relayReconnectTimers.delete(savedConnection.id); }
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
            if (savedConnection.relayUrl && savedConnection.serverPublicKey && savedConnection.roomId) {
              // Tunnel mode: use RelayTransport (Noise NK E2E encrypted)
              const transport = new RelayTransport({
                relayUrl: savedConnection.relayUrl,
                roomId: savedConnection.roomId,
                serverPublicKey: savedConnection.serverPublicKey,
                bearerToken: savedConnection.bearerToken,
              });
              await transport.connect();
              await runtime.client.connectViaTransport(transport);
            } else {
              // Direct LAN mode: existing bearer→wsToken→WebSocket flow
              const config: StaviConnectionConfig = {
                host: savedConnection.host,
                port: savedConnection.port,
                bearerToken: savedConnection.bearerToken,
                tls: savedConnection.tls,
              };
              await runtime.client.connect(config);
            }

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
          // Cancel any pending relay reconnect — intentional disconnect must not re-trigger.
          const relayTimer = _relayReconnectTimers.get(serverId);
          if (relayTimer) { clearTimeout(relayTimer); _relayReconnectTimers.delete(serverId); }
          _relayReconnectAttempts.delete(serverId);

          const runtime = get().connectionsById[serverId];
          runtime?.client.disconnect();
          const name = get().savedConnections.find((c) => c.id === serverId)?.name;
          logEvent('server.disconnected', { serverId, name });
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
          // Cancel any pending relay reconnect.
          const relayTimer = _relayReconnectTimers.get(serverId);
          if (relayTimer) { clearTimeout(relayTimer); _relayReconnectTimers.delete(serverId); }
          _relayReconnectAttempts.delete(serverId);

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
