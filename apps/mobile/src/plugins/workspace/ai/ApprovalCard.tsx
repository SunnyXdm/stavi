// ============================================================
// ApprovalCard — Permission request with action buttons
// ============================================================
// Shows when the AI needs permission to run a command or make changes.
// Classifies the request (command / file read / file change), previews the
// actual change (full command, or an old→new diff for edits), and offers
// Deny / Always Allow (session) / Approve, plus Cancel turn. A 1/N counter
// shows when multiple approvals stack.

import React, { memo, useCallback, useState, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { ShieldAlert, Terminal, FileText, FilePen, OctagonX } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import type { Colors } from '../../../theme';
import type { ApprovalRequest } from './useOrchestration';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useHaptics } from '../../../hooks/useHaptics';

interface ApprovalCardProps {
  approval: ApprovalRequest;
  /** 1-based position when several approvals are stacked (with `queueTotal`). */
  queueIndex?: number;
  queueTotal?: number;
  onRespond: (
    threadId: string,
    requestId: string,
    decision: 'accept' | 'reject' | 'always-allow',
  ) => void;
  /** Cancel the whole turn (interrupt) — the escape hatch when the model is
   *  off the rails and neither approving nor denying is right. */
  onCancelTurn?: (threadId: string) => void;
}

type RequestKind = 'command' | 'file-change' | 'file-read' | 'other';

/** Classify the request so the card can lead with what KIND of thing is being
 *  asked, not just a raw tool name (t3code classifyRequestType parity). */
function classifyRequest(toolName: string, toolInput?: Record<string, unknown>): RequestKind {
  const t = toolName.toLowerCase();
  if (t.includes('bash') || t.includes('command') || t.includes('terminal') || typeof toolInput?.command === 'string') {
    return 'command';
  }
  if (t.includes('edit') || t.includes('write') || t.includes('filechange') || toolInput?.new_string !== undefined || toolInput?.content !== undefined) {
    return 'file-change';
  }
  if (t.includes('read') || t.includes('glob') || t.includes('grep') || t.includes('fileread')) {
    return 'file-read';
  }
  return 'other';
}

const KIND_LABEL: Record<RequestKind, string> = {
  'command': 'Run command',
  'file-change': 'Change file',
  'file-read': 'Read file',
  'other': 'Use tool',
};

const KIND_ICON: Record<RequestKind, typeof Terminal> = {
  'command': Terminal,
  'file-change': FilePen,
  'file-read': FileText,
  'other': FileText,
};

function createStyles(colors: Colors) {
  return StyleSheet.create({
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
      flex: 1,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.semibold,
      color: colors.semantic.warning,
      textTransform: 'uppercase',
      letterSpacing: typography.letterSpacing.wide,
    },
    queueBadge: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
    },
    content: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
    toolRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
    kindLabel: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    toolName: { fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono },
    detailBox: { backgroundColor: colors.bg.input, borderRadius: radii.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginTop: spacing[1] },
    detailText: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.fg.secondary, lineHeight: typography.fontSize.xs * typography.lineHeight.normal },
    expandHint: { fontSize: typography.fontSize.xs, color: colors.accent.primary, marginTop: spacing[1] },
    diffLabel: { fontSize: 10, fontWeight: typography.fontWeight.semibold, letterSpacing: 0.5, marginBottom: 2 },
    diffOldLabel: { color: colors.semantic.error },
    diffNewLabel: { color: colors.semantic.success },
    diffOldBox: { backgroundColor: colors.semantic.errorSubtle, borderRadius: radii.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginTop: spacing[1] },
    diffNewBox: { backgroundColor: colors.semantic.successSubtle, borderRadius: radii.sm, paddingHorizontal: spacing[3], paddingVertical: spacing[2], marginTop: spacing[1] },
    actions: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingBottom: spacing[2], paddingTop: spacing[2] },
    button: { flex: 1, borderRadius: radii.md, paddingVertical: spacing[2], alignItems: 'center', justifyContent: 'center', minHeight: 36 },
    denyButton: { backgroundColor: colors.semantic.errorSubtle },
    denyText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.semantic.error },
    alwaysAllowButton: { backgroundColor: colors.bg.overlay },
    alwaysAllowText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.fg.secondary, textAlign: 'center' },
    approveButton: { backgroundColor: colors.accent.primary },
    approveText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
    cancelTurnRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing[1], paddingBottom: spacing[3] },
    cancelTurnText: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
  });
}

