// WHAT: Server-scoped Ports panel.
// WHY:  Port inspection is host-level tooling and belongs in server tools, not workspace tabs.
// HOW:  Reads ports from server-plugins-store for the active serverId.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, apps/mobile/src/components/ServerToolsSheet.tsx

import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Network } from 'lucide-react-native';
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useServerPluginsStore } from '../../../stores/server-plugins-store';
import { colors, spacing, typography } from '../../../theme';

function PortsPanel({ serverId }: ServerPluginPanelProps) {
  const ports = useServerPluginsStore((state) => state.getPorts(serverId));
  const status = useConnectionStore((state) => state.getStatusForServer(serverId));

  if (status !== 'connected') {
    return (
      <View style={styles.centered}>
        <Network size={28} color={colors.fg.muted} />
        <Text style={styles.meta}>Connect to inspect listening ports.</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Listening Ports</Text>
      <FlatList
        data={ports}
        keyExtractor={(item) => `${item.port}:${item.pid}`}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <Text style={styles.port}>:{item.port}</Text>
            <Text style={styles.process} numberOfLines={1}>{item.process}</Text>
            <Text style={styles.meta}>pid {item.pid}</Text>
          </View>
        )}
        ListEmptyComponent={<Text style={styles.meta}>No listening ports found.</Text>}
      />
    </View>
  );
}

export const portsPlugin: ServerPluginDefinition = {
  id: 'ports',
  name: 'Ports',
  description: 'Inspect listening ports',
  scope: 'server',
  kind: 'extra',
  icon: Network,
  component: PortsPanel,
  navOrder: 1,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, padding: spacing[4], gap: spacing[3] },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing[2] },
  heading: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
  list: { gap: spacing[2], paddingBottom: spacing[6] },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.raised,
    borderRadius: 8,
    padding: spacing[3],
    gap: spacing[2],
  },
  port: { fontFamily: typography.fontFamily.mono, fontSize: typography.fontSize.sm, color: colors.semantic.success, width: 72 },
  process: { flex: 1, color: colors.fg.primary, fontSize: typography.fontSize.sm },
  meta: { color: colors.fg.tertiary, fontSize: typography.fontSize.xs },
});
