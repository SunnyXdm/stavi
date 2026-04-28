// WHAT: Ref-counted per-server subscriptions for Processes, Ports, and Monitor plugins.
// WHY:  Multiple panels can be open simultaneously for the same serverId. Both increment
//       the count; the underlying WebSocket subscription tears down only when count hits 0.
// HOW:  Zustand runtime store (not persisted). subscribeProcesses/Ports/Monitor each
//       return an unsubscribe fn. First subscriber triggers the real WS subscription;
//       last unsubscriber tears it down.
// SEE:  apps/mobile/src/plugins/extra/processes/index.tsx, apps/mobile/src/stores/connection.ts

import { create } from 'zustand';
import { useConnectionStore } from './connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface ManagedProcess {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  status: 'running' | 'exited' | 'killed';
  startTime: number;
  output: string;
}

export interface PortEntry {
  port: string;
  pid: string;
  process: string;
  address: string;
}

export interface SystemStats {
  disk: { filesystem: string; size: string; used: string; avail: string; usePercent: string };
  memRaw: string;
}

interface ProcessesSlice {
  list: ManagedProcess[];
  subscribersCount: number;
  _unsub: (() => void) | null;
}

interface PortsSlice {
  list: PortEntry[];
  subscribersCount: number;
  _timer: ReturnType<typeof setInterval> | null;
}

interface MonitorSlice {
  stats: SystemStats | null;
  subscribersCount: number;
  _timer: ReturnType<typeof setInterval> | null;
}

interface PerServerPluginState {
  processes: ProcessesSlice;
  ports: PortsSlice;
  monitor: MonitorSlice;
}

interface ServerPluginsStoreState {
  byServer: Record<string, PerServerPluginState>;
}

interface ServerPluginsStoreActions {
  subscribeProcesses(serverId: string): () => void;
  subscribePorts(serverId: string): () => void;
  subscribeMonitor(serverId: string): () => void;
  getProcesses(serverId: string): ManagedProcess[];
  getPorts(serverId: string): PortEntry[];
  getMonitorStats(serverId: string): SystemStats | null;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

// Sentinels — frozen empty arrays returned by getProcesses/getPorts when no data.
// Reusing the same reference prevents new-array-per-snapshot in useSyncExternalStore.
const EMPTY_PROCESSES: ManagedProcess[] = Object.freeze([]) as unknown as ManagedProcess[];
const EMPTY_PORTS: PortEntry[] = Object.freeze([]) as unknown as PortEntry[];

function emptyServer(): PerServerPluginState {
  return {
    processes: { list: [], subscribersCount: 0, _unsub: null },
    ports: { list: [], subscribersCount: 0, _timer: null },
    monitor: { stats: null, subscribersCount: 0, _timer: null },
  };
}

function getClient(serverId: string) {
  return useConnectionStore.getState().getClientForServer(serverId);
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const useServerPluginsStore = create<ServerPluginsStoreState & ServerPluginsStoreActions>(
  (set, get) => ({
    byServer: {},

    subscribeProcesses: (serverId) => {
      set((state) => {
        const server = state.byServer[serverId] ?? emptyServer();
        const count = server.processes.subscribersCount + 1;
        let unsub = server.processes._unsub;

        if (count === 1) {
          // First subscriber — open the real WebSocket subscription
          const client = getClient(serverId);
          if (client) {
            unsub = client.subscribe(
              'subscribeProcessEvents',
              {},
              (event: unknown) => {
                const ev = event as { type: string; process?: ManagedProcess; id?: string; data?: string };
                set((s) => {
                  const srv = s.byServer[serverId];
                  if (!srv) return s;
                  let list = srv.processes.list;
                  if (ev.type === 'snapshot' && ev.process) {
                    const existing = list.find((p) => p.id === ev.process!.id);
                    list = existing
                      ? list.map((p) => (p.id === ev.process!.id ? { ...p, ...ev.process! } : p))
                      : [...list, ev.process!];
                  } else if (ev.type === 'started' && ev.process) {
                    list = [...list, ev.process];
                  } else if (ev.type === 'output' && ev.id) {
                    list = list.map((p) => p.id === ev.id ? { ...p, output: p.output + (ev.data ?? '') } : p);
                  } else if (ev.type === 'exited' && ev.id) {
                    list = list.map((p) => p.id === ev.id ? { ...p, status: 'exited' } : p);
                  } else if (ev.type === 'killed' && ev.id) {
                    list = list.filter((p) => p.id !== ev.id);
                  } else if (ev.type === 'outputCleared' && ev.id) {
                    list = list.map((p) => p.id === ev.id ? { ...p, output: '' } : p);
                  } else if (ev.type === 'removed' && ev.id) {
                    list = list.filter((p) => p.id !== ev.id);
                  }
                  return {
                    byServer: {
                      ...s.byServer,
                      [serverId]: { ...srv, processes: { ...srv.processes, list } },
                    },
                  };
                });
              },
              (err) => console.error('[ServerPluginsStore] processes error:', err),
            );
          }
        }

        return {
          byServer: {
            ...state.byServer,
            [serverId]: {
              ...(state.byServer[serverId] ?? emptyServer()),
              processes: {
                ...(state.byServer[serverId]?.processes ?? emptyServer().processes),
                subscribersCount: count,
                _unsub: unsub,
              },
            },
          },
        };
      });

      return () => {
        set((state) => {
          const server = state.byServer[serverId];
          if (!server) return state;
          const count = Math.max(0, server.processes.subscribersCount - 1);
          if (count === 0) {
            server.processes._unsub?.();
          }
          return {
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...server,
                processes: {
                  ...server.processes,
                  subscribersCount: count,
                  _unsub: count === 0 ? null : server.processes._unsub,
                  list: count === 0 ? [] : server.processes.list,
                },
              },
            },
          };
        });
      };
    },

    subscribePorts: (serverId) => {
      set((state) => {
        const server = state.byServer[serverId] ?? emptyServer();
        const count = server.ports.subscribersCount + 1;
        let timer = server.ports._timer;

        if (count === 1) {
          const fetchPorts = async () => {
            const client = getClient(serverId);
            if (!client) return;
            try {
              const result = await client.request<{ ports?: PortEntry[] }>('system.ports', {});
              set((s) => {
                const srv = s.byServer[serverId];
                if (!srv) return s;
                return {
                  byServer: {
                    ...s.byServer,
                    [serverId]: { ...srv, ports: { ...srv.ports, list: result.ports ?? [] } },
                  },
                };
              });
            } catch { /* network error, ignore */ }
          };
          void fetchPorts();
          timer = setInterval(() => void fetchPorts(), 10000);
        }

        return {
          byServer: {
            ...state.byServer,
            [serverId]: {
              ...(state.byServer[serverId] ?? emptyServer()),
              ports: {
                ...(state.byServer[serverId]?.ports ?? emptyServer().ports),
                subscribersCount: count,
                _timer: timer,
              },
            },
          },
        };
      });

      return () => {
        set((state) => {
          const server = state.byServer[serverId];
          if (!server) return state;
          const count = Math.max(0, server.ports.subscribersCount - 1);
          if (count === 0 && server.ports._timer) {
            clearInterval(server.ports._timer);
          }
          return {
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...server,
                ports: {
                  ...server.ports,
                  subscribersCount: count,
                  _timer: count === 0 ? null : server.ports._timer,
                  list: count === 0 ? [] : server.ports.list,
                },
              },
            },
          };
        });
      };
    },

