// ============================================================
// Extra Plugin: Processes
// ============================================================
// Thin compositor — state via useProcesses, UI via ProcessDetail + SpawnForm.

import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, FlatList, Pressable,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { ListTree, RefreshCw, Plus, ChevronRight } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing } from '../../../theme';
import { useProcesses } from './hooks/useProcesses';
import { ProcessDetail } from './components/ProcessDetail';
import { SpawnForm } from './components/SpawnForm';

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function formatUptime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
}

// ----------------------------------------------------------
// Main Panel
// ----------------------------------------------------------

function ProcessesPanel({ isActive }: PluginPanelProps) {
  const { connectionState, processes, runningCount, spawn, kill, clearOutput } = useProcesses();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [tick, setTick] = useState(0);

  // Uptime ticker
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  // Clear selection on disconnect
  useEffect(() => {
    if (connectionState !== 'connected') setSelectedId(null);
  }, [connectionState]);

  // Detail view
  const selected = selectedId ? processes.find((p) => p.id === selectedId) : null;
  if (selected) {
    return (
      <ProcessDetail
        process={selected}
        onBack={() => setSelectedId(null)}
        onKill={kill}
        onClearOutput={clearOutput}
      />
    );
  }

  if (connectionState !== 'connected') {
    return (
      <View style={styles.centered}>
        <ListTree size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Connect to a server to manage processes</Text>
      </View>
    );
  }

  const handleSpawn = (cmd: string, path: string, args: string) => {
    setShowSpawnForm(false);
    spawn(cmd, path, args);
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {showSpawnForm && (
        <SpawnForm
          onSpawn={handleSpawn}
          onCancel={() => setShowSpawnForm(false)}
        />
      )}

      {processes.length === 0 && !showSpawnForm ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>{'>_'}</Text>
          <Text style={styles.emptyTitle}>No managed processes</Text>
          <Text style={styles.emptySubtitle}>Tap + to spawn a new process</Text>
        </View>
      ) : (
        <FlatList
          data={processes}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => {
            const isRunning = item.status === 'running';
            return (
              <Pressable
                style={({ pressed }) => [styles.processRow, pressed && styles.processRowPressed]}
                onPress={() => setSelectedId(item.id)}
              >
                <View style={[styles.processDot, { backgroundColor: isRunning ? colors.semantic.success : colors.fg.muted }]} />
                <Text style={styles.processCommand} numberOfLines={1}>{item.command}</Text>
                <Text style={styles.processMeta}>· {item.pid}</Text>
                <Text style={styles.processMeta}>· {formatUptime(item.startTime)}</Text>
                <ChevronRight size={16} color={colors.fg.muted} />
              </Pressable>
            );
          }}
          contentContainerStyle={styles.listContent}
          extraData={tick}
        />
      )}

      <View style={styles.bottomBar}>
        <Text style={styles.bottomCount}>
          {processes.length} {processes.length === 1 ? 'process' : 'processes'}
        </Text>
        <Text style={styles.bottomDot}>·</Text>
        <Text style={[styles.bottomRunning, { color: runningCount > 0 ? colors.semantic.success : colors.fg.muted }]}>
          {runningCount} running
        </Text>
        <View style={{ flex: 1 }} />
        <Pressable style={styles.bottomIconBtn} onPress={() => setShowSpawnForm((v) => !v)}>
          <Plus size={18} color={colors.fg.secondary} />
        </Pressable>
        <Pressable style={styles.bottomIconBtn} onPress={() => {}}>
          <RefreshCw size={16} color={colors.fg.muted} />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const processesPlugin: PluginDefinition = {
  id: 'processes',
  name: 'Processes',
  description: 'Spawn and manage running processes',
  kind: 'extra',
  icon: ListTree,
  component: ProcessesPanel,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    gap: spacing[3], padding: spacing[6],
  },
  emptyIcon: {
    fontSize: 40, color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono, opacity: 0.4,
  },
  emptyTitle: {
    fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
  },
  emptySubtitle: { fontSize: typography.fontSize.sm, color: colors.fg.muted, textAlign: 'center' },
  emptyText: { fontSize: typography.fontSize.sm, color: colors.fg.muted, textAlign: 'center' },
  listContent: { paddingVertical: spacing[1] },
  processRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing[4], paddingVertical: spacing[3],
    gap: spacing[2], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  processRowPressed: { backgroundColor: colors.bg.active },
  processDot: { width: 8, height: 8, borderRadius: 4 },
  processCommand: {
    flex: 1, fontSize: typography.fontSize.sm,
    color: colors.fg.primary, fontFamily: typography.fontFamily.mono,
  },
  processMeta: { fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono },
  bottomBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: spacing[4], paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider, gap: spacing[2],
  },
  bottomCount: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
  bottomDot: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
  bottomRunning: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold },
  bottomIconBtn: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
});
