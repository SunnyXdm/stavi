// ============================================================
// hooks/useProcesses.ts — process subscription, state, and actions
// ============================================================

import { useState, useEffect, useCallback } from 'react';
import { Alert } from 'react-native';
import { staviClient } from '../../../../stores/stavi-client';
import { useConnectionStore } from '../../../../stores/connection';

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

export function useProcesses() {
  const connectionState = useConnectionStore((s) => s.state);
  const [processes, setProcesses] = useState<ManagedProcess[]>([]);
  const [loading, setLoading] = useState(false);

  // Subscribe to process events
  useEffect(() => {
    if (connectionState !== 'connected') return;

    const unsub = staviClient.subscribe(
      'subscribeProcessEvents',
      {},
      (event: any) => {
        if (event.type === 'snapshot') {
          setProcesses((prev) => {
            const existing = prev.find((p) => p.id === event.process.id);
            if (existing) return prev.map((p) => p.id === event.process.id ? { ...p, ...event.process } : p);
            return [...prev, event.process];
          });
        } else if (event.type === 'started') {
          setProcesses((prev) => [...prev, event.process]);
        } else if (event.type === 'output') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, output: p.output + event.data } : p),
          );
        } else if (event.type === 'exited') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, status: 'exited' } : p),
          );
        } else if (event.type === 'killed') {
          setProcesses((prev) => prev.filter((p) => p.id !== event.id));
        } else if (event.type === 'outputCleared') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, output: '' } : p),
          );
        } else if (event.type === 'removed') {
          setProcesses((prev) => prev.filter((p) => p.id !== event.id));
        }
      },
      (err) => console.error('[Processes] Subscription error:', err),
    );

    return unsub;
  }, [connectionState]);

  // Clear on disconnect
  useEffect(() => {
    if (connectionState !== 'connected') setProcesses([]);
  }, [connectionState]);

  const spawn = useCallback(async (command: string, path: string, args: string) => {
    if (staviClient.getState() !== 'connected') return;
    setLoading(true);
    try {
      await staviClient.request('process.spawn', {
        command,
        cwd: path || '.',
        args: args ? args.split(/\s+/) : [],
      });
    } catch (err: any) {
      Alert.alert('Spawn Failed', err?.message ?? 'Could not start process');
    } finally {
      setLoading(false);
    }
  }, []);

  const kill = useCallback(async (id: string) => {
    try {
      await staviClient.request('process.kill', { id });
    } catch (err: any) {
      Alert.alert('Kill Failed', err?.message ?? 'Could not kill process');
    }
  }, []);

  const clearOutput = useCallback(async (id: string) => {
    try { await staviClient.request('process.clearOutput', { id }); } catch { /* ignore */ }
  }, []);

  const remove = useCallback(async (id: string) => {
    try { await staviClient.request('process.remove', { id }); } catch { /* ignore */ }
  }, []);

  const runningCount = processes.filter((p) => p.status === 'running').length;

  return { connectionState, processes, loading, runningCount, spawn, kill, clearOutput, remove };
}
