// WHAT: Monitor panel — system resource stats for the active session's server.
// WHY:  Phase 9 promotes server-scoped plugins to workspace tabs.
// HOW:  scope: 'workspace' — receives WorkspacePluginPanelProps; extracts serverId from session.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, plans/09-navigation-overhaul.md §4

import React, { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Activity } from 'lucide-react-native';
import type { WorkspacePluginDefinition, WorkspacePluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useServerPluginsStore } from '../../../stores/server-plugins-store';
import { useTheme } from '../../../theme';
import { spacing, typography, radii } from '../../../theme';

function MonitorPanel({ session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base, padding: spacing[4], gap: spacing[3] },
    centered: { flex: 1, alignItems: 'center' as const, justifyContent: 'center' as const, gap: spacing[2] },
    heading: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    card: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.md,
      padding: spacing[3],
      gap: spacing[1],
    },
    label: { color: colors.fg.secondary, fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold },
    value: { color: colors.fg.primary, fontSize: typography.fontSize.sm, fontFamily: typography.fontFamily.mono },
    meta: { color: colors.fg.tertiary, fontSize: typography.fontSize.xs },
  }), [colors]);

  const serverId = session.serverId;
  const stats = useServerPluginsStore((state) => state.getMonitorStats(serverId));
  const status = useConnectionStore((state) => state.getStatusForServer(serverId));

  useEffect(() => {
    if (!serverId) return;
    const unsub = useServerPluginsStore.getState().subscribeMonitor(serverId);
    return unsub;
  }, [serverId]);

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

export const monitorPlugin: WorkspacePluginDefinition = {
  id: 'monitor',
  name: 'Monitor',
  description: 'System resource monitoring',
  scope: 'workspace',
  kind: 'extra',
  icon: Activity,
  component: MonitorPanel,
  navOrder: 2,
};

// Styles computed dynamically via useMemo — see component body.
