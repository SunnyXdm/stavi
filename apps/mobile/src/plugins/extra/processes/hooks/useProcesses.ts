// WHAT: Compatibility hook for process actions and snapshots.
// WHY:  Legacy process components still import this hook/type surface.
// HOW:  Reads process data from server-plugins-store and calls process RPC actions.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, apps/mobile/src/stores/connection.ts

import { useCallback, useMemo } from 'react';
import { useConnectionStore } from '../../../../stores/connection';
import { useServerPluginsStore } from '../../../../stores/server-plugins-store';

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

export function useProcesses(serverId?: string) {
  const resolvedServerId =
    serverId ?? useConnectionStore.getState().savedConnections[0]?.id ?? '';
  const connectionState = resolvedServerId
    ? useConnectionStore.getState().getStatusForServer(resolvedServerId)
    : 'disconnected';
  const processes = useServerPluginsStore((state) =>
    resolvedServerId ? state.getProcesses(resolvedServerId) : [],
  );

  const spawn = useCallback(
    async (command: string, path: string, args: string) => {
      const client = resolvedServerId
        ? useConnectionStore.getState().getClientForServer(resolvedServerId)
        : undefined;
      if (!client || client.getState() !== 'connected') return;
      await client.request('process.spawn', {
        command,
        cwd: path || '.',
        args: args ? args.split(/\s+/) : [],
      });
    },
    [resolvedServerId],
  );

  const kill = useCallback(
    async (id: string) => {
      const client = resolvedServerId
        ? useConnectionStore.getState().getClientForServer(resolvedServerId)
        : undefined;
      if (!client || client.getState() !== 'connected') return;
      await client.request('process.kill', { id });
    },
    [resolvedServerId],
  );

  const clearOutput = useCallback(
    async (id: string) => {
      const client = resolvedServerId
        ? useConnectionStore.getState().getClientForServer(resolvedServerId)
        : undefined;
      if (!client || client.getState() !== 'connected') return;
      await client.request('process.clearOutput', { id });
    },
    [resolvedServerId],
  );

  const remove = useCallback(
    async (id: string) => {
      const client = resolvedServerId
        ? useConnectionStore.getState().getClientForServer(resolvedServerId)
        : undefined;
      if (!client || client.getState() !== 'connected') return;
      await client.request('process.remove', { id });
    },
    [resolvedServerId],
  );

  const runningCount = useMemo(
    () => processes.filter((process) => process.status === 'running').length,
    [processes],
  );

  return {
    connectionState,
    processes,
    loading: false,
    runningCount,
    spawn,
    kill,
    clearOutput,
    remove,
  };
}
