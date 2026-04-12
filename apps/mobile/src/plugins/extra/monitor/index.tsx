import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Activity } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, textStyles } from '../../../theme';

function MonitorPanel({ instanceId, isActive }: PluginPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={textStyles.h3}>Monitor</Text>
      <Text style={textStyles.body}>CPU, memory, disk, battery</Text>
    </View>
  );
}

export const monitorPlugin: PluginDefinition = {
  id: 'monitor',
  name: 'Monitor',
  description: 'System resource monitoring',
  kind: 'extra',
  icon: Activity,
  component: MonitorPanel,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
