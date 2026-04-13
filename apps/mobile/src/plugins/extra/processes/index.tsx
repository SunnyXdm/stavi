// ============================================================
// Extra Plugin: Processes
// ============================================================
// Managed process spawner — run commands, track output, kill them.
// Matches lunel's Processes plugin pattern exactly:
//   - Main view: process list + spawn form (shown via + button)
//   - Detail view: live output, process info, kill button
// Uses server-side process.spawn / process.kill / subscribeProcessEvents.

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  ListTree,
  RefreshCw,
  Plus,
  ChevronRight,
  ArrowLeft,
  Trash2,
  TerminalSquare,
} from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface ManagedProcess {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  status: 'running' | 'exited' | 'killed';
  startTime: number;
  output: string;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function formatUptime(startTime: number): string {
  const elapsed = Math.floor((Date.now() - startTime) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  if (elapsed < 3600) return `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`;
  return `${Math.floor(elapsed / 3600)}h ${Math.floor((elapsed % 3600) / 60)}m`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ----------------------------------------------------------
// Detail View
// ----------------------------------------------------------

function ProcessDetail({
  process: proc,
  onBack,
  onKill,
  onClearOutput,
}: {
  process: ManagedProcess;
  onBack: () => void;
  onKill: (id: string) => void;
  onClearOutput: (id: string) => void;
}) {
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: false });
  }, [proc.output]);

  const handleKill = useCallback(() => {
    Alert.alert(
      'Kill Process',
      `Are you sure you want to kill "${proc.command}" (PID ${proc.pid})?`,
      [
        { text: 'CANCEL', style: 'cancel' },
        {
          text: 'KILL',
          style: 'destructive',
          onPress: () => onKill(proc.id),
        },
      ],
    );
  }, [proc, onKill]);

  const isRunning = proc.status === 'running';

  return (
    <View style={styles.container}>
      {/* Detail header */}
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
        {/* Status line */}
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, { backgroundColor: isRunning ? colors.semantic.success : colors.fg.muted }]} />
          <Text style={[styles.statusText, { color: isRunning ? colors.semantic.success : colors.fg.muted }]}>
            {isRunning ? 'Running' : proc.status === 'killed' ? 'Killed' : 'Exited'}
          </Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaText}>PID {proc.pid}</Text>
        </View>

        {/* Info cards */}
        <DetailRow label="COMMAND" value={proc.command} mono />
        <DetailRow label="STARTED" value={`${formatTime(proc.startTime)} · ${formatUptime(proc.startTime)} ago`} />
        <DetailRow label="WORKING DIR" value={proc.cwd} mono />

        {/* Output */}
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

// ----------------------------------------------------------
// Spawn Form
// ----------------------------------------------------------

function SpawnForm({ onSpawn, onCancel }: { onSpawn: (cmd: string, path: string, args: string) => void; onCancel: () => void }) {
  const [command, setCommand] = useState('');
  const [path, setPath] = useState('');
  const [args, setArgs] = useState('');

  const handleSpawn = useCallback(() => {
    if (!command.trim()) return;
    onSpawn(command.trim(), path.trim(), args.trim());
    setCommand('');
    setPath('');
    setArgs('');
  }, [command, path, args, onSpawn]);

  return (
    <View style={styles.spawnForm}>
      <View style={styles.spawnField}>
        <Text style={styles.spawnIcon}>{'>'}_</Text>
        <TextInput
          style={styles.spawnInput}
          value={command}
          onChangeText={setCommand}
          placeholder="command... (e.g. node, npm, python)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          autoFocus
        />
      </View>
      <View style={styles.spawnField}>
        <TextInput
          style={[styles.spawnInput, { paddingLeft: spacing[3] }]}
          value={path}
          onChangeText={setPath}
          placeholder="path... (optional absolute path, default current dir)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View style={styles.spawnField}>
        <TextInput
          style={[styles.spawnInput, { paddingLeft: spacing[3] }]}
          value={args}
          onChangeText={setArgs}
          placeholder="arguments... (e.g. run dev --port 3000)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSpawn}
        />
      </View>
      <View style={styles.spawnButtons}>
        <Pressable style={[styles.spawnBtn, styles.spawnBtnCancel]} onPress={onCancel}>
          <Text style={styles.spawnBtnCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.spawnBtn, styles.spawnBtnSpawn, !command.trim() && styles.spawnBtnDisabled]}
          onPress={handleSpawn}
          disabled={!command.trim()}
        >
          <Text style={styles.spawnBtnSpawnText}>Spawn</Text>
        </Pressable>
      </View>
    </View>
  );
}

// ----------------------------------------------------------
// Main Panel
// ----------------------------------------------------------

