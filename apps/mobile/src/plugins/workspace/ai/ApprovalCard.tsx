// ============================================================
// ApprovalCard — Permission request with action buttons
// ============================================================
// Shows when the AI needs permission to run a command or
// make changes. Three buttons: Deny, Always Allow, Approve.

import React, { memo, useCallback, useState } from 'react';
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from 'react-native';
import { ShieldAlert, Terminal, FileText } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';
import type { ApprovalRequest } from './useOrchestration';

interface ApprovalCardProps {
  approval: ApprovalRequest;
  onRespond: (
    threadId: string,
    requestId: string,
    decision: 'accept' | 'reject' | 'always-allow',
  ) => void;
}

export const ApprovalCard = memo(function ApprovalCard({ approval, onRespond }: ApprovalCardProps) {
  const [responding, setResponding] = useState<string | null>(null);

  const handleRespond = useCallback(
    async (decision: 'accept' | 'reject' | 'always-allow') => {
      setResponding(decision);
      try {
        await onRespond(approval.threadId, approval.requestId, decision);
      } catch (err) {
        console.error('[Approval] Response error:', err);
      } finally {
        setResponding(null);
      }
    },
    [approval.threadId, approval.requestId, onRespond],
  );

  if (!approval.pending) return null;

  // Determine what's being requested
  const toolName = approval.toolName || 'Action';
  const toolInput = approval.toolInput;
  const isCommand =
    toolName.toLowerCase().includes('bash') ||
    toolName.toLowerCase().includes('command') ||
    toolName.toLowerCase().includes('terminal');
  const Icon = isCommand ? Terminal : FileText;

  // Extract display detail
  let detail = '';
  if (toolInput) {
    if (typeof toolInput.command === 'string') {
      detail = toolInput.command;
    } else if (typeof toolInput.file_path === 'string') {
      detail = toolInput.file_path;
    } else {
      detail = JSON.stringify(toolInput).slice(0, 120);
    }
  }

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ShieldAlert size={16} color={colors.semantic.warning} />
        <Text style={styles.headerText}>Approval Required</Text>
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.toolRow}>
          <Icon size={14} color={colors.fg.tertiary} />
          <Text style={styles.toolName}>{toolName}</Text>
        </View>
        {detail ? (
          <View style={styles.detailBox}>
            <Text style={styles.detailText} numberOfLines={4}>
              {detail}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Pressable
          style={({ pressed }) => [styles.button, styles.denyButton, pressed && styles.buttonPressed]}
          onPress={() => handleRespond('reject')}
          disabled={responding !== null}
        >
          {responding === 'reject' ? (
            <ActivityIndicator size={14} color={colors.semantic.error} />
          ) : (
            <Text style={styles.denyText}>Deny</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.alwaysAllowButton,
            pressed && styles.buttonPressed,
          ]}
          onPress={() => handleRespond('always-allow')}
          disabled={responding !== null}
        >
          {responding === 'always-allow' ? (
            <ActivityIndicator size={14} color={colors.fg.secondary} />
          ) : (
            <Text style={styles.alwaysAllowText}>Always Allow</Text>
          )}
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            styles.approveButton,
            pressed && styles.approveButtonPressed,
          ]}
          onPress={() => handleRespond('accept')}
          disabled={responding !== null}
        >
          {responding === 'accept' ? (
            <ActivityIndicator size={14} color={colors.fg.onAccent} />
          ) : (
            <Text style={styles.approveText}>Approve</Text>
          )}
        </Pressable>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    marginHorizontal: spacing[4],
    marginVertical: spacing[2],
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    borderLeftWidth: 3,
    borderLeftColor: colors.semantic.warning,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[3],
    paddingBottom: spacing[1],
  },
  headerText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.semantic.warning,
    textTransform: 'uppercase',
    letterSpacing: typography.letterSpacing.wide,
  },
  content: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  toolRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  toolName: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  detailBox: {
    backgroundColor: colors.bg.input,
    borderRadius: radii.sm,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    marginTop: spacing[1],
  },
  detailText: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
    lineHeight: typography.fontSize.xs * typography.lineHeight.normal,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[3],
    paddingTop: spacing[2],
  },
  button: {
    flex: 1,
    borderRadius: radii.md,
    paddingVertical: spacing[2],
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 36,
  },
  buttonPressed: {
    opacity: 0.8,
  },
  denyButton: {
    backgroundColor: colors.semantic.errorSubtle,
  },
  denyText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.semantic.error,
  },
  alwaysAllowButton: {
    backgroundColor: colors.bg.overlay,
  },
  alwaysAllowText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  approveButton: {
    backgroundColor: colors.accent.primary,
  },
  approveButtonPressed: {
    backgroundColor: colors.accent.secondary,
  },
  approveText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
