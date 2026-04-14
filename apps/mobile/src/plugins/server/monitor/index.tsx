// WHAT: Server-scoped Monitor panel for system stats.
// WHY:  CPU/memory/disk visibility is host-level telemetry shared across sessions.
// HOW:  Uses server-plugins-store monitor stats keyed by serverId.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, apps/mobile/src/components/ServerToolsSheet.tsx

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Activity } from 'lucide-react-native';
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useServerPluginsStore } from '../../../stores/server-plugins-store';
import { colors, spacing, typography } from '../../../theme';

function MonitorPanel({ serverId }: ServerPluginPanelProps) {
  const stats = useServerPluginsStore((state) => state.getMonitorStats(serverId));
  const status = useConnectionStore((state) => state.getStatusForServer(serverId));

  if (status !== 'connected') {
    return (
      <View style={styles.centered}>
        <Activity size={28} color={colors.fg.muted} />
        <Text style={styles.meta}>Connect to view server metrics.</Text>
      </View>
    );
  }

  if (!stats) {
    return (
      <View style={styles.centered}>
        <Text style={styles.meta}>Loading metrics...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>System Monitor</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Disk</Text>
        <Text style={styles.value}>{stats.disk.used} / {stats.disk.size}</Text>
        <Text style={styles.meta}>{stats.disk.usePercent} used · {stats.disk.avail} available</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Memory (raw)</Text>
        <Text style={styles.meta}>{stats.memRaw.trim() || 'No memory sample yet.'}</Text>
      </View>
    </View>
  );
}

export const monitorPlugin: ServerPluginDefinition = {
  id: 'monitor',
  name: 'Monitor',
  description: 'System resource monitoring',
  scope: 'server',
  kind: 'extra',
  icon: Activity,
  component: MonitorPanel,
  navOrder: 2,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, padding: spacing[4], gap: spacing[3] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  heading: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
  card: {
    backgroundColor: colors.bg.raised,
    borderRadius: 8,
    padding: spacing[3],
    gap: spacing[1],
  },
  label: { color: colors.fg.secondary, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold },
  value: { color: colors.fg.primary, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono },
  meta: { color: colors.fg.tertiary, fontSize: typography.fontSize.xs },
});
