// ============================================================
// hooks/useGit.ts — All git state, subscriptions, and RPC calls
// ============================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Alert } from 'react-native';
import { staviClient } from '../../../../stores/stavi-client';
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

export function useGit(activeTab: TabId) {
  const connectionState = useConnectionStore((s) => s.state);
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
    if (connectionState !== 'connected') return;
    setStatus((prev) => ({ ...prev, loading: true }));

    unsubRef.current = staviClient.subscribe(
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
      (error) => {
        console.error('[Git] Subscription error:', error);
        setStatus((prev) => ({ ...prev, loading: false }));
      },
    );

    return () => { unsubRef.current?.(); unsubRef.current = null; };
  }, [connectionState]);

  // Load history/branches when tab changes
  useEffect(() => {
    if (connectionState !== 'connected') return;
    if (activeTab === 'history') {
      staviClient.request<{ commits: Commit[] }>('git.log', { limit: 50 })
        .then((r) => setCommits(r.commits || []))
        .catch(() => {});
    }
    if (activeTab === 'branches') {
      staviClient.request<{ branches: Branch[] }>('git.branches', {})
        .then((r) => setBranches(r.branches || []))
        .catch(() => {});
    }
  }, [activeTab, connectionState]);

  // -- Actions --

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try { await staviClient.request('git.refreshStatus', {}); } catch {}
    setRefreshing(false);
  }, []);

  const stage = useCallback(async (paths: string[]) => {
    setActionLoading(paths[0]);
    try { await staviClient.request('git.stage', { paths }); } catch (err) {
      console.error('[Git] Stage error:', err);
    }
    setActionLoading(null);
  }, []);

  const unstage = useCallback(async (paths: string[]) => {
    setActionLoading(paths[0]);
    try { await staviClient.request('git.unstage', { paths }); } catch (err) {
      console.error('[Git] Unstage error:', err);
    }
    setActionLoading(null);
  }, []);

  const discard = useCallback(async (paths: string[]) => {
    Alert.alert('Discard Changes', `Discard changes to ${paths.length} file(s)?`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Discard', style: 'destructive',
        onPress: async () => {
          setActionLoading(paths[0]);
          try { await staviClient.request('git.discard', { paths }); } catch (err) {
            console.error('[Git] Discard error:', err);
          }
          setActionLoading(null);
        },
      },
    ]);
  }, []);

  const commit = useCallback(async (message: string) => {
    await staviClient.request('git.commit', { message });
  }, []);

  const checkout = useCallback(async (branch: string) => {
    try {
      await staviClient.request('git.checkout', { branch });
      const r = await staviClient.request<{ branches: Branch[] }>('git.branches', {});
      setBranches(r.branches || []);
    } catch (err) {
      Alert.alert('Checkout failed', err instanceof Error ? err.message : 'Unknown error');
    }
  }, []);

  const push = useCallback(async () => {
    setActionLoading('push');
    try {
      await staviClient.request('git.push', {});
    } catch (err) {
      Alert.alert('Push failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, []);

  const pull = useCallback(async () => {
    setActionLoading('pull');
    try {
      await staviClient.request('git.pull', { rebase: true });
    } catch (err) {
      Alert.alert('Pull failed', err instanceof Error ? err.message : 'Unknown error');
    }
    setActionLoading(null);
  }, []);

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