    subscribeMonitor: (serverId) => {
      set((state) => {
        const server = state.byServer[serverId] ?? emptyServer();
        const count = server.monitor.subscribersCount + 1;
        let timer = server.monitor._timer;

        if (count === 1) {
          const fetchStats = async () => {
            const client = getClient(serverId);
            if (!client) return;
            try {
              const result = await client.request<SystemStats>('system.stats', {});
              set((s) => {
                const srv = s.byServer[serverId];
                if (!srv) return s;
                return {
                  byServer: {
                    ...s.byServer,
                    [serverId]: { ...srv, monitor: { ...srv.monitor, stats: result } },
                  },
                };
              });
            } catch { /* ignore */ }
          };
          void fetchStats();
          timer = setInterval(() => void fetchStats(), 10000);
        }

        return {
          byServer: {
            ...state.byServer,
            [serverId]: {
              ...(state.byServer[serverId] ?? emptyServer()),
              monitor: {
                ...(state.byServer[serverId]?.monitor ?? emptyServer().monitor),
                subscribersCount: count,
                _timer: timer,
              },
            },
          },
        };
      });

      return () => {
        set((state) => {
          const server = state.byServer[serverId];
          if (!server) return state;
          const count = Math.max(0, server.monitor.subscribersCount - 1);
          if (count === 0 && server.monitor._timer) {
            clearInterval(server.monitor._timer);
          }
          return {
            byServer: {
              ...state.byServer,
              [serverId]: {
                ...server,
                monitor: {
                  ...server.monitor,
                  subscribersCount: count,
                  _timer: count === 0 ? null : server.monitor._timer,
                  stats: count === 0 ? null : server.monitor.stats,
                },
              },
            },
          };
        });
      };
    },

    getProcesses: (serverId) => get().byServer[serverId]?.processes.list ?? EMPTY_PROCESSES,
    getPorts: (serverId) => get().byServer[serverId]?.ports.list ?? EMPTY_PORTS,
    getMonitorStats: (serverId) => get().byServer[serverId]?.monitor.stats ?? null,
  }),
);
