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
import { prefetchServerInfo } from './connection-preflight';
import { RelayTransport } from '../transports/RelayTransport';
import { useSessionsStore } from './sessions-store';
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
  /** False until AsyncStorage rehydration finishes — gates the home empty state
   *  so we don't flash "add a server" before saved servers load. */
  hasHydrated: boolean;
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

// Concurrency guard: prevents double-connect race when autoConnect + hydrateConnected fire simultaneously.
const _connectingServers = new Map<string, Promise<void>>();

/**
 * Probe-race /health across the saved host + alternate LAN candidates from
 * pairing; first stavi server to answer wins. Falls back to the saved host
 * when nothing answers (so the real connect produces the actionable error).
 */
async function resolveReachableHost(conn: SavedConnection): Promise<string> {
  const candidates = [...new Set([conn.host, ...(conn.lanHosts ?? [])])].filter(Boolean);
  if (candidates.length <= 1) return conn.host;

  const protocol = conn.tls ? 'https' : 'http';
  const probe = async (host: string): Promise<string> => {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 1500);
    try {
      const res = await fetch(`${protocol}://${host}:${conn.port}/health`, { signal: abort.signal });
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body = (await res.json()) as { app?: string };
      // Positively identify a stavi server (older servers omit `app` — accept).
      if (body.app && body.app !== 'stavi') throw new Error('not a stavi server');
      return host;
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await Promise.any(candidates.map(probe));
  } catch {
    return conn.host;
  }
}

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
        hasHydrated: false,

        addServer: async (conn) => {
          // Pre-flight to learn remote serverId + hostname for dedup AND to
          // verify the server is actually reachable. Relay pairings skip the
          // LAN probe (their lanHost is usually unreachable off-LAN) — they're
          // validated when the relay transport connects instead.
          const preflight = conn.relayUrl
            ? { reachable: true, serverId: null, hostname: null, error: undefined }
            : await prefetchServerInfo(
                conn.host,
                conn.port,
                conn.bearerToken,
                conn.tls,
              );

          // Refuse to save a LAN server we couldn't reach — otherwise a typo or
          // an offline server silently becomes a dead entry. Throw the raw
          // error so the caller (Add Server form) can show WHY.
          if (!conn.relayUrl && !preflight.reachable) {
            throw preflight.error instanceof Error
              ? preflight.error
              : new Error('Network request failed');
          }

          const remoteServerId = preflight.serverId;
          const remoteHostname = preflight.hostname;

          if (remoteServerId) {
            // Check for existing saved connection with the same remote serverId
            // AND the same port. serverId comes from ~/.stavi/credentials.json,
            // which is shared by EVERY server instance on a machine — two
            // daemons on different ports report the same serverId. Matching on
            // serverId alone merged them, silently overwriting the older
            // server's address ("my servers disappeared"). Same port + same
            // serverId is the actual "same daemon, new hostname/IP" case.
            const existing = get().savedConnections.find(
              (c) => c.serverId === remoteServerId && c.port === conn.port,
            );

            if (existing) {
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
                hostname: remoteHostname ?? existing.hostname,
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
            // Default the display name to the server's hostname (then host:port)
            // when the user didn't type one — editable later via server actions.
            name: conn.name?.trim() || remoteHostname || `${conn.host}:${conn.port}`,
            id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: Date.now(),
            serverId: remoteServerId ?? undefined,
            hostname: remoteHostname ?? undefined,
          };
          set((state) => ({
            savedConnections: [...state.savedConnections, saved],
          }));
          ensureRuntimeConnection(saved);
          return saved;
        },

        connectServer: async (serverId) => {
          // Concurrency guard: if already connecting this server, await the existing attempt.
          const inflight = _connectingServers.get(serverId);
          if (inflight) return inflight;

          const promise = (async () => {
          const savedConnection = get().savedConnections.find((conn) => conn.id === serverId);
          if (!savedConnection) {
            throw new Error(`Unknown server: ${serverId}`);
          }

          const runtime = ensureRuntimeConnection(savedConnection);

          // Close any existing transport before creating a new one.
          // Prevents transport leak during relay reconnect or double-connect.
          runtime.client.disconnect();

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
              // Direct LAN mode: existing bearer→wsToken→WebSocket flow.
              // When pairing supplied alternate LAN addresses, probe-race
              // /health first — the server's primary interface pick can be
              // stale (DHCP renewal) or unroutable (VPN interface).
              const host = await resolveReachableHost(savedConnection);
              const config: StaviConnectionConfig = {
                host,
                port: savedConnection.port,
                bearerToken: savedConnection.bearerToken,
                tls: savedConnection.tls,
              };
              await runtime.client.connect(config);
              // Persist a host switch so the next connect goes straight there.
              if (host !== savedConnection.host) {
                set((state) => ({
                  savedConnections: state.savedConnections.map((c) =>
                    c.id === serverId ? { ...c, host } : c,
                  ),
                }));
              }
            }

            // Bind remote serverId + hostname after connect (best-effort).
            void runtime.client
              .request<{ serverId?: string; hostname?: string }>('server.getConfig', {}, 10000)
              .then((cfg) => {
                const updates: Partial<SavedConnection> = {};
                if (cfg.serverId && savedConnection.serverId !== cfg.serverId) updates.serverId = cfg.serverId;
                if (cfg.hostname && savedConnection.hostname !== cfg.hostname) updates.hostname = cfg.hostname;
                if (Object.keys(updates).length > 0) get().updateSavedConnection(serverId, updates);
              })
              .catch((err: unknown) => {
                console.warn('[connection] server.getConfig bind failed:', err);
              });

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
          })();

          _connectingServers.set(serverId, promise);
          try {
            await promise;
          } finally {
            _connectingServers.delete(serverId);
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
          // Clear sessions + subscriptions for this server.
          useSessionsStore.getState().clearServer(serverId);
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
          for (const c of get().savedConnections) {
            void get().connectServer(c.id).catch((err) => {
              console.warn(`[autoConnect] ${c.name ?? c.id} failed:`, err);
            });
          }
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
        // Runs after persisted state is restored. Mark hydrated so the home
        // screen can stop showing the loading/empty placeholder, and warm the
        // runtime client for each saved server.
        if (!state) {
          useConnectionStore.setState({ hasHydrated: true });
          return;
        }
        for (const connection of state.savedConnections) {
          state.getClientForServer(connection.id);
        }
        useConnectionStore.setState({ hasHydrated: true });
      },
    },
  ),
);

export type { StaviConnectionConfig } from './stavi-client';
