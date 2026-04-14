// ============================================================
// components/ProcessDetail.tsx — Detail view for a single managed process
// ============================================================

import React, { useCallback, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, Pressable, ScrollView, Alert,
} from 'react-native';
import { ArrowLeft, RefreshCw, Trash2, TerminalSquare } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../../theme';
import type { ManagedProcess } from '../hooks/useProcesses';

function formatUptime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function DetailRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, mono && styles.detailValueMono]} selectable>
        {value}
      </Text>
    </View>
  );
}

interface ProcessDetailProps {
  process: ManagedProcess;
  onBack: () => void;
  onKill: (id: string) => void;
  onClearOutput: (id: string) => void;
}

export function ProcessDetail({ process: proc, onBack, onKill, onClearOutput }: ProcessDetailProps) {
  const scrollRef = useRef<ScrollView>(null);
  const isRunning = proc.status === 'running';

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [proc.output]);

  const handleKill = useCallback(() => {
    Alert.alert(
      'Kill Process',
      `Are you sure you want to kill "${proc.command}" (PID ${proc.pid})?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        { text: 'KILL', style: 'destructive', onPress: () => onKill(proc.id) },
      ],
    );
  }, [proc, onKill]);

  return (
    <View style={styles.container}>
      <View style={styles.detailHeader}>
        <Pressable style={styles.backBtn} onPress={onBack} hitSlop={8}>
          <ArrowLeft size={20} color={colors.fg.secondary} />
        </Pressable>
        <Text style={styles.detailTitle} numberOfLines={1}>{proc.command}</Text>
        {isRunning && (
          <Pressable style={styles.iconBtn} onPress={handleKill} hitSlop={8}>
            <TerminalSquare size={18} color={colors.semantic.error} />
          </Pressable>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.detailBody}>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isRunning ? colors.semantic.success : colors.fg.muted }]} />
          <Text style={[styles.statusText, { color: isRunning ? colors.semantic.success : colors.fg.muted }]}>
            {isRunning ? 'Running' : proc.status === 'killed' ? 'Killed' : 'Exited'}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>PID {proc.pid}</Text>
        </View>

        <DetailRow label="COMMAND" value={proc.command} mono />
        <DetailRow label="STARTED" value={`${formatTime(proc.startTime)} · ${formatUptime(proc.startTime)} ago`} />
        <DetailRow label="WORKING DIR" value={proc.cwd} mono />

        <View style={styles.outputCard}>
          <View style={styles.outputHeader}>
            <Text style={styles.outputLabel}>OUTPUT</Text>
            <View style={styles.outputActions}>
              <Pressable hitSlop={8} onPress={() => scrollRef.current?.scrollToEnd({ animated: true })}>
                <RefreshCw size={15} color={colors.fg.muted} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => onClearOutput(proc.id)}>
                <Trash2 size={15} color={colors.fg.muted} />
              </Pressable>
            </View>
          </View>
          <ScrollView ref={scrollRef} style={styles.outputScroll}>
            <Text style={styles.outputText} selectable>
              {proc.output || '(no output yet)'}
            </Text>
          </ScrollView>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  detailHeader: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3],
    height: 52, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider, gap: spacing[2],
  },
  backBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  detailTitle: {
    flex: 1, fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary, fontFamily: typography.fontFamily.mono,
  },
  iconBtn: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  detailBody: { padding: spacing[4], gap: spacing[3] },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], marginBottom: spacing[1] },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold },
  metaDot: { color: colors.fg.muted },
  metaText: { fontSize: typography.fontSize.sm, color: colors.fg.muted },
  detailRow: { backgroundColor: colors.bg.raised, borderRadius: radii.md, padding: spacing[4], gap: spacing[1] },
  detailLabel: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, letterSpacing: 0.5 },
  detailValue: { fontSize: typography.fontSize.sm, color: colors.fg.primary },
  detailValueMono: { fontFamily: typography.fontFamily.mono },
  outputCard: { backgroundColor: colors.bg.raised, borderRadius: radii.md, overflow: 'hidden', flex: 1, minHeight: 200 },
  outputHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  outputLabel: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, letterSpacing: 0.5 },
  outputActions: { flexDirection: 'row', gap: spacing[4] },
  outputScroll: { maxHeight: 400 },
  outputText: { fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.xs, color: colors.fg.secondary, lineHeight: 18, padding: spacing[3] },
});
