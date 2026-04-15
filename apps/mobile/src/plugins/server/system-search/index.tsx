// WHAT: System-wide search stub. Placeholder until Phase 7c.
// WHY:  Phase 7b scope is token alignment only — real implementation is Phase 7c.
//       This file is included in the 7b sweep to eliminate hardcoded '#888' and
//       the raw padding: 24.
// HOW:  Imports theme tokens for color, spacing, and font size.
// SEE:  plans/07-final-phases.md §Phase 7c for the real implementation plan,
//       theme/tokens.ts

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';
import { colors, spacing, typography } from '../../../theme';

const SystemSearchPanel = (_props: ServerPluginPanelProps) => (
  <View style={styles.container}>
    <Text style={styles.label}>Coming in Phase 7c</Text>
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing[6] },
  label: { color: colors.fg.muted, fontSize: typography.fontSize.sm },
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
