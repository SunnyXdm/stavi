import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Search } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, textStyles } from '../../../theme';

function SearchPanel({ instanceId, isActive }: PluginPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={textStyles.h3}>Search</Text>
      <Text style={textStyles.body}>Project-wide code search</Text>
    </View>
  );
}

export const searchPlugin: PluginDefinition = {
  id: 'search',
  name: 'Search',
  description: 'Search across all project files',
  kind: 'extra',
  icon: Search,
  component: SearchPanel,
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 24 },
});
