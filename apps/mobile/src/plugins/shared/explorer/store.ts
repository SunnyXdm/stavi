// WHAT: Zustand store for the Explorer plugin — file browser state per session.
// WHY:  Multi-select and batch-ops state must survive navigation within a session
//       but NOT be persisted across restarts (per Phase 7c spec: selection is
//       component-local in intent, but per-session so navigating between sessions
//       doesn't bleed state). Zustand without persist satisfies both constraints.
// HOW:  Each state bucket is keyed by sessionId. `navigate` fetches a new listing
//       via fs.list RPC. `refresh` re-fetches the current cwd. Selection methods
//       mutate the Set in place (Zustand handles immutability at the slice level).
// SEE:  apps/mobile/src/plugins/shared/explorer/index.tsx (consumer),
//       packages/server-core/src/handlers/fs-batch.ts (fs.stat, fs.batchDelete…),
//       packages/server-core/src/handlers/fs.ts (fs.list)

import { create } from 'zustand';
import { useConnectionStore } from '../../../stores/connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface FsEntry {
  name: string;
  path: string;       // absolute path on server
  type: 'file' | 'directory';
  size?: number;
}

export interface ExplorerStore {
  cwdBySession: Record<string, string>;
  entriesBySession: Record<string, FsEntry[]>;
  selectionBySession: Record<string, Set<string>>;      // set of absolute paths
  isSelectingBySession: Record<string, boolean>;
  sortByBySession: Record<string, 'name' | 'modified' | 'size'>;
  showHiddenBySession: Record<string, boolean>;
  loadingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;

  // Navigation — fetches fs.list for the given absolute path and sets cwd
  navigate(sessionId: string, serverId: string, path: string): Promise<void>;
  // Refresh — re-fetches the current cwd
  refresh(sessionId: string, serverId: string): Promise<void>;
  // Selection
  toggleSelection(sessionId: string, path: string): void;
  selectAll(sessionId: string): void;
  clearSelection(sessionId: string): void;
  enterSelectionMode(sessionId: string): void;
  exitSelectionMode(sessionId: string): void;
  // Sort / view
  setSortBy(sessionId: string, sort: 'name' | 'modified' | 'size'): void;
  toggleShowHidden(sessionId: string): void;
  // Initialise a session's state if not already present
  ensureSession(sessionId: string, initialCwd: string): void;
}

// ----------------------------------------------------------
// Store
// ----------------------------------------------------------

