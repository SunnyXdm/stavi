// ============================================================
// hooks/useGit.ts — All git state, subscriptions, and RPC calls
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { useConnectionStore } from '../../../../stores/connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface GitFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' | 'untracked' | 'unknown';
  staged: boolean;
}

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  files: GitFile[];
  loading: boolean;
}

export interface Commit {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface Branch {
  name: string;
  hash: string;
  upstream: string | null;
  current: boolean;
}

export type TabId = 'changes' | 'history' | 'branches';

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useGit(activeTab: TabId, serverId?: string) {
  const connectionState = serverId
    ? useConnectionStore.getState().getServerStatus(serverId)
    : 'disconnected';
  const client = serverId
    ? useConnectionStore.getState().getClientForServer(serverId)
    : undefined;
  const [status, setStatus] = useState<GitStatus>({
    branch: '', ahead: 0, behind: 0, files: [], loading: true,
  });
  const [refreshing, setRefreshing] = useState(false);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [commitSheetVisible, setCommitSheetVisible] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const unsubRef = useRef<(() => void) | null>(null);

  // Subscribe to git status
  useEffect(() => {
    if (connectionState !== 'connected' || !client) return;
    setStatus((prev) => ({ ...prev, loading: true }));

    unsubRef.current = client.subscribe(
      'subscribeGitStatus',
      {},
      (event: any) => {
        const files: GitFile[] = [];
        for (const file of event.staged ?? []) {
          files.push({ path: file.path || file, status: file.status || 'modified', staged: true });
        }
        for (const file of event.unstaged ?? []) {
          files.push({ path: file.path || file, status: file.status || 'modified', staged: false });
        }
        for (const file of event.untracked ?? []) {
          files.push({ path: typeof file === 'string' ? file : file.path, status: 'untracked', staged: false });
        }
        setStatus({
          branch: event.branch || '',
          ahead: event.ahead || 0,
          behind: event.behind || 0,
          files,
          loading: false,
        });
      },
      (error: Error) => {
        console.error('[Git] Subscription error:', error);
        setStatus((prev) => ({ ...prev, loading: false }));
      },
    );

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [connectionState]);

  // Load history/branches when tab changes
  useEffect(() => {
    if (connectionState !== 'connected' || !client) return;
    if (activeTab === 'history') {
      client.request<{ commits: Commit[] }>('git.log', { limit: 50 })
        .then((r: { commits: Commit[] }) => setCommits(r.commits || []))
        .catch(() => {});
    }
    if (activeTab === 'branches') {
      client.request<{ branches: Branch[] }>('git.branches', {})
        .then((r: { branches: Branch[] }) => setBranches(r.branches || []))
        .catch(() => {});
    }
  }, [activeTab, connectionState]);

  // -- Actions --

  const refresh = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try { await client.request('git.refreshStatus', {}); } catch {}
    setRefreshing(false);
  }, [client]);

  const stage = useCallback(async (paths: string[]) => {
    if (!client) return;
    setActionLoading(paths[0]);
    try { await client.request('git.stage', { paths }); } catch (err) {
      console.error('[Git] Stage error:', err);
    }
    setActionLoading(null);
  }, [client]);

  const unstage = useCallback(async (paths: string[]) => {
    if (!client) return;
    setActionLoading(paths[0]);
    try { await client.request('git.unstage', { paths }); } catch (err) {
      console.error('[Git] Unstage error:', err);
    }
    setActionLoading(null);
  }, [client]);

  const discard = useCallback(async (paths: string[]) => {
    if (!client) return;
    Alert.alert('Discard Changes', `Discard changes to ${paths.length} file(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard', style: 'destructive',
        onPress: async () => {
          setActionLoading(paths[0]);
          try { await client.request('git.discard', { paths }); } catch (err) {
            console.error('[Git] Discard error:', err);
          }
          setActionLoading(null);
        },
      },
    ]);
  }, [client]);

  const commit = useCallback(async (message: string) => {
    if (!client) return;
    await client.request('git.commit', { message });
  }, [client]);

  const checkout = useCallback(async (branch: string) => {
    if (!client) return;
    try {
      await client.request('git.checkout', { branch });
      const r = await client.request<{ branches: Branch[] }>('git.branches', {});
      setBranches(r.branches || []);
    } catch (err) {
      Alert.alert('Checkout failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, [client]);

  const push = useCallback(async () => {
    if (!client) return;
    setActionLoading('push');
    try {
      await client.request('git.push', {});
    } catch (err) {
      Alert.alert('Push failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, [client]);

  const pull = useCallback(async () => {
    if (!client) return;
    setActionLoading('pull');
    try {
      await client.request('git.pull', { rebase: true });
    } catch (err) {
      Alert.alert('Pull failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, [client]);

  // -- Derived state --

  const stagedFiles = useMemo(() => status.files.filter((f) => f.staged), [status.files]);
  const unstagedFiles = useMemo(
    () => status.files.filter((f) => !f.staged && f.status !== 'untracked'),
    [status.files],
  );
  const untrackedFiles = useMemo(
    () => status.files.filter((f) => f.status === 'untracked'),
    [status.files],
  );

  return {
    connectionState,
    status,
    refreshing,
    commits,
    branches,
    commitSheetVisible,
    setCommitSheetVisible,
    actionLoading,
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    refresh,
    stage,
    unstage,
    discard,
    commit,
    checkout,
    push,
    pull,
  };
}
