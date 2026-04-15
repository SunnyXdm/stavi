// WHAT: Per-server sessions store for Sessions Home and workspace lookups.
// WHY:  Phase 2 needs Sessions grouped by server, live subscriptions per connection,
//       and session lookup by id without relying on a single active connection.
// HOW:  Zustand runtime state keyed by serverId. Uses getClientForServer(serverId)
//       to subscribe to session events and refresh via session.list.
// SEE:  apps/mobile/src/stores/connection.ts, apps/mobile/src/navigation/SessionsHomeScreen.tsx

import { create } from 'zustand';
import type { Session } from '@stavi/shared';
import { useConnectionStore } from './connection';
import { logEvent } from '../services/telemetry';

type SessionEvent =
  | { type: 'snapshot'; payload?: { sessions?: Session[] } }
  | { type: 'created'; session: Session }
  | { type: 'updated'; session: Session }
  | { type: 'archived'; session: Session }
  | { type: 'deleted'; session: Session };

interface SessionsStoreState {
  sessionsByServer: Record<string, Session[]>;
  sessionsById: Record<string, Session>;
  isLoadingByServer: Record<string, boolean>;
  errorByServer: Record<string, string | null>;
  unsubscribesByServer: Record<string, () => void>;
}

interface SessionsStoreActions {
  refreshForServer(serverId: string): Promise<void>;
  getSessionsForServer(serverId: string): Session[];
  getSession(sessionId: string): Session | undefined;
  startSubscription(serverId: string): () => void;
  clearServer(serverId: string): void;
  hydrateConnectedServers(): void;
}

function upsertSession(sessions: Session[], nextSession: Session): Session[] {
  const existing = sessions.find((session) => session.id === nextSession.id);
  if (!existing) {
    return [...sessions, nextSession].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }
  return sessions
    .map((session) => (session.id === nextSession.id ? nextSession : session))
    .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
}

export const useSessionsStore = create<SessionsStoreState & SessionsStoreActions>((set, get) => ({
  sessionsByServer: {},
  sessionsById: {},
  isLoadingByServer: {},
  errorByServer: {},
  unsubscribesByServer: {},

  refreshForServer: async (serverId) => {
    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client) {
      return;
    }

    set((state) => ({
      isLoadingByServer: { ...state.isLoadingByServer, [serverId]: true },
      errorByServer: { ...state.errorByServer, [serverId]: null },
    }));

    try {
      const result = await client.request<{ sessions?: Session[] }>('session.list', {});
      const normalized = (result.sessions ?? [])
        .map((s) => ({ ...s, serverId }))
        .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
      set((state) => {
        const nextByServer = { ...state.sessionsByServer, [serverId]: normalized };
        const nextById = { ...state.sessionsById };
        for (const s of normalized) nextById[s.id] = s;
        return {
          sessionsByServer: nextByServer,
          sessionsById: nextById,
          isLoadingByServer: { ...state.isLoadingByServer, [serverId]: false },
        };
      });
    } catch (err) {
      set((state) => ({
        isLoadingByServer: { ...state.isLoadingByServer, [serverId]: false },
        errorByServer: {
          ...state.errorByServer,
          [serverId]: err instanceof Error ? err.message : String(err),
        },
      }));
    }
  },

  getSessionsForServer: (serverId) => get().sessionsByServer[serverId] ?? [],

  getSession: (sessionId) => get().sessionsById[sessionId],

  startSubscription: (serverId) => {
    const existing = get().unsubscribesByServer[serverId];
    if (existing) {
      return existing;
    }

    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client) {
      return () => {};
    }

    void get().refreshForServer(serverId);

    const unsubscribe = client.subscribe(
      'subscribeSessions',
      {},
      (event: unknown) => {
        const typed = event as SessionEvent;
        if (typed.type === 'snapshot') {
          const normalized = (typed.payload?.sessions ?? [])
            .map((s) => ({ ...s, serverId }))
            .sort((a, b) => b.lastActiveAt - a.lastActiveAt);
          set((state) => {
            const nextByServer = { ...state.sessionsByServer, [serverId]: normalized };
            const nextById = { ...state.sessionsById };
            for (const s of normalized) nextById[s.id] = s;
            return {
              sessionsByServer: nextByServer,
              sessionsById: nextById,
              errorByServer: { ...state.errorByServer, [serverId]: null },
            };
          });
          return;
        }
        if (typed.type === 'created' || typed.type === 'updated' || typed.type === 'archived') {
          if (typed.type === 'created') {
            logEvent('session.created', { sessionId: typed.session.id, serverId, folder: typed.session.folder });
          }
          const normalized = { ...typed.session, serverId };
          set((state) => {
            const nextList = upsertSession(state.sessionsByServer[serverId] ?? [], normalized);
            return {
              sessionsByServer: { ...state.sessionsByServer, [serverId]: nextList },
              sessionsById: { ...state.sessionsById, [normalized.id]: normalized },
              errorByServer: { ...state.errorByServer, [serverId]: null },
            };
          });
          return;
        }
        if (typed.type === 'deleted') {
          set((state) => {
            const nextById = { ...state.sessionsById };
            delete nextById[typed.session.id];
            return {
              sessionsByServer: {
                ...state.sessionsByServer,
                [serverId]: (state.sessionsByServer[serverId] ?? []).filter(
                  (session) => session.id !== typed.session.id,
                ),
              },
              sessionsById: nextById,
            };
          });
        }
      },
      (error) => {
        set((state) => ({
          errorByServer: { ...state.errorByServer, [serverId]: error.message },
        }));
      },
    );

    set((state) => ({
      unsubscribesByServer: {
        ...state.unsubscribesByServer,
        [serverId]: unsubscribe,
      },
    }));

    return () => {
      unsubscribe();
      set((state) => {
        const next = { ...state.unsubscribesByServer };
        delete next[serverId];
        return { unsubscribesByServer: next };
      });
    };
  },

  clearServer: (serverId) => {
    get().unsubscribesByServer[serverId]?.();
    set((state) => {
      const nextUnsubs = { ...state.unsubscribesByServer };
      delete nextUnsubs[serverId];
      const nextSessions = { ...state.sessionsByServer };
      // Remove from sessionsById any sessions that belonged to this server.
      const nextById = { ...state.sessionsById };
      for (const s of state.sessionsByServer[serverId] ?? []) {
        delete nextById[s.id];
      }
      delete nextSessions[serverId];
      const nextLoading = { ...state.isLoadingByServer };
      delete nextLoading[serverId];
      const nextErrors = { ...state.errorByServer };
      delete nextErrors[serverId];
      return {
        sessionsByServer: nextSessions,
        sessionsById: nextById,
        isLoadingByServer: nextLoading,
        errorByServer: nextErrors,
        unsubscribesByServer: nextUnsubs,
      };
    });
  },

  hydrateConnectedServers: () => {
    const connectionStore = useConnectionStore.getState();
    for (const connection of connectionStore.savedConnections) {
      const status = connectionStore.getServerStatus(connection.id);
      if (status === 'connected' || status === 'connecting' || status === 'authenticating' || status === 'reconnecting') {
        get().startSubscription(connection.id);
      }
    }
  },
}));