export const useExplorerStore = create<ExplorerStore>((set, get) => ({
  cwdBySession: {},
  entriesBySession: {},
  selectionBySession: {},
  isSelectingBySession: {},
  sortByBySession: {},
  showHiddenBySession: {},
  loadingBySession: {},
  errorBySession: {},

  ensureSession(sessionId, initialCwd) {
    const state = get();
    if (state.cwdBySession[sessionId] !== undefined) return;
    set((s) => ({
      cwdBySession: { ...s.cwdBySession, [sessionId]: initialCwd },
      entriesBySession: { ...s.entriesBySession, [sessionId]: [] },
      selectionBySession: { ...s.selectionBySession, [sessionId]: new Set() },
      isSelectingBySession: { ...s.isSelectingBySession, [sessionId]: false },
      sortByBySession: { ...s.sortByBySession, [sessionId]: 'name' },
      showHiddenBySession: { ...s.showHiddenBySession, [sessionId]: false },
      loadingBySession: { ...s.loadingBySession, [sessionId]: false },
      errorBySession: { ...s.errorBySession, [sessionId]: null },
    }));
  },

  async navigate(sessionId, serverId, path) {
    set((s) => ({
      loadingBySession: { ...s.loadingBySession, [sessionId]: true },
      errorBySession: { ...s.errorBySession, [sessionId]: null },
    }));

    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client) {
      set((s) => ({
        loadingBySession: { ...s.loadingBySession, [sessionId]: false },
        errorBySession: { ...s.errorBySession, [sessionId]: 'Server not connected' },
      }));
      return;
    }

    try {
      const showHidden = get().showHiddenBySession[sessionId] ?? false;
      const result = await client.request<{
        path: string;
        entries: Array<{ name: string; type: string; size?: number }>;
      }>('fs.list', { path, showHidden });

      const entries: FsEntry[] = (result.entries ?? []).map((e) => ({
        name: e.name,
        path: `${path}/${e.name}`.replace(/\/\/+/g, '/'),
        type: e.type === 'directory' ? 'directory' : 'file',
        size: e.size,
      }));

      const sortBy = get().sortByBySession[sessionId] ?? 'name';
      const sorted = sortEntries(entries, sortBy);

      set((s) => ({
        cwdBySession: { ...s.cwdBySession, [sessionId]: path },
        entriesBySession: { ...s.entriesBySession, [sessionId]: sorted },
        loadingBySession: { ...s.loadingBySession, [sessionId]: false },
        // Clear selection on navigation (per spec: selection is not preserved)
        selectionBySession: { ...s.selectionBySession, [sessionId]: new Set() },
        isSelectingBySession: { ...s.isSelectingBySession, [sessionId]: false },
      }));
    } catch (err) {
      set((s) => ({
        loadingBySession: { ...s.loadingBySession, [sessionId]: false },
        errorBySession: {
          ...s.errorBySession,
          [sessionId]: err instanceof Error ? err.message : 'Failed to list directory',
        },
      }));
    }
  },

  async refresh(sessionId, serverId) {
    const cwd = get().cwdBySession[sessionId];
    if (!cwd) return;
    await get().navigate(sessionId, serverId, cwd);
  },

  toggleSelection(sessionId, path) {
    set((s) => {
      const prev = s.selectionBySession[sessionId] ?? new Set<string>();
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return { selectionBySession: { ...s.selectionBySession, [sessionId]: next } };
    });
  },

  selectAll(sessionId) {
    const entries = get().entriesBySession[sessionId] ?? [];
    const allPaths = new Set(entries.map((e) => e.path));
    set((s) => ({
      selectionBySession: { ...s.selectionBySession, [sessionId]: allPaths },
    }));
  },

  clearSelection(sessionId) {
    set((s) => ({
      selectionBySession: { ...s.selectionBySession, [sessionId]: new Set() },
    }));
  },

  enterSelectionMode(sessionId) {
    set((s) => ({
      isSelectingBySession: { ...s.isSelectingBySession, [sessionId]: true },
    }));
  },

  exitSelectionMode(sessionId) {
    set((s) => ({
      isSelectingBySession: { ...s.isSelectingBySession, [sessionId]: false },
      selectionBySession: { ...s.selectionBySession, [sessionId]: new Set() },
    }));
  },

  setSortBy(sessionId, sort) {
    const entries = get().entriesBySession[sessionId] ?? [];
    const sorted = sortEntries(entries, sort);
    set((s) => ({
      sortByBySession: { ...s.sortByBySession, [sessionId]: sort },
      entriesBySession: { ...s.entriesBySession, [sessionId]: sorted },
    }));
  },

  toggleShowHidden(sessionId) {
    set((s) => ({
      showHiddenBySession: {
        ...s.showHiddenBySession,
        [sessionId]: !(s.showHiddenBySession[sessionId] ?? false),
      },
    }));
  },
}));

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function sortEntries(entries: FsEntry[], sort: 'name' | 'modified' | 'size'): FsEntry[] {
  const dirs = entries.filter((e) => e.type === 'directory');
  const files = entries.filter((e) => e.type === 'file');

  const comparator = (a: FsEntry, b: FsEntry): number => {
    if (sort === 'size') {
      return (b.size ?? 0) - (a.size ?? 0);
    }
    // 'name' and 'modified' both fall back to name for now (mtime not in FsEntry)
    return a.name.localeCompare(b.name);
  };

  return [...dirs.sort(comparator), ...files.sort(comparator)];
}
