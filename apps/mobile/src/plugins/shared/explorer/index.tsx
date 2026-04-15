// WHAT: Explorer plugin — bulk file manager for a workspace session.
// WHY:  Replaces the Phase 0 stub with a full-featured file browser: breadcrumb
//       navigation, multi-select, batch delete/move/copy/zip, metadata view,
//       and integration with Editor and Terminal plugins via the event bus.
// HOW:  Composes BreadcrumbBar + ExplorerToolbar (conditional) + ExplorerList.
//       State lives in useExplorerStore (per-session, not persisted).
//       Batch operations stream progress chunks from the server — each chunk
//       updates a local progress counter shown as "N / total".
//       scope: 'workspace' — needs session.folder as the root.
//       Uses only tokens from theme/tokens.ts — zero hardcoded values.
// SEE:  apps/mobile/src/plugins/shared/explorer/store.ts,
//       apps/mobile/src/plugins/shared/explorer/components/,
//       packages/server-core/src/handlers/fs-batch.ts,
//       docs/PROTOCOL.md §5.5

import React, { useEffect, useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { FolderTree, SortAsc, Eye, FolderOpen } from 'lucide-react-native';
import type { WorkspacePluginDefinition, WorkspacePluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useExplorerStore } from './store';
import { eventBus } from '../../../services/event-bus';
import { BreadcrumbBar } from './components/BreadcrumbBar';
import { ExplorerList } from './components/ExplorerList';
import { ExplorerToolbar } from './components/ExplorerToolbar';
import { EntryMetaSheet } from './components/EntryMetaSheet';
import { DestinationPicker } from './components/DestinationPicker';
import { colors, typography, spacing } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { logEvent } from '../../../services/telemetry';
import { ErrorView, LoadingView, EmptyView } from '../../../components/StateViews';

// ----------------------------------------------------------
// Panel
// ----------------------------------------------------------

function ExplorerPanel({ session, instanceId }: WorkspacePluginPanelProps) {
  const { serverId, id: sessionId, folder: sessionFolder, title: sessionTitle } = session;

  // Store slices
  const cwd = useExplorerStore((s) => s.cwdBySession[sessionId] ?? sessionFolder);
  const entries = useExplorerStore((s) => s.entriesBySession[sessionId] ?? []);
  const selection = useExplorerStore((s) => s.selectionBySession[sessionId] ?? new Set<string>());
  const isSelecting = useExplorerStore((s) => s.isSelectingBySession[sessionId] ?? false);
  const loading = useExplorerStore((s) => s.loadingBySession[sessionId] ?? false);
  const error = useExplorerStore((s) => s.errorBySession[sessionId] ?? null);
  const {
    ensureSession, navigate, refresh, toggleSelection,
    enterSelectionMode, exitSelectionMode,
    setSortBy, toggleShowHidden, clearSelection,
  } = useExplorerStore.getState();

  // Local modal state
  const [metaPath, setMetaPath] = useState<string | null>(null);
  const [destPicker, setDestPicker] = useState<{ action: 'move' | 'copy' } | null>(null);
  const [progressText, setProgressText] = useState<string | null>(null);

  const client = useConnectionStore.getState().getClientForServer(serverId);

  // Initialise on mount
  useEffect(() => {
    ensureSession(sessionId, sessionFolder);
    navigate(sessionId, serverId, sessionFolder);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, sessionFolder, serverId]);

  // Navigation
  const handleNavigate = useCallback((path: string) => {
    navigate(sessionId, serverId, path);
  }, [sessionId, serverId, navigate]);

  const handleRefresh = useCallback(() => {
    refresh(sessionId, serverId);
  }, [sessionId, serverId, refresh]);

  // Selection
  const handleLongPress = useCallback((path: string) => {
    enterSelectionMode(sessionId);
    toggleSelection(sessionId, path);
  }, [sessionId, enterSelectionMode, toggleSelection]);

  const handleToggleSelect = useCallback((path: string) => {
    toggleSelection(sessionId, path);
    // Auto-exit selection mode when all items are deselected
    if (selection.size === 1 && selection.has(path)) {
      exitSelectionMode(sessionId);
    }
  }, [sessionId, toggleSelection, exitSelectionMode, selection]);

  // Batch delete
  const handleDelete = useCallback(() => {
    const paths = Array.from(selection);
    Alert.alert(
      'Delete items',
      `Permanently delete ${paths.length} item${paths.length === 1 ? '' : 's'}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            if (!client) return;
            exitSelectionMode(sessionId);
            logEvent('explorer.batchOperation', { op: 'delete', count: paths.length, sessionId });
            setProgressText('Deleting 0 / ' + paths.length);
            let done = 0;
            try {
              await client.subscribeAsync('fs.batchDelete', { paths }, (chunk: unknown) => {
                const c = chunk as { type: string; index?: number; total?: number };
                if (c.type === 'progress') {
                  done = c.index ?? done + 1;
                  setProgressText(`Deleting ${done} / ${paths.length}`);
                }
              });
            } catch { /* errors already displayed via chunk */ }
            setProgressText(null);
            refresh(sessionId, serverId);
          },
        },
      ],
    );
  }, [selection, client, sessionId, exitSelectionMode, refresh, serverId]);

  // Batch move
  const handleMoveConfirm = useCallback(async (destination: string) => {
    setDestPicker(null);
    const paths = Array.from(selection);
    exitSelectionMode(sessionId);
    if (!client) return;
    logEvent('explorer.batchOperation', { op: 'move', count: paths.length, sessionId });
    setProgressText('Moving 0 / ' + paths.length);
    let done = 0;
    try {
      await client.subscribeAsync('fs.batchMove', { paths, destination }, (chunk: unknown) => {
        const c = chunk as { type: string; index?: number };
        if (c.type === 'progress') {
          done = c.index ?? done + 1;
          setProgressText(`Moving ${done} / ${paths.length}`);
        }
      });
    } catch { /* errors already displayed via chunk */ }
    setProgressText(null);
    refresh(sessionId, serverId);
  }, [selection, client, sessionId, exitSelectionMode, refresh, serverId]);

  // Batch copy
  const handleCopyConfirm = useCallback(async (destination: string) => {
    setDestPicker(null);
    const paths = Array.from(selection);
    exitSelectionMode(sessionId);
    if (!client) return;
    logEvent('explorer.batchOperation', { op: 'copy', count: paths.length, sessionId });
    setProgressText('Copying 0 / ' + paths.length);
    let done = 0;
    try {
      await client.subscribeAsync('fs.batchCopy', { paths, destination }, (chunk: unknown) => {
        const c = chunk as { type: string; index?: number };
        if (c.type === 'progress') {
          done = c.index ?? done + 1;
          setProgressText(`Copying ${done} / ${paths.length}`);
        }
      });
    } catch { /* errors already displayed via chunk */ }
    setProgressText(null);
    refresh(sessionId, serverId);
  }, [selection, client, sessionId, exitSelectionMode, refresh, serverId]);

  // Zip selected items (auto-name in cwd)
  const handleZip = useCallback(async () => {
    const paths = Array.from(selection);
    const timestamp = Date.now();
    const destination = `${cwd}/archive-${timestamp}.zip`;
    exitSelectionMode(sessionId);
    if (!client) return;
    logEvent('explorer.batchOperation', { op: 'zip', count: paths.length, sessionId });
    setProgressText('Zipping...');
    try {
      await client.subscribeAsync('fs.zip', { paths, destination }, (chunk: unknown) => {
        const c = chunk as { type: string; path?: string };
        if (c.type === 'progress' && c.path) {
          setProgressText(`Zipping: ${c.path}`);
        }
      });
    } catch { /* errors via chunk */ }
    setProgressText(null);
    refresh(sessionId, serverId);
  }, [selection, cwd, client, sessionId, exitSelectionMode, refresh, serverId]);

  // Open-in-Editor: emit event for each selected file
  const handleOpenInEditor = useCallback(() => {
    for (const path of selection) {
      const entry = entries.find((e) => e.path === path);
      if (entry?.type === 'file') {
        eventBus.emit('editor.openFile', { sessionId, path });
      }
    }
    exitSelectionMode(sessionId);
  }, [selection, entries, sessionId, exitSelectionMode]);

  // Open-in-Terminal: emit event for selected directory (or cwd if multiple)
  const handleOpenInTerminal = useCallback(() => {
    const paths = Array.from(selection);
    const firstDir = entries.find(
      (e) => paths.includes(e.path) && e.type === 'directory',
    );
    const cwd2 = firstDir?.path ?? cwd;
    eventBus.emit('terminal.openHere', { sessionId, cwd: cwd2 });
    exitSelectionMode(sessionId);
  }, [selection, entries, cwd, sessionId, exitSelectionMode]);

  // Error state
  if (error && !loading) {
    const isPermission = /permission|denied|EACCES/i.test(error);
    const isNotFound = /not found|ENOENT|no such/i.test(error);
    return (
      <ErrorView
        title={isPermission ? 'Permission denied' : isNotFound ? 'Path not found' : 'Failed to load directory'}
        message={error}
        onRetry={handleRefresh}
      />
    );
  }

  return (
    <View style={styles.container}>
      {/* Breadcrumb navigation */}
      <BreadcrumbBar
        cwd={cwd}
        sessionFolder={sessionFolder}
        sessionTitle={sessionTitle}
        onNavigate={handleNavigate}
      />

      {/* Header row: sort + show/hide hidden */}
      <View style={styles.headerRow}>
        <Pressable style={styles.headerBtn} onPress={() => setSortBy(sessionId, 'name')}>
          <SortAsc size={14} color={colors.fg.muted} />
          <Text style={styles.headerBtnText}>Sort</Text>
        </Pressable>
        <Pressable style={styles.headerBtn} onPress={() => toggleShowHidden(sessionId)}>
          <Eye size={14} color={colors.fg.muted} />
          <Text style={styles.headerBtnText}>Hidden</Text>
        </Pressable>
      </View>

      {/* Toolbar (appears when selection > 0) */}
      {isSelecting && selection.size > 0 && (
        <ExplorerToolbar
          selectionCount={selection.size}
          onDelete={handleDelete}
          onMove={() => setDestPicker({ action: 'move' })}
          onCopy={() => setDestPicker({ action: 'copy' })}
          onZip={handleZip}
          onInfo={() => {
            const first = Array.from(selection)[0];
            if (first) setMetaPath(first);
          }}
          onOpenInTerminal={handleOpenInTerminal}
          onOpenInEditor={handleOpenInEditor}
          onClearSelection={() => exitSelectionMode(sessionId)}
        />
      )}

      {/* Progress overlay */}
      {progressText && (
        <View style={styles.progressBanner}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
          <Text style={styles.progressText}>{progressText}</Text>
        </View>
      )}

      {/* Loading state */}
      {loading && entries.length === 0 ? (
        <LoadingView message="Loading files..." />
      ) : entries.length === 0 ? (
        <EmptyView
          icon={FolderOpen}
          title="This folder is empty"
          subtitle="No files or folders found in this directory"
        />
      ) : (
        <ExplorerList
          sessionId={sessionId}
          entries={entries}
          selection={selection}
          isSelecting={isSelecting}
          onNavigate={handleNavigate}
          onLongPress={handleLongPress}
          onToggleSelect={handleToggleSelect}
          onRefresh={handleRefresh}
          refreshing={loading}
        />
      )}

      {/* Entry metadata sheet */}
      <EntryMetaSheet
        visible={!!metaPath}
        path={metaPath ?? ''}
        serverId={serverId}
        onClose={() => setMetaPath(null)}
      />

      {/* Destination picker for move/copy */}
      {destPicker && (
        <DestinationPicker
          visible
          serverId={serverId}
          sessionFolder={sessionFolder}
          actionLabel={destPicker.action === 'move' ? 'Move here' : 'Copy here'}
          onSelect={destPicker.action === 'move' ? handleMoveConfirm : handleCopyConfirm}
          onClose={() => setDestPicker(null)}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin definition
// ----------------------------------------------------------

export const explorerPlugin: WorkspacePluginDefinition = {
  id: 'explorer',
  name: 'Explorer',
  description: 'Browse and manage project files',
  scope: 'workspace',
  kind: 'extra',
  icon: FolderTree,
  component: ExplorerPanel,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dividerSubtle,
    backgroundColor: colors.bg.base,
  },
  headerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[1],
  },
  headerBtnText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  progressBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.accent.subtle,
  },
  progressText: {
    fontSize: typography.fontSize.xs,
    color: colors.accent.primary,
    fontFamily: typography.fontFamily.mono,
  },
});
