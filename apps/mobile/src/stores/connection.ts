// ============================================================
// Connection Store — Stavi server connection management
// ============================================================
// Zustand store that wraps the StaviClient for state management.
// Handles saved connections (persisted to AsyncStorage) and
// exposes connect/disconnect for the UI layer.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { staviClient, type StaviClientState, type StaviConnectionConfig } from './stavi-client';

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

interface ConnectionStoreState {
  /** Current connection state */
  state: ConnectionState;

  /** Active connection config */
  activeConnection: SavedConnection | null;

  /** Saved connections (persisted) */
  savedConnections: SavedConnection[];

  /** Error message if state is 'error' */
  error: string | null;
}

interface ConnectionStoreActions {
  /** Connect to a Stavi server */
  connect(connection: SavedConnection): Promise<void>;

  /** Disconnect */
  disconnect(): void;

  /** Save a new connection */
  saveConnection(conn: Omit<SavedConnection, 'id' | 'createdAt'>): SavedConnection;

  /** Update a saved connection */
  updateSavedConnection(id: string, updates: Partial<Omit<SavedConnection, 'id'>>): void;

  /** Remove a saved connection */
  removeSavedConnection(id: string): void;
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
      // Listen to StaviClient state changes and sync to Zustand
      staviClient.onStateChange((clientState, errorMsg) => {
        const mapped = mapClientState(clientState);
        set({
          state: mapped,
          error: errorMsg ?? null,
        });
      });

      return {
        // --- State ---
        state: 'idle' as ConnectionState,
        activeConnection: null,
        savedConnections: [],
        error: null,

        // --- Actions ---

        connect: async (connection) => {
          set({
            state: 'authenticating',
            activeConnection: connection,
            error: null,
          });

          try {
            const config: StaviConnectionConfig = {
              host: connection.host,
              port: connection.port,
              bearerToken: connection.bearerToken,
              tls: connection.tls,
            };

            await staviClient.connect(config);

            // Update lastConnectedAt
            set((s) => ({
              savedConnections: s.savedConnections.map((c) =>
                c.id === connection.id
                  ? { ...c, lastConnectedAt: Date.now() }
                  : c,
              ),
            }));
          } catch (err) {
            set({
              state: 'error',
              error: err instanceof Error ? err.message : String(err),
            });
            throw err;
          }
        },

        disconnect: () => {
          staviClient.disconnect();
          set({
            state: 'disconnected',
            activeConnection: null,
            error: null,
          });
        },

        saveConnection: (conn) => {
          const saved: SavedConnection = {
            ...conn,
            id: `conn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            createdAt: Date.now(),
          };
          set((s) => ({
            savedConnections: [...s.savedConnections, saved],
          }));
          return saved;
        },

        updateSavedConnection: (id, updates) => {
          set((s) => ({
            savedConnections: s.savedConnections.map((c) =>
              c.id === id ? { ...c, ...updates } : c,
            ),
          }));
        },

        removeSavedConnection: (id) => {
          set((s) => ({
            savedConnections: s.savedConnections.filter((c) => c.id !== id),
          }));
        },
      };
    },
    {
      name: 'stavi-connection',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (state) => ({
        savedConnections: state.savedConnections,
      }),
    },
  ),
);

// ----------------------------------------------------------
// Re-export staviClient for direct RPC access
// ----------------------------------------------------------

export { staviClient } from './stavi-client';
export type { StaviConnectionConfig } from './stavi-client';
