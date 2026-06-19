// WHAT: DirectoryPicker — Full-screen folder browser for selecting workspace directories.
// WHY:  Used during Session creation to pick the project folder.
// HOW:  Navigable directory tree via the server's fs.list RPC. Full-screen bottom sheet
//       with breadcrumb header, quick-pick chips for subdirs, and "Use this folder" CTA.
// SEE:  apps/mobile/src/components/NewSessionFlow.tsx
//
// IMPORTANT: The ONLY caller of this component is NewSessionFlow.tsx.

import React, { memo, useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Modal,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import {
  Folder,
  ChevronRight,
  FolderOpen,
  ArrowLeft,
  Check,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';
import { useConnectionStore } from '../stores/connection';
import { AnimatedPressable } from './AnimatedPressable';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface DirEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
}

interface ListDirsResult {
  /** Absolute path that was listed */
  path: string;
  /** The server user's home directory (browse root) */
  home: string;
  /** Absolute parent path, or null at the home root */
  parent: string | null;
  entries: DirEntry[];
}

export interface DirectoryPickerProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  serverId: string;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

/** "/Users/sunny/projects/x" with home "/Users/sunny" → ["projects","x"] */
function homeRelativeSegments(absPath: string, home: string): string[] {
  if (!home || absPath === home) return [];
  const rel = absPath.startsWith(home) ? absPath.slice(home.length) : absPath;
  return rel.split(/[\\/]/).filter(Boolean);
}

/** Re-join home + segments[0..i] into an absolute path (server-side separators). */
function buildAbsPath(home: string, segments: string[]): string {
  if (segments.length === 0) return home;
  const sep = home.includes('\\') ? '\\' : '/';
  return home + sep + segments.join(sep);
}

/** Display helper: substitute the server home with "~". */
function tildify(absPath: string, home: string): string {
  if (!home) return absPath;
  if (absPath === home) return '~';
  return absPath.startsWith(home) ? `~${absPath.slice(home.length)}` : absPath;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ----------------------------------------------------------
// Sub-components
// ----------------------------------------------------------

const BreadcrumbBar = memo(function BreadcrumbBar({
  currentPath,
  home,
  onNavigate,
}: {
  currentPath: string;
  home: string;
  onNavigate: (path: string) => void;
}) {
  const { colors } = useTheme();
  const segments = homeRelativeSegments(currentPath, home);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // ScrollView defaults to flexGrow:1 — without this the breadcrumb bar
      // stretches to fill the sheet, pushing the folder list to the bottom.
      style={breadStyles.bar}
      contentContainerStyle={breadStyles.container}
    >
      <Pressable style={breadStyles.segment} onPress={() => onNavigate('~')} hitSlop={6}>
        <FolderOpen size={14} color={colors.accent.primary} />
        <Text style={[breadStyles.seg, { color: segments.length === 0 ? colors.fg.primary : colors.fg.secondary }]}>~</Text>
      </Pressable>

      {segments.map((seg, i) => (
        <View key={i} style={breadStyles.segment}>
          <Text style={[breadStyles.sep, { color: colors.fg.muted }]}>/</Text>
          <Pressable onPress={() => onNavigate(buildAbsPath(home, segments.slice(0, i + 1)))} hitSlop={6}>
            <Text
              style={[
                breadStyles.seg,
                { color: i === segments.length - 1 ? colors.fg.primary : colors.fg.secondary },
                i === segments.length - 1 && breadStyles.segActive,
              ]}
            >
              {seg}
            </Text>
          </Pressable>
        </View>
      ))}
    </ScrollView>
  );
});

const breadStyles = StyleSheet.create({
  bar: { flexGrow: 0 },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: 4,
  },
  segment: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  sep: { fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono },
  seg: { fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono },
  segActive: { fontFamily: typography.fontFamily.monoMedium },
});

