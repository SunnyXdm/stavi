// WHAT: Left-edge file tree panel for the Editor plugin.
// WHY:  Browseable directory tree rooted at session.folder.
// HOW:  Uses fs.list RPC to lazily load children. Long-press → context menu
//       (FileTreeMenus.tsx). Tap a file → editor.openFile event.
// SEE:  FileTreeMenus.tsx, store.ts

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import {
  File,
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  Eye,
  EyeOff,
} from 'lucide-react-native';
import { useTheme, typography, spacing } from '../../../../theme';
import { useEditorStore } from '../store';
import { useConnectionStore } from '../../../../stores/connection';
import { eventBus } from '../../../../services/event-bus';
import type { Session } from '@stavi/shared';
import {
  FileContextMenu,
  RenameDialog,
  NewEntryDialog,
  type TreeEntry,
  type ContextMenuState,
  type FileTreeAction,
} from './FileTreeMenus';

// ----------------------------------------------------------
// Sentinels — stable references reused across renders to avoid
// useSyncExternalStore false-changed loops (new Set() per call = infinite re-render)
// ----------------------------------------------------------

const EMPTY_EXPANDED_DIRS = new Set<string>();
Object.freeze(EMPTY_EXPANDED_DIRS);

// ----------------------------------------------------------
// FileTree Component
// ----------------------------------------------------------

interface FileTreeProps {
  session: Session;
}

