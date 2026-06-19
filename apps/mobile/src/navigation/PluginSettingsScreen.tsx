// WHAT: PluginSettingsScreen — dedicated page for one plugin's settings.
// WHY:  Settings rendered every plugin's schema inline as accordions, which
//       got cluttered fast (the user compared it unfavorably to the Servers
//       flow). Each plugin row now navigates here instead.
// HOW:  Route param pluginId → definition from the plugin registry →
//       SettingsRenderer with that plugin's declarative schema.
// SEE:  apps/mobile/src/navigation/SettingsScreen.tsx (the list of rows),
//       apps/mobile/src/components/SettingsRenderer.tsx

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import { ArrowLeft } from 'lucide-react-native';
import type { AppNavigation, AppRoute } from './types';
import { usePluginRegistry } from '../stores/plugin-registry';
import { SettingsRenderer } from '../components/SettingsRenderer';
import { useTheme } from '../theme';
import { typography, spacing } from '../theme';

export function PluginSettingsScreen() {
  const navigation = useNavigation<AppNavigation>();
  const route = useRoute<AppRoute<'PluginSettings'>>();
  const { pluginId } = route.params;
  const { colors } = useTheme();
  const def = usePluginRegistry((s) => s.definitions[pluginId]);

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg.base },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      gap: spacing[2],
    },
    backButton: { padding: spacing[2] },
    headerTitle: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    scroll: { paddingBottom: spacing[8] },
    empty: { padding: spacing[6], alignItems: 'center' },
    emptyText: { fontSize: typography.fontSize.sm, color: colors.fg.muted },
  }), [colors]);

  return (
    <SafeAreaView style={s.root} edges={['top']}>
      <View style={s.header}>
        <Pressable style={s.backButton} onPress={() => navigation.goBack()} hitSlop={8}>
          <ArrowLeft size={20} color={colors.fg.secondary} />
        </Pressable>
        <Text style={s.headerTitle}>{def?.name ?? 'Plugin'} Settings</Text>
      </View>
      <ScrollView contentContainerStyle={s.scroll}>
        {def?.settings ? (
          // SettingsRenderer brings its own section cards — no extra wrapper.
          <SettingsRenderer pluginId={pluginId} schema={def.settings} />
        ) : (
          <View style={s.empty}>
            <Text style={s.emptyText}>This plugin has no settings.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
