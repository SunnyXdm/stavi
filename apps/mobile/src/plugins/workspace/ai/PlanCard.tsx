// ============================================================
// PlanCard — ExitPlanMode proposal review
// ============================================================
// When the model finishes planning (plan interaction mode) it calls
// ExitPlanMode; the server intercepts it and broadcasts thread.plan-proposed.
// This card renders the plan markdown with two actions:
//   - Approve & build: switch the thread to default mode and send an
//     approval message so the model starts implementing.
//   - Keep planning: dismiss the card; the user replies with feedback.

import React, { memo, useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { ClipboardList } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import type { PlanProposal } from './useOrchestration';
import { Markdown } from './Markdown';
import { AnimatedPressable } from '../../../components/AnimatedPressable';
import { useHaptics } from '../../../hooks/useHaptics';

interface PlanCardProps {
  proposal: PlanProposal;
  onApprove: (threadId: string) => void;
  onKeepPlanning: (threadId: string) => void;
}

export const PlanCard = memo(function PlanCard({ proposal, onApprove, onKeepPlanning }: PlanCardProps) {
  const { colors } = useTheme();
  const haptics = useHaptics();
  const [busy, setBusy] = useState(false);
  const styles = useMemo(() => StyleSheet.create({
    container: {
      marginHorizontal: spacing[4],
      marginVertical: spacing[2],
      backgroundColor: colors.bg.raised,
      borderRadius: radii.lg,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent.primary,
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
      color: colors.accent.primary,
      textTransform: 'uppercase',
      letterSpacing: typography.letterSpacing.wide,
    },
    planScroll: { maxHeight: 320 },
    planBody: { paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
    actions: { flexDirection: 'row', gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[3] },
    button: { flex: 1, borderRadius: radii.md, paddingVertical: spacing[3], alignItems: 'center', justifyContent: 'center' },
    secondaryButton: { backgroundColor: colors.bg.overlay },
    secondaryText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.fg.secondary },
    primaryButton: { backgroundColor: colors.accent.primary },
    primaryText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.fg.onAccent },
  }), [colors]);

  if (!proposal.pending) return null;

  const handleApprove = () => {
    if (busy) return;
    setBusy(true);
    haptics.success();
    onApprove(proposal.threadId);
  };

  const handleKeepPlanning = () => {
    if (busy) return;
    haptics.light();
    onKeepPlanning(proposal.threadId);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <ClipboardList size={16} color={colors.accent.primary} />
        <Text style={styles.headerText}>Proposed Plan</Text>
      </View>
      <ScrollView style={styles.planScroll} nestedScrollEnabled>
        <View style={styles.planBody}>
          <Markdown>{proposal.plan || '_(empty plan)_'}</Markdown>
        </View>
      </ScrollView>
      <View style={styles.actions}>
        <AnimatedPressable style={[styles.button, styles.secondaryButton]} onPress={handleKeepPlanning} disabled={busy}>
          <Text style={styles.secondaryText}>Keep planning</Text>
        </AnimatedPressable>
        <AnimatedPressable style={[styles.button, styles.primaryButton]} onPress={handleApprove} disabled={busy}>
          <Text style={styles.primaryText}>Approve & build</Text>
        </AnimatedPressable>
      </View>
    </View>
  );
});