export const FileTree = React.memo(function FileTree({ session }: FileTreeProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.raised },
    header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3], paddingVertical: spacing[2], backgroundColor: colors.bg.overlay },
    headerTitle: { flex: 1, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.fg.tertiary, textTransform: 'uppercase', letterSpacing: 0.8 },
    headerActions: { flexDirection: 'row', gap: spacing[2] },
    headerBtn: { padding: spacing[1] },
    scroll: { flex: 1 },
    loadingRow: { padding: spacing[3], alignItems: 'center' as const },
    entryRow: { flexDirection: 'row', alignItems: 'center', height: 28, paddingRight: spacing[2] },
    entryPressed: { backgroundColor: colors.bg.active },
    chevron: { marginRight: spacing[1] },
    chevronSpacer: { width: 12 + spacing[1] },
    icon: { marginRight: spacing[2] },
    entryName: { flex: 1, fontSize: typography.fontSize.sm, color: colors.fg.secondary, fontFamily: typography.fontFamily.mono },
  }), [colors]);

  const { serverId, id: sessionId, folder } = session;

  const expandedDirs = useEditorStore(
    (s) => s.expandedDirsBySession[sessionId] ?? EMPTY_EXPANDED_DIRS,
  );
  const showHidden = useEditorStore((s) => s.showHiddenBySession[sessionId] ?? false);
  const { toggleExpanded, toggleShowHidden } = useEditorStore.getState();

  // Cache of loaded directory entries: path → entries[]
  const entriesCache = useRef<Map<string, TreeEntry[]>>(new Map());
  const [, forceUpdate] = useState(0);

  const getClient = useCallback(
    () => useConnectionStore.getState().getClientForServer(serverId),
    [serverId],
  );

  // -------------------------------------------------------
  // Load a directory's children
  // -------------------------------------------------------
  const loadDir = useCallback(
    async (dirPath: string, bustCache = false) => {
      if (!bustCache && entriesCache.current.has(dirPath)) return;

      try {
        const client = getClient();
        if (!client) return;

        const result = await client.request<{
          path: string;
          entries: Array<{ name: string; type: 'file' | 'directory'; size?: number }>;
        }>('fs.list', { path: dirPath, showHidden });

        const cleanDir = dirPath.replace(/\/$/, '');
        const entries: TreeEntry[] = (result?.entries ?? []).map((e) => ({
          name: e.name,
          type: e.type,
          path: `${cleanDir}/${e.name}`,
          size: e.size,
        }));

        entriesCache.current.set(dirPath, entries);
        forceUpdate((n) => n + 1);
      } catch (err) {
        console.warn('[FileTree] loadDir error', dirPath, err);
      }
    },
    [getClient, showHidden],
  );

  // Load root folder on mount
  useEffect(() => { void loadDir(folder); }, [folder, loadDir]);

  // Reload all cached dirs when showHidden changes
  useEffect(() => {
    entriesCache.current.clear();
    void loadDir(folder, true);
    for (const dir of expandedDirs) {
      void loadDir(dir, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden]);

  // -------------------------------------------------------
  // Handle tapping an entry
  // -------------------------------------------------------
  const handleTapEntry = useCallback(    (entry: TreeEntry) => {
      if (entry.type === 'directory') {
        toggleExpanded(sessionId, entry.path);
        if (!expandedDirs.has(entry.path)) {
          void loadDir(entry.path);
        }
      } else {
        eventBus.emit('editor.openFile', { sessionId, path: entry.path });
      }
    },
    [sessionId, expandedDirs, toggleExpanded, loadDir],
  );

  const handleRefresh = useCallback(() => {
    entriesCache.current.clear();
    void loadDir(folder, true);
    for (const dir of expandedDirs) { void loadDir(dir, true); }
  }, [folder, expandedDirs, loadDir]);

  // Context menu + dialog state
  const [ctxMenu, setCtxMenu] = useState<ContextMenuState>({ visible: false, entry: null });

  const [renameDialog, setRenameDialog] = useState<{
    visible: boolean;
    entry: TreeEntry | null;
  }>({ visible: false, entry: null });

  const [newDialog, setNewDialog] = useState<{
    visible: boolean;
    parentPath: string;
    type: 'file' | 'directory';
  }>({ visible: false, parentPath: '', type: 'file' });

  const handleAction = useCallback(
    (action: FileTreeAction) => {
      if (action.type === 'openInTerminal') {
        eventBus.emit('terminal.openHere', { sessionId, cwd: action.cwd });
      } else if (action.type === 'refreshDir') {
        entriesCache.current.delete(action.dirPath);
        void loadDir(action.dirPath, true);
      }
    },
    [sessionId, loadDir],
  );

  const handleDeleteEntry = useCallback(
    (entry: TreeEntry) => {
      Alert.alert(
        'Delete',
        `Delete "${entry.name}"?`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                const client = getClient();
                if (!client) return;
                await client.request('fs.delete', {
                  path: entry.path,
                  recursive: entry.type === 'directory',
                });
                const parentDir = entry.path.split('/').slice(0, -1).join('/');
                entriesCache.current.delete(parentDir);
                void loadDir(parentDir, true);
              } catch (err) {
                Alert.alert('Delete failed', err instanceof Error ? err.message : 'Unknown error');
              }
            },
          },
        ],
      );
    },
    [getClient, loadDir],
  );

  const handleConfirmRename = useCallback(
    async (newName: string) => {
      const entry = renameDialog.entry;
      setRenameDialog((s) => ({ ...s, visible: false }));
      if (!entry || !newName.trim()) return;

      const parentDir = entry.path.split('/').slice(0, -1).join('/');
      const newPath = `${parentDir}/${newName.trim()}`;
      try {
        const client = getClient();
        if (!client) return;
        await client.request('fs.rename', { from: entry.path, to: newPath });
        entriesCache.current.delete(parentDir);
        void loadDir(parentDir, true);
      } catch (err) {
        Alert.alert('Rename failed', err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [renameDialog.entry, getClient, loadDir],
  );

  const handleConfirmNew = useCallback(
    async (name: string) => {
      const { parentPath, type } = newDialog;
      setNewDialog((s) => ({ ...s, visible: false }));
      if (!name.trim()) return;

      const newPath = `${parentPath}/${name.trim()}`;
      try {
        const client = getClient();
        if (!client) return;
        await client.request('fs.create', { path: newPath, type });
        entriesCache.current.delete(parentPath);
        void loadDir(parentPath, true);
      } catch (err) {
        Alert.alert('Create failed', err instanceof Error ? err.message : 'Unknown error');
      }
    },
    [newDialog, getClient, loadDir],
  );

  // Recursive tree node renderer
  const renderEntries = useCallback(
    (dirPath: string, depth: number): React.ReactNode => {
      const entries = entriesCache.current.get(dirPath);

      if (!entries) {
        if (depth === 0) {
          return (
            <View style={styles.loadingRow}>
              <ActivityIndicator size="small" color={colors.accent.primary} />
            </View>
          );
        }
        return null;
      }

      return entries.map((entry) => {
        const isExpanded = expandedDirs.has(entry.path);
        const indent = depth * 12 + 8;
        const isDir = entry.type === 'directory';

        return (
          <React.Fragment key={entry.path}>
            <Pressable
              style={({ pressed }) => [
                styles.entryRow,
                pressed && styles.entryPressed,
                { paddingLeft: indent },
              ]}
              onPress={() => handleTapEntry(entry)}
              onLongPress={() => setCtxMenu({ visible: true, entry })}
            >
              {isDir ? (
                isExpanded ? (
                  <ChevronDown size={12} color={colors.fg.muted} style={styles.chevron} />
                ) : (
                  <ChevronRight size={12} color={colors.fg.muted} style={styles.chevron} />
                )
              ) : (
                <View style={styles.chevronSpacer} />
              )}
              {isDir ? (
                isExpanded ? (
                  <FolderOpen size={14} color={colors.accent.primary} style={styles.icon} />
                ) : (
                  <Folder size={14} color={colors.fg.tertiary} style={styles.icon} />
                )
              ) : (
                <File size={14} color={colors.fg.muted} style={styles.icon} />
              )}
              <Text style={styles.entryName} numberOfLines={1}>
                {entry.name}
              </Text>
            </Pressable>

            {isDir && isExpanded && renderEntries(entry.path, depth + 1)}
          </React.Fragment>
        );
      });
    },
    [expandedDirs, handleTapEntry, styles, colors],
  );

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (    <View style={styles.container}>
      {/* Tree header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {folder.split('/').filter(Boolean).pop() ?? folder}
        </Text>
        <View style={styles.headerActions}>
          <Pressable onPress={handleRefresh} hitSlop={8} style={styles.headerBtn}>
            <RefreshCw size={14} color={colors.fg.muted} />
          </Pressable>
          <Pressable onPress={() => toggleShowHidden(sessionId)} hitSlop={8} style={styles.headerBtn}>
            {showHidden ? (
              <Eye size={14} color={colors.accent.primary} />
            ) : (
              <EyeOff size={14} color={colors.fg.muted} />
            )}
          </Pressable>
        </View>
      </View>

      {/* Tree rows */}
      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
        {renderEntries(folder, 0)}
      </ScrollView>

      {/* Context menu modal */}
      <FileContextMenu
        ctxMenu={ctxMenu}
        onClose={() => setCtxMenu({ visible: false, entry: null })}
        onAction={handleAction}
        onStartRename={(entry) => setRenameDialog({ visible: true, entry })}
        onStartNew={(parentPath, type) => setNewDialog({ visible: true, parentPath, type })}
        onDelete={handleDeleteEntry}
      />

      {/* Rename dialog */}
      <RenameDialog
        visible={renameDialog.visible}
        initialValue={renameDialog.entry?.name ?? ''}
        onConfirm={handleConfirmRename}
        onCancel={() => setRenameDialog((s) => ({ ...s, visible: false }))}
      />

      {/* New entry dialog */}
      <NewEntryDialog
        visible={newDialog.visible}
        type={newDialog.type}
        onConfirm={handleConfirmNew}
        onCancel={() => setNewDialog((s) => ({ ...s, visible: false }))}
      />
    </View>
  );
});

// Styles computed dynamically via useMemo — see component body.
