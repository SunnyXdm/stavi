// WHAT: EntryMetaSheet — bottom sheet showing file/directory metadata.
// WHY:  Explorer's "Info" action needs to show size, modified time, permissions,
//       type, and full path for a selected entry. fs.stat supplies this data.
// HOW:  Receives the absolute path of the selected entry. On open, calls
//       fs.stat via the server client and renders the result. Path is copyable
//       via long-press. Styled as a DESIGN.md §4 bottom sheet.
//       Uses only tokens from theme/tokens.ts — zero hardcoded values.
// SEE:  apps/mobile/src/plugins/shared/explorer/index.tsx (host),
//       packages/server-core/src/handlers/fs-batch.ts (fs.stat RPC),
//       docs/PROTOCOL.md §5.5 (fs.stat response shape)

import React, { memo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Clipboard,
} from 'react-native';
import { X, FileText, Folder, Lock } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useConnectionStore } from '../../../../stores/connection';
import { colors, typography, spacing, radii } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface StatResult {
  size: number;
  mtime: number;
  atime: number;
  mode: string;   // octal string e.g. '0755'
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
}

interface EntryMetaSheetProps {
  visible: boolean;
  path: string;         // absolute path on server
  serverId: string;
  onClose: () => void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDate(epochMs: number): string {
  return new Date(epochMs).toLocaleString();
}

function entryType(stat: StatResult): string {
  if (stat.isSymlink) return 'Symbolic link';
  if (stat.isDirectory) return 'Directory';
  return 'File';
}

// ----------------------------------------------------------
// MetaRow
// ----------------------------------------------------------

const MetaRow = memo(function MetaRow({
  label,
  value,
  mono = false,
  onLongPress,
}: {
  label: string;
  value: string;
  mono?: boolean;
  onLongPress?: () => void;
}) {
  return (
    <View style={styles.metaRow}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Pressable onLongPress={onLongPress} hitSlop={4}>
        <Text style={[styles.metaValue, mono && styles.metaValueMono]} numberOfLines={2}>
          {value}
        </Text>
      </Pressable>
    </View>
  );
});

// ----------------------------------------------------------
// Sheet
// ----------------------------------------------------------

export const EntryMetaSheet = memo(function EntryMetaSheet({
  visible,
  path,
  serverId,
  onClose,
}: EntryMetaSheetProps) {
  const insets = useSafeAreaInsets();
  const getClientForServer = useConnectionStore((s) => s.getClientForServer);
  const [stat, setStat] = useState<StatResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!visible || !path) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setStat(null);

    const client = getClientForServer(serverId);
    if (!client) {
      setError('Server not connected');
      setLoading(false);
      return;
    }

    client.request<StatResult>('fs.stat', { path })
      .then((result) => {
        if (!cancelled) setStat(result);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'stat failed');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [visible, path, serverId, getClientForServer]);

  const handleCopyPath = useCallback(() => {
    Clipboard.setString(path);
    Alert.alert('Copied', 'Full path copied to clipboard');
  }, [path]);

  const fileName = path.split('/').pop() ?? path;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropDismiss} onPress={onClose} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            {stat?.isDirectory ? (
              <Folder size={20} color={colors.semantic.warning} />
            ) : (
              <FileText size={20} color={colors.semantic.info} />
            )}
            <Text style={styles.fileName} numberOfLines={1}>{fileName}</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          {/* Content */}
          {loading && (
            <View style={styles.centered}>
              <ActivityIndicator size="small" color={colors.accent.primary} />
            </View>
          )}
          {error && (
            <View style={styles.centered}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {stat && !loading && (
            <View style={styles.metaList}>
              <MetaRow label="Type" value={entryType(stat)} />
              <MetaRow label="Size" value={formatBytes(stat.size)} />
              <MetaRow label="Modified" value={formatDate(stat.mtime)} />
              <MetaRow label="Accessed" value={formatDate(stat.atime)} />
              <MetaRow
                label="Permissions"
                value={stat.mode}
                mono
              />
              <MetaRow
                label="Full path"
                value={path}
                mono
                onLongPress={handleCopyPath}
              />
              <View style={styles.copyHint}>
                <Lock size={12} color={colors.fg.muted} />
                <Text style={styles.copyHintText}>Long-press path to copy</Text>
              </View>
            </View>
          )}
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
    backgroundColor: colors.bg.scrim,
    justifyContent: 'flex-end',
  },
  backdropDismiss: {
    flex: 1,
  },
  sheet: {
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radii.lg,
    borderTopRightRadius: radii.lg,
    paddingTop: spacing[2],
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.fg.muted,
    alignSelf: 'center',
    marginBottom: spacing[3],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  fileName: {
    flex: 1,
    fontSize: typography.fontSize.md,
    fontFamily: typography.fontFamily.sansSemiBold,
    color: colors.fg.primary,
  },
  centered: {
    paddingVertical: spacing[8],
    alignItems: 'center',
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.semantic.error,
    textAlign: 'center',
    paddingHorizontal: spacing[4],
  },
  metaList: {
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dividerSubtle,
    gap: spacing[4],
  },
  metaLabel: {
    width: 90,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.sansMedium,
    color: colors.fg.muted,
    flexShrink: 0,
  },
  metaValue: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
  },
  metaValueMono: {
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
  },
  copyHint: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    gap: spacing[1],
  },
  copyHintText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
});
