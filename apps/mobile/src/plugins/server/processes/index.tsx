// WHAT: Server-scoped Processes panel for spawn/inspect/kill operations.
// WHY:  Phase 2 moves process tooling out of workspace tabs into server-scoped tools.
// HOW:  Reads process snapshots from server-plugins-store and executes actions through
//       getClientForServer(serverId) without opening extra subscriptions.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, apps/mobile/src/components/ServerToolsSheet.tsx

import React, { useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { ListTree, Play, Square } from 'lucide-react-native';
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useServerPluginsStore } from '../../../stores/server-plugins-store';
import { colors, spacing, typography } from '../../../theme';

export function ProcessesPanel({ serverId }: ServerPluginPanelProps) {
  const processes = useServerPluginsStore((state) => state.getProcesses(serverId));
  const status = useConnectionStore((state) => state.getStatusForServer(serverId));
  const [command, setCommand] = useState('');

  const runningCount = useMemo(
    () => processes.filter((process) => process.status === 'running').length,
    [processes],
  );

  const handleSpawn = async () => {
    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client || client.getState() !== 'connected') return;
    const trimmed = command.trim();
    if (!trimmed) return;

    const [cmd, ...args] = trimmed.split(/\s+/);
    await client.request('process.spawn', {
      command: cmd,
      args,
      cwd: '.',
    });
    setCommand('');
  };

  const handleKill = async (id: string) => {
    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client || client.getState() !== 'connected') return;
    await client.request('process.kill', { id });
  };

  if (status !== 'connected') {
    return (
      <View style={styles.centered}>
        <ListTree size={28} color={colors.fg.muted} />
        <Text style={styles.meta}>Connect to view running processes.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.heading}>Processes</Text>
        <Text style={styles.meta}>{runningCount} running</Text>
      </View>

      <View style={styles.spawnRow}>
        <TextInput
          style={styles.input}
          value={command}
          onChangeText={setCommand}
          placeholder="bun src/server.ts"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={() => {
            void handleSpawn();
          }}
        />
        <Pressable style={styles.spawnButton} onPress={() => void handleSpawn()}>
          <Play size={14} color={colors.fg.onAccent} />
        </Pressable>
      </View>

      <FlatList
        data={processes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <View style={styles.rowTextWrap}>
              <Text style={styles.command} numberOfLines={1}>{item.command}</Text>
              <Text style={styles.meta} numberOfLines={1}>pid {item.pid} · {item.status}</Text>
            </View>
            <Pressable style={styles.killButton} onPress={() => void handleKill(item.id)}>
              <Square size={12} color={colors.semantic.error} />
            </Pressable>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.meta}>No managed processes yet.</Text>}
      />
    </View>
  );
}

export const processesPlugin: ServerPluginDefinition = {
  id: 'processes',
  name: 'Processes',
  description: 'Spawn and manage running processes',
  scope: 'server',
  kind: 'extra',
  icon: ListTree,
  component: ProcessesPanel,
  navOrder: 0,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, padding: spacing[4], gap: spacing[3] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
  spawnRow: { flexDirection: 'row', gap: spacing[2] },
  input: {
    flex: 1,
    backgroundColor: colors.bg.input,
    color: colors.fg.primary,
    borderRadius: 8,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  spawnButton: {
    width: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.accent.primary,
  },
  list: { gap: spacing[2], paddingBottom: spacing[6] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.bg.raised,
    borderRadius: 8,
    padding: spacing[3],
  },
  rowTextWrap: { flex: 1, marginRight: spacing[2] },
  command: { fontFamily: typography.fontFamily.mono, color: colors.fg.primary, fontSize: typography.fontSize.sm },
  meta: { color: colors.fg.tertiary, fontSize: typography.fontSize.xs },
  killButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: colors.bg.input,
  },
});
