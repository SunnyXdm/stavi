// WHAT: System-wide search stub. Placeholder until Phase 7.
// WHY:  Phase 0 introduces the new `plugins/server/` directory; this stub populates
//       it so `load.ts` has something to register under the server scope folder.
// HOW:  Uses the current (pre-Phase-2) `PluginDefinition` shape — no `scope` field.
//       Phase 2 Part B upgrades this file along with every other plugin definition.
// SEE:  apps/mobile/src/plugins/load.ts, packages/shared/src/plugin-types.ts

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';

// TODO(Phase 2): add `scope: 'server'` when PluginDefinition becomes a discriminated union.

const SystemSearchPanel = (_props: PluginPanelProps) => (
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

export const systemSearchPlugin: PluginDefinition = {
  id: 'system-search',
  name: 'System Search',
  description: 'Search across the entire host machine.',
  kind: 'extra',
  icon: Search,
  component: SystemSearchPanel,
};