function ProcessesPanel({ instanceId, isActive }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [processes, setProcesses] = useState<ManagedProcess[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0); // for uptime re-render

  // Subscribe to process events
  useEffect(() => {
    if (connectionState !== 'connected') return;

    const unsub = staviClient.subscribe(
      'subscribeProcessEvents',
      {},
      (event: any) => {
        if (event.type === 'snapshot') {
          setProcesses((prev) => {
            const existing = prev.find((p) => p.id === event.process.id);
            if (existing) {
              return prev.map((p) => p.id === event.process.id ? { ...p, ...event.process } : p);
            }
            return [...prev, event.process];
          });
        } else if (event.type === 'started') {
          setProcesses((prev) => [...prev, event.process]);
        } else if (event.type === 'output') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, output: p.output + event.data } : p),
          );
        } else if (event.type === 'exited') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, status: 'exited' } : p),
          );
        } else if (event.type === 'killed') {
          setProcesses((prev) => prev.filter((p) => p.id !== event.id));
          setSelectedId((prev) => (prev === event.id ? null : prev));
        } else if (event.type === 'outputCleared') {
          setProcesses((prev) =>
            prev.map((p) => p.id === event.id ? { ...p, output: '' } : p),
          );
        } else if (event.type === 'removed') {
          setProcesses((prev) => prev.filter((p) => p.id !== event.id));
        }
      },
      (err) => console.error('[Processes] Subscription error:', err),
    );

    return unsub;
  }, [connectionState]);

  // Uptime ticker
  useEffect(() => {
    if (!isActive) return;
    const timer = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(timer);
  }, [isActive]);

  // Clear on disconnect
  useEffect(() => {
    if (connectionState !== 'connected') {
      setProcesses([]);
      setSelectedId(null);
    }
  }, [connectionState]);

  const handleSpawn = useCallback(async (command: string, path: string, args: string) => {
    if (staviClient.getState() !== 'connected') return;
    setShowSpawnForm(false);
    setLoading(true);
    try {
      await staviClient.request('process.spawn', {
        command,
        cwd: path || '.',
        args: args ? args.split(/\s+/) : [],
      });
    } catch (err: any) {
      Alert.alert('Spawn Failed', err?.message ?? 'Could not start process');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleKill = useCallback(async (id: string) => {
    try {
      await staviClient.request('process.kill', { id });
    } catch (err: any) {
      Alert.alert('Kill Failed', err?.message ?? 'Could not kill process');
    }
  }, []);

  const handleClearOutput = useCallback(async (id: string) => {
    try {
      await staviClient.request('process.clearOutput', { id });
    } catch { /* ignore */ }
  }, []);

  const handleRemove = useCallback(async (id: string) => {
    try {
      await staviClient.request('process.remove', { id });
      if (selectedId === id) setSelectedId(null);
    } catch { /* ignore */ }
  }, [selectedId]);

  // Detail view
  const selected = selectedId ? processes.find((p) => p.id === selectedId) : null;
  if (selected) {
    return (
      <ProcessDetail
        process={selected}
        onBack={() => setSelectedId(null)}
        onKill={handleKill}
        onClearOutput={handleClearOutput}
      />
    );
  }

  const runningCount = processes.filter((p) => p.status === 'running').length;

  if (connectionState !== 'connected') {
    return (
      <View style={styles.centered}>
        <ListTree size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Connect to a server to manage processes</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Spawn form (shown when + tapped) */}
      {showSpawnForm && (
        <SpawnForm
          onSpawn={handleSpawn}
          onCancel={() => setShowSpawnForm(false)}
        />
      )}

      {/* Process list */}
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
        />
      )}

      {/* Bottom status bar */}
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
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  emptyIcon: {
    fontSize: 40,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
    opacity: 0.4,
  },
  emptyTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
  },
  emptySubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },

  // Spawn form
  spawnForm: {
    backgroundColor: colors.bg.raised,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  spawnField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    minHeight: 48,
  },
  spawnIcon: {
    width: 40,
    textAlign: 'center',
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
  spawnInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    paddingRight: spacing[3],
    paddingVertical: spacing[3],
    fontFamily: typography.fontFamily.mono,
  },
  spawnButtons: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[3],
  },
  spawnBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spawnBtnCancel: {
    backgroundColor: colors.bg.active,
  },
  spawnBtnSpawn: {
    backgroundColor: colors.accent.primary,
  },
  spawnBtnDisabled: {
    opacity: 0.4,
  },
  spawnBtnCancelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  spawnBtnSpawnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },

  // Process list
  listContent: {
    paddingVertical: spacing[1],
  },
  processRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  processRowPressed: {
    backgroundColor: colors.bg.active,
  },
  processDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  processCommand: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.mono,
  },
  processMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },

  // Bottom bar
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    gap: spacing[2],
  },
  bottomCount: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  bottomDot: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  bottomRunning: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
  bottomIconBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Detail view
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    height: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    gap: spacing[2],
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    flex: 1,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.mono,
  },
  iconBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailBody: {
    padding: spacing[4],
    gap: spacing[3],
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: spacing[1],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
  metaDot: {
    color: colors.fg.muted,
  },
  metaText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
  detailRow: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
    padding: spacing[4],
    gap: spacing[1],
  },
  detailLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    letterSpacing: 0.5,
  },
  detailValue: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
  },
  detailValueMono: {
    fontFamily: typography.fontFamily.mono,
  },
  outputCard: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
    overflow: 'hidden',
    flex: 1,
    minHeight: 200,
  },
  outputHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  outputLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    letterSpacing: 0.5,
  },
  outputActions: {
    flexDirection: 'row',
    gap: spacing[4],
  },
  outputScroll: {
    maxHeight: 400,
  },
  outputText: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    color: colors.fg.secondary,
    lineHeight: 18,
    padding: spacing[3],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
});
