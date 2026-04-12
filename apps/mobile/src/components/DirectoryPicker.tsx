// ============================================================
// DirectoryPicker — Bottom-sheet folder browser
// ============================================================
// Navigable directory tree via the server's fs.list RPC.
// Used by the AI tab to select a workspace directory and
// reusable for the editor's folder picker.

import React, { memo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  FlatList,
  Modal,
  ActivityIndicator,
} from 'react-native';
import {
  X,
  Folder,
  File,
  ChevronRight,
  FolderOpen,
  ArrowLeft,
} from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, typography, spacing, radii } from '../theme';
import { staviClient } from '../stores/stavi-client';

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
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function formatSize(bytes?: number): string {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pathSegments(path: string): string[] {
  const normalized = path.replace(/^\.?\/?/, '').replace(/\/$/, '');
  if (!normalized) return [];
  return normalized.split('/');
}

function buildPath(segments: string[]): string {
  if (segments.length === 0) return '.';
  return segments.join('/');
}

// ----------------------------------------------------------
// Breadcrumb
// ----------------------------------------------------------

const Breadcrumb = memo(function Breadcrumb({
  currentPath,
  onNavigate,
}: {
  currentPath: string;
  onNavigate: (path: string) => void;
}) {
  const segments = pathSegments(currentPath);

  return (
    <View style={breadcrumbStyles.container}>
      <Pressable
        style={breadcrumbStyles.segment}
        onPress={() => onNavigate('.')}
        hitSlop={4}
      >
        <FolderOpen size={14} color={colors.accent.primary} />
        <Text style={breadcrumbStyles.rootLabel}>root</Text>
      </Pressable>

      {segments.map((seg, i) => (
        <View key={i} style={breadcrumbStyles.segment}>
          <ChevronRight size={12} color={colors.fg.muted} />
          <Pressable
            onPress={() => onNavigate(buildPath(segments.slice(0, i + 1)))}
            hitSlop={4}
          >
            <Text
              style={[
                breadcrumbStyles.segLabel,
                i === segments.length - 1 && breadcrumbStyles.segLabelActive,
              ]}
              numberOfLines={1}
            >
              {seg}
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
});

const breadcrumbStyles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: 2,
    flexWrap: 'wrap',
    backgroundColor: colors.bg.raised,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  segment: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  rootLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.accent.primary,
  },
  segLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
  },
  segLabelActive: {
    color: colors.fg.primary,
    fontWeight: typography.fontWeight.medium,
  },
});

// ----------------------------------------------------------
// Entry row
// ----------------------------------------------------------

const EntryRow = memo(function EntryRow({
  entry,
  onPress,
}: {
  entry: DirEntry;
  onPress: () => void;
}) {
  const isDir = entry.type === 'directory';

  return (
    <Pressable
      style={({ pressed }) => [
        rowStyles.row,
        isDir && rowStyles.rowDir,
        pressed && rowStyles.rowPressed,
        !isDir && rowStyles.rowFile,
      ]}
      onPress={isDir ? onPress : undefined}
      disabled={!isDir}
    >
      {isDir ? (
        <Folder size={18} color={colors.accent.primary} />
      ) : (
        <File size={18} color={colors.fg.muted} />
      )}
      <Text
        style={[rowStyles.name, !isDir && rowStyles.nameFile]}
        numberOfLines={1}
      >
        {entry.name}
      </Text>
      {!isDir && entry.size !== undefined && (
        <Text style={rowStyles.meta}>{formatSize(entry.size)}</Text>
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
  rowDir: {
    backgroundColor: 'transparent',
  },
  rowFile: {
    opacity: 0.5,
  },
  rowPressed: {
    backgroundColor: colors.bg.overlay,
  },
  name: {
    flex: 1,
    fontSize: typography.fontSize.base,
    color: colors.fg.primary,
  },
  nameFile: {
    color: colors.fg.muted,
  },
  meta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
});

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const DirectoryPicker = memo(function DirectoryPicker({
  visible,
  onClose,
  onSelect,
  initialPath = '.',
}: DirectoryPickerProps) {
  const insets = useSafeAreaInsets();
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch directory listing
  const fetchEntries = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await staviClient.request<{
        path: string;
        entries: DirEntry[];
      }>('fs.list', { path });
      setEntries(result.entries);
      setCurrentPath(path);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to list directory';
      setError(msg);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on open and when path changes
  useEffect(() => {
    if (visible) {
      fetchEntries(initialPath);
    }
  }, [visible, initialPath, fetchEntries]);

  const handleNavigate = useCallback((path: string) => {
    fetchEntries(path);
  }, [fetchEntries]);

  const handleEntryPress = useCallback((entry: DirEntry) => {
    if (entry.type === 'directory') {
      const newPath = currentPath === '.'
        ? entry.name
        : `${currentPath}/${entry.name}`;
      fetchEntries(newPath);
    }
  }, [currentPath, fetchEntries]);

  const handleGoBack = useCallback(() => {
    const segments = pathSegments(currentPath);
    if (segments.length > 0) {
      segments.pop();
      fetchEntries(buildPath(segments));
    }
  }, [currentPath, fetchEntries]);

  const handleSelect = useCallback(() => {
    onSelect(currentPath);
    onClose();
  }, [currentPath, onSelect, onClose]);

  const canGoBack = currentPath !== '.' && pathSegments(currentPath).length > 0;
  const dirCount = entries.filter((e) => e.type === 'directory').length;
  const fileCount = entries.filter((e) => e.type === 'file').length;

  const renderEntry = useCallback(({ item }: { item: DirEntry }) => (
    <EntryRow entry={item} onPress={() => handleEntryPress(item)} />
  ), [handleEntryPress]);

  const keyExtractor = useCallback((item: DirEntry) => item.name, []);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} />

        <View style={[styles.sheet, { paddingBottom: insets.bottom || spacing[4] }]}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              {canGoBack && (
                <Pressable onPress={handleGoBack} hitSlop={8} style={styles.backButton}>
                  <ArrowLeft size={20} color={colors.fg.secondary} />
                </Pressable>
              )}
              <Text style={styles.headerTitle}>Select Directory</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          {/* Breadcrumb */}
          <Breadcrumb currentPath={currentPath} onNavigate={handleNavigate} />

          {/* Content */}
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
            <Text style={styles.footerMeta}>
              {dirCount} folders, {fileCount} files
            </Text>
            <Pressable style={styles.selectButton} onPress={handleSelect}>
              <Text style={styles.selectButtonText}>Select This Directory</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  backdropPress: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.bg.base,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '80%',
    minHeight: '50%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  backButton: {
    padding: 4,
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  list: {
    flex: 1,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginHorizontal: spacing[4],
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[8],
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.semantic.error,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing[2],
  },
  footerMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  selectButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  selectButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