const EntryRow = memo(function EntryRow({
  entry,
  onPress,
}: {
  entry: DirEntry;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  const isDir = entry.type === 'directory';

  return (
    <Pressable
      style={({ pressed }) => [
        rowStyles.row,
        !isDir && rowStyles.rowFile,
        pressed && isDir && { backgroundColor: colors.bg.overlay },
      ]}
      onPress={isDir ? onPress : undefined}
      disabled={!isDir}
    >
      {isDir ? (
        <Folder size={18} color={colors.accent.primary} />
      ) : (
        <Folder size={18} color={colors.fg.muted} style={{ opacity: 0.4 }} />
      )}
      <Text
        style={[rowStyles.name, { color: isDir ? colors.fg.primary : colors.fg.muted }]}
        numberOfLines={1}
      >
        {entry.name}
      </Text>
      {!isDir && entry.size !== undefined && (
        <Text style={[rowStyles.meta, { color: colors.fg.muted }]}>{formatSize(entry.size)}</Text>
      )}
      {isDir && <ChevronRight size={16} color={colors.fg.muted} />}
    </Pressable>
  );
});

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
    minHeight: 48,
  },
  rowFile: { opacity: 0.45 },
  name: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.mono,
  },
  meta: { fontSize: typography.fontSize.xs },
});

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const DirectoryPicker = memo(function DirectoryPicker({
  visible,
  onClose,
  onSelect,
  initialPath = '~',
  serverId,
}: DirectoryPickerProps) {
  const { colors } = useTheme();
  const getClientForServer = useConnectionStore((state) => state.getClientForServer);
  const insets = useSafeAreaInsets();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [homePath, setHomePath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirs = useMemo(() => entries.filter((e) => e.type === 'directory'), [entries]);
  const canGoBack = parentPath !== null;

  // Browses the server user's HOME (fs.listDirs), not the workspace root —
  // pick any project on the machine, cross-platform.
  const fetchEntries = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const client = getClientForServer(serverId);
      if (!client) throw new Error('Server is not connected');
      const result = await client.request<ListDirsResult>('fs.listDirs', { path });
      setEntries(result.entries);
      setCurrentPath(result.path);
      setHomePath(result.home);
      setParentPath(result.parent);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to list directory');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [getClientForServer, serverId]);

  useEffect(() => {
    if (visible) fetchEntries(initialPath);
  }, [visible, initialPath, fetchEntries]);

  const handleNavigate = useCallback((path: string) => {
    fetchEntries(path);
  }, [fetchEntries]);

  const handleEntryPress = useCallback((entry: DirEntry) => {
    if (entry.type === 'directory') {
      const sep = currentPath.includes('\\') ? '\\' : '/';
      fetchEntries(`${currentPath}${sep}${entry.name}`);
    }
  }, [currentPath, fetchEntries]);

  const handleGoBack = useCallback(() => {
    if (parentPath) fetchEntries(parentPath);
  }, [parentPath, fetchEntries]);

  const handleSelect = useCallback(() => {
    onSelect(currentPath);
    onClose();
  }, [currentPath, onSelect, onClose]);

  const renderEntry = useCallback(({ item }: { item: DirEntry }) => (
    <EntryRow entry={item} onPress={() => handleEntryPress(item)} />
  ), [handleEntryPress]);

  const keyExtractor = useCallback((item: DirEntry) => item.name, []);

  const styles = useMemo(() => StyleSheet.create({
    modal: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'flex-end' },
    sheet: {
      flex: 1,
      backgroundColor: colors.bg.base,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
      marginTop: insets.top + 8,
      overflow: 'hidden',
    },
    handle: {
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.fg.muted,
      opacity: 0.4,
      alignSelf: 'center',
      marginTop: spacing[2],
      marginBottom: spacing[1],
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingBottom: spacing[2],
      gap: spacing[3],
    },
    backButton: { padding: 4 },
    headerTitle: {
      flex: 1,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider },
    centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
    errorText: {
      fontSize: typography.fontSize.sm,
      color: colors.semantic.error,
      textAlign: 'center',
      paddingHorizontal: spacing[4],
    },
    emptyText: { fontSize: typography.fontSize.sm, color: colors.fg.muted },
    emptySubtext: { fontSize: typography.fontSize.xs, color: colors.fg.muted, opacity: 0.7 },
    list: { flex: 1 },
    separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginHorizontal: spacing[4] },
    footer: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[3],
      paddingBottom: Math.max(insets.bottom, spacing[4]),
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      gap: spacing[2],
    },
    selectButton: {
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      paddingVertical: spacing[3] + 2,
      alignItems: 'center',
      flexDirection: 'row',
      justifyContent: 'center',
      gap: spacing[2],
    },
    selectButtonText: {
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.onAccent,
    },
    pathPreview: {
      fontSize: typography.fontSize.xs,
      fontFamily: typography.fontFamily.mono,
      color: colors.fg.muted,
      textAlign: 'center',
    },
  }), [colors, insets]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.modal}>
        <View style={styles.sheet}>
          {/* Drag handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            {canGoBack ? (
              <Pressable onPress={handleGoBack} hitSlop={8} style={styles.backButton}>
                <ArrowLeft size={20} color={colors.fg.secondary} />
              </Pressable>
            ) : null}
            <Text style={styles.headerTitle}>Select Folder</Text>
          </View>

          {/* Breadcrumb */}
          <BreadcrumbBar currentPath={currentPath} home={homePath} onNavigate={handleNavigate} />
          <View style={styles.divider} />

          {/* Directory list (folders only — this is a folder picker) */}
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.accent.primary} />
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : dirs.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                {entries.length > 0 ? 'No subfolders' : 'Empty folder'}
              </Text>
              {entries.length > 0 ? (
                <Text style={styles.emptySubtext}>
                  {entries.length} file{entries.length === 1 ? '' : 's'} in this folder
                </Text>
              ) : null}
            </View>
          ) : (
            <FlatList
              data={dirs}
              renderItem={renderEntry}
              keyExtractor={keyExtractor}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}

          {/* Footer */}
          <View style={styles.footer}>
            <Text style={styles.pathPreview} numberOfLines={1}>
              {tildify(currentPath, homePath)}
            </Text>
            <AnimatedPressable style={styles.selectButton} onPress={handleSelect} haptic="medium">
              <Check size={16} color={colors.fg.onAccent} strokeWidth={2.5} />
              <Text style={styles.selectButtonText}>Use this folder</Text>
            </AnimatedPressable>
          </View>
        </View>
      </View>
    </Modal>
  );
});
