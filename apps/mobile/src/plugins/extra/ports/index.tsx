import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Network } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, textStyles } from '../../../theme';

function PortsPanel({ instanceId, isActive }: PluginPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={textStyles.h3}>Ports</Text>
      <Text style={textStyles.body}>TCP port scanner</Text>
    </View>
  );
}

export const portsPlugin: PluginDefinition = {
  id: 'ports',
  name: 'Ports',
  description: 'Scan and manage network ports',
  kind: 'extra',
  icon: Network,
  component: PortsPanel,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
