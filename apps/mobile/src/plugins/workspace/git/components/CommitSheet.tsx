// ============================================================
// components/CommitSheet.tsx — Bottom sheet for committing staged files
// ============================================================

import React, { useState, useCallback, memo, useMemo } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView,
  Modal, TextInput, ActivityIndicator, Alert,
} from 'react-native';
import { GitCommit, X, Check } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../../theme';
import type { Colors } from '../../../../theme';
import type { GitFile } from '../hooks/useGit';

function getStatusBgColor(status: string, colors: Colors) {
  switch (status) {
    case 'added': return colors.semantic.success;
    case 'modified': return colors.semantic.warning;
    case 'deleted': return colors.semantic.error;
    default: return colors.fg.muted;
  }
}

interface CommitSheetProps {
  visible: boolean;
  onClose: () => void;
  branch: string;
  stagedFiles: GitFile[];
  onCommit: (message: string) => Promise<void>;
}

export const CommitSheet = memo(function CommitSheet({
  visible, onClose, branch, stagedFiles, onCommit,
}: CommitSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'flex-end' },
    backdropPress: { flex: 1 },
    sheet: { backgroundColor: colors.bg.base, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '75%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    headerLeft: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    headerTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    content: { paddingHorizontal: spacing[4], paddingTop: spacing[3], paddingBottom: spacing[8] },
    branchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[3] },
    branchText: { fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
    warningBadge: { backgroundColor: colors.semantic.warningSubtle, paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.sm },
    warningText: { fontSize: typography.fontSize.xs, color: colors.semantic.warning, fontWeight: typography.fontWeight.medium },
    filesLabel: { fontSize: typography.fontSize.xs, color: colors.fg.muted, marginBottom: spacing[2] },
    fileRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 3 },
    statusBadge: { width: 18, height: 18, borderRadius: radii.sm, alignItems: 'center', justifyContent: 'center' },
    statusBadgeText: { fontSize: 10, fontWeight: typography.fontWeight.bold, color: colors.fg.onAccent },
    filePath: { flex: 1, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary },
    moreText: { fontSize: typography.fontSize.xs, color: colors.fg.muted, paddingVertical: spacing[1] },
    messageInput: { backgroundColor: colors.bg.input, borderRadius: radii.md, paddingHorizontal: spacing[4], paddingVertical: spacing[3], fontSize: typography.fontSize.base, color: colors.fg.primary, marginTop: spacing[4], minHeight: 80, maxHeight: 160, textAlignVertical: 'top' },
    commitButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[2], backgroundColor: colors.accent.primary, borderRadius: radii.md, paddingVertical: spacing[3], marginTop: spacing[3] },
    commitButtonDisabled: { opacity: 0.5 },
    commitButtonText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
  }), [colors]);

  const [message, setMessage] = useState('');
  const [committing, setCommitting] = useState(false);
  const isMainBranch = ['main', 'master'].includes(branch);

  const handleCommit = useCallback(async () => {
    if (!message.trim()) return;
    setCommitting(true);
    try {
      await onCommit(message.trim());
      setMessage('');
      onClose();
    } catch (err) {
      Alert.alert('Commit failed', err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setCommitting(false);
    }
  }, [message, onCommit, onClose]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <GitCommit size={18} color={colors.accent.primary} />
              <Text style={styles.headerTitle}>Commit</Text>
            </View>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          <ScrollView style={styles.content} bounces={false}>
            <View style={styles.branchRow}>
              <Text style={styles.branchText}>{branch || 'detached'}</Text>
              {isMainBranch && (
                <View style={styles.warningBadge}>
                  <Text style={styles.warningText}>default branch</Text>
                </View>
              )}
            </View>

            <Text style={styles.filesLabel}>
              {stagedFiles.length} staged file{stagedFiles.length !== 1 ? 's' : ''}
            </Text>
            {stagedFiles.slice(0, 10).map((f) => (
              <View key={f.path} style={styles.fileRow}>
                <View style={[styles.statusBadge, { backgroundColor: getStatusBgColor(f.status, colors) }]}>
                  <Text style={styles.statusBadgeText}>{f.status[0].toUpperCase()}</Text>
                </View>
                <Text style={styles.filePath} numberOfLines={1}>{f.path}</Text>
              </View>
            ))}
            {stagedFiles.length > 10 && (
              <Text style={styles.moreText}>+{stagedFiles.length - 10} more files</Text>
            )}

            <TextInput
              style={styles.messageInput}
              value={message}
              onChangeText={setMessage}
              placeholder="Commit message..."
              placeholderTextColor={colors.fg.muted}
              multiline
              autoFocus
            />

            <Pressable
              style={[styles.commitButton, (!message.trim() || committing) && styles.commitButtonDisabled]}
              onPress={handleCommit}
              disabled={!message.trim() || committing}
            >
              {committing ? (
                <ActivityIndicator size="small" color={colors.fg.onAccent} />
              ) : (
                <>
                  <Check size={16} color={colors.fg.onAccent} />
                  <Text style={styles.commitButtonText}>Commit</Text>
                </>
              )}
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

// Styles computed dynamically via useMemo — see component body.