export const ApprovalCard = memo(function ApprovalCard({
  approval,
  queueIndex,
  queueTotal,
  onRespond,
  onCancelTurn,
}: ApprovalCardProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [responding, setResponding] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const haptics = useHaptics();

  const handleRespond = useCallback(
    async (decision: 'accept' | 'reject' | 'always-allow') => {
      if (decision === 'accept' || decision === 'always-allow') haptics.success();
      else haptics.warning();
      setResponding(decision);
      try {
        await onRespond(approval.threadId, approval.requestId, decision);
      } catch (err) {
        console.error('[Approval] Response error:', err);
      } finally {
        setResponding(null);
      }
    },
    [approval.threadId, approval.requestId, onRespond, haptics],
  );

  if (!approval.pending) return null;

  const toolName = approval.toolName || 'Action';
  const toolInput = approval.toolInput;
  const kind = classifyRequest(toolName, toolInput);
  const Icon = KIND_ICON[kind];

  // Primary detail (command text or file path)
  let detail = '';
  if (toolInput) {
    if (typeof toolInput.command === 'string') {
      detail = toolInput.command;
    } else if (typeof toolInput.file_path === 'string') {
      detail = String(toolInput.file_path);
    } else if (typeof toolInput.path === 'string') {
      detail = String(toolInput.path);
    } else {
      detail = JSON.stringify(toolInput, null, 1).slice(0, 400);
    }
  }
  // Edit diff preview: show what's being replaced with what.
  const oldString = typeof toolInput?.old_string === 'string' ? (toolInput.old_string as string) : null;
  const newString = typeof toolInput?.new_string === 'string'
    ? (toolInput.new_string as string)
    : typeof toolInput?.content === 'string' && kind === 'file-change'
      ? (toolInput.content as string)
      : null;
  const detailIsLong = detail.length > 280;
  const collapsedLines = 4;

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <ShieldAlert size={16} color={colors.semantic.warning} />
        <Text style={styles.headerText}>Approval Required</Text>
        {queueTotal != null && queueTotal > 1 && (
          <Text style={styles.queueBadge}>{queueIndex ?? 1}/{queueTotal}</Text>
        )}
      </View>

      {/* Content */}
      <View style={styles.content}>
        <View style={styles.toolRow}>
          <Icon size={14} color={colors.fg.tertiary} />
          <Text style={styles.kindLabel}>{KIND_LABEL[kind]}</Text>
          <Text style={styles.toolName} numberOfLines={1}>{toolName}</Text>
        </View>
        {detail ? (
          <Pressable onPress={() => detailIsLong && setExpanded((v) => !v)} disabled={!detailIsLong}>
            <View style={styles.detailBox}>
              <Text style={styles.detailText} numberOfLines={expanded ? undefined : collapsedLines}>
                {detail}
              </Text>
            </View>
            {detailIsLong && (
              <Text style={styles.expandHint}>{expanded ? 'Show less' : 'Show full'}</Text>
            )}
          </Pressable>
        ) : null}
        {oldString != null && newString != null && (
          <>
            <View style={styles.diffOldBox}>
              <Text style={[styles.diffLabel, styles.diffOldLabel]}>− REMOVE</Text>
              <Text style={styles.detailText} numberOfLines={expanded ? undefined : 5}>{oldString}</Text>
            </View>
            <View style={styles.diffNewBox}>
              <Text style={[styles.diffLabel, styles.diffNewLabel]}>+ ADD</Text>
              <Text style={styles.detailText} numberOfLines={expanded ? undefined : 5}>{newString}</Text>
            </View>
            <Pressable onPress={() => setExpanded((v) => !v)}>
              <Text style={styles.expandHint}>{expanded ? 'Show less' : 'Show full diff'}</Text>
            </Pressable>
          </>
        )}
      </View>

      {/* Action buttons */}
      <View style={styles.actions}>
        <AnimatedPressable
          style={[styles.button, styles.denyButton]}
          onPress={() => handleRespond('reject')}
          disabled={responding !== null}
        >
          {responding === 'reject' ? (
            <ActivityIndicator size={14} color={colors.semantic.error} />
          ) : (
            <Text style={styles.denyText}>Deny</Text>
          )}
        </AnimatedPressable>

        <AnimatedPressable
          style={[styles.button, styles.alwaysAllowButton]}
          onPress={() => handleRespond('always-allow')}
          disabled={responding !== null}
        >
          {responding === 'always-allow' ? (
            <ActivityIndicator size={14} color={colors.fg.secondary} />
          ) : (
            <Text style={styles.alwaysAllowText}>Always allow{'\n'}(session)</Text>
          )}
        </AnimatedPressable>

        <AnimatedPressable
          style={[styles.button, styles.approveButton]}
          onPress={() => handleRespond('accept')}
          disabled={responding !== null}
        >
          {responding === 'accept' ? (
            <ActivityIndicator size={14} color={colors.fg.onAccent} />
          ) : (
            <Text style={styles.approveText}>Approve</Text>
          )}
        </AnimatedPressable>
      </View>

      {/* Cancel turn — interrupts the whole turn, resolving every pending card */}
      {onCancelTurn && (
        <Pressable
          style={styles.cancelTurnRow}
          onPress={() => { haptics.warning(); onCancelTurn(approval.threadId); }}
          disabled={responding !== null}
          hitSlop={6}
        >
          <OctagonX size={12} color={colors.fg.muted} />
          <Text style={styles.cancelTurnText}>Cancel turn</Text>
        </Pressable>
      )}
    </View>
  );
});

// Styles via createStyles — see factory above.
