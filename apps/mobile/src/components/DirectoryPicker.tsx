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

function pathSegments(path: string): string[] {
  const normalized = path.replace(/^\.?\/?/, '').replace(/\/$/, '');
  if (!normalized) return [];
  return normalized.split('/');
}

function buildPath(segments: string[]): string {
  if (segments.length === 0) return '.';
  return segments.join('/');
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
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const { colors } = useTheme();
  const segments = pathSegments(currentPath);

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={breadStyles.container}
    >
      <Pressable style={breadStyles.segment} onPress={() => onNavigate('.')} hitSlop={6}>
        <FolderOpen size={14} color={colors.accent.primary} />
      </Pressable>

      {segments.map((seg, i) => (
        <View key={i} style={breadStyles.segment}>
          <Text style={[breadStyles.sep, { color: colors.fg.muted }]}>/</Text>
          <Pressable onPress={() => onNavigate(buildPath(segments.slice(0, i + 1)))} hitSlop={6}>
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

const QuickChips = memo(function QuickChips({
  dirs,
  onNavigate,
}: {
  dirs: DirEntry[];
  onNavigate: (name: string) => void;
}) {
  const { colors } = useTheme();
  if (dirs.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={[chipStyles.container, { borderBottomColor: colors.divider }]}
    >
      {dirs.slice(0, 10).map((d) => (
        <Pressable
          key={d.name}
          style={({ pressed }) => [
            chipStyles.chip,
            { backgroundColor: pressed ? colors.accent.subtle : colors.bg.raised, borderColor: colors.divider },
          ]}
          onPress={() => onNavigate(d.name)}
        >
          <Text style={[chipStyles.label, { color: colors.fg.primary }]} numberOfLines={1}>
            {d.name}
          </Text>
        </Pressable>
      ))}
    </ScrollView>
  );
});

const chipStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  chip: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1] + 2,
    borderRadius: radii.full,
    borderWidth: 1,
    maxWidth: 140,
  },
  label: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
  },
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
  initialPath = '.',
  serverId,
}: DirectoryPickerProps) {
  const { colors } = useTheme();
  const getClientForServer = useConnectionStore((state) => state.getClientForServer);
  const insets = useSafeAreaInsets();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirs = useMemo(() => entries.filter((e) => e.type === 'directory'), [entries]);
  const canGoBack = currentPath !== '.' && pathSegments(currentPath).length > 0;

  const fetchEntries = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const client = getClientForServer(serverId);
      if (!client) throw new Error('Server is not connected');
      const result = await client.request<{ path: string; entries: DirEntry[] }>('fs.list', { path });
      setEntries(result.entries);
      setCurrentPath(path);
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
      const newPath = currentPath === '.' ? entry.name : `${currentPath}/${entry.name}`;
      fetchEntries(newPath);
    }
  }, [currentPath, fetchEntries]);

  const handleChipPress = useCallback((name: string) => {
    const newPath = currentPath === '.' ? name : `${currentPath}/${name}`;
    fetchEntries(newPath);
  }, [currentPath, fetchEntries]);

  const handleGoBack = useCallback(() => {
    const segments = pathSegments(currentPath);
    segments.pop();
    fetchEntries(buildPath(segments));
  }, [currentPath, fetchEntries]);

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
          <BreadcrumbBar currentPath={currentPath} onNavigate={handleNavigate} />
          <View style={styles.divider} />

          {/* Quick-pick chips */}
          {!loading && dirs.length > 0 && (
            <QuickChips dirs={dirs} onNavigate={handleChipPress} />
          )}

          {/* Directory list */}
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.accent.primary} />
            </View>
          ) : error ? (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          ) : entries.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>Empty directory</Text>
            </View>
          ) : (
            <FlatList
              data={entries}
              renderItem={renderEntry}
              keyExtractor={keyExtractor}
              style={styles.list}
              showsVerticalScrollIndicator={false}
              ItemSeparatorComponent={() => <View style={styles.separator} />}
            />
          )}

          {/* Footer */}
          <View style={styles.footer}>
            {currentPath !== '.' && (
              <Text style={styles.pathPreview} numberOfLines={1}>{currentPath}</Text>
            )}
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
