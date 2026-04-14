// WHAT: System-wide search stub. Placeholder until Phase 7.
// WHY:  Server tools include a dedicated System Search panel, even before implementation.
// HOW:  Server-scoped plugin definition using the Phase 2 discriminated union shape.
// SEE:  apps/mobile/src/plugins/load.ts, packages/shared/src/plugin-types.ts

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';

const SystemSearchPanel = (_props: ServerPluginPanelProps) => (
  <View style={styles.container}>
    <Text style={styles.label}>Coming in Phase 7</Text>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  label: {
    color: '#888',
    fontSize: 14,
  },
});

export const systemSearchPlugin: ServerPluginDefinition = {
  id: 'system-search',
  name: 'System Search',
  description: 'Search across the entire host machine.',
  scope: 'server',
  kind: 'extra',
  icon: Search,
  component: SystemSearchPanel,
};
