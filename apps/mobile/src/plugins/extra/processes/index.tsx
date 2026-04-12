import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { ListTree } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, textStyles } from '../../../theme';

function ProcessesPanel({ instanceId, isActive }: PluginPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={textStyles.h3}>Processes</Text>
      <Text style={textStyles.body}>Running process manager</Text>
    </View>
  );
}

export const processesPlugin: PluginDefinition = {
  id: 'processes',
  name: 'Processes',
  description: 'View and manage running processes',
  kind: 'extra',
  icon: ListTree,
  component: ProcessesPanel,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
