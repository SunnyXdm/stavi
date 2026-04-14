// WHAT: Plugin navigation bar — shows workspace-scoped plugin tabs + Tools button.
// WHY:  Phase 2 splits plugins by scope; server plugins no longer appear as tabs here.
//       The Tools button opens ServerToolsSheet for server-scoped plugins.
// HOW:  Reads workspace-scope definitions from plugin-registry. Tools button is shown
//       when there are server-scoped plugins registered and a serverId is available.
// SEE:  apps/mobile/src/stores/plugin-registry.ts, apps/mobile/src/components/ServerToolsSheet.tsx

import React, { useCallback, useMemo, useState } from 'react';
import { View, Pressable, Text, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Wrench } from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { ServerToolsSheet } from './ServerToolsSheet';
import { colors, typography, spacing } from '../theme';
import type { WorkspacePluginDefinition } from '@stavi/shared';

interface PluginBottomBarProps {
  onHeightChange?: (height: number) => void;
  onCreateInstance?: (pluginId: string) => void;
  sessionId?: string;
  serverId?: string;
}

export function PluginBottomBar({ onHeightChange, onCreateInstance, sessionId, serverId }: PluginBottomBarProps) {
  const insets = useSafeAreaInsets();
  const [showToolsSheet, setShowToolsSheet] = useState(false);

  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const openTab = usePluginRegistry((s) => s.openTab);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);

  // Only workspace-scoped plugins with a navOrder appear in the bottom bar
  const navItems = useMemo(() => {
    return Object.values(definitions)
      .filter((d): d is WorkspacePluginDefinition & { navOrder: number } =>
        d.scope === 'workspace' && d.navOrder != null,
      )
      .sort((a, b) => a.navOrder - b.navOrder);
  }, [definitions]);

  // Whether any server-scoped plugins exist (drives Tools button visibility)
  const hasServerPlugins = useMemo(
    () => Object.values(definitions).some((d) => d.scope === 'server'),
    [definitions],
  );

  const activePluginId = useMemo(() => {
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    return activeTab?.pluginId ?? null;
  }, [openTabs, activeTabId]);

  const handleNavPress = useCallback(
    (pluginId: string) => {
      const def = definitions[pluginId];
      if (def?.allowMultipleInstances) {
        const existingTab = openTabs.find((t) => t.pluginId === pluginId);
        if (existingTab) {
          setActiveTab(existingTab.id, sessionId);
        } else {
          onCreateInstance?.(pluginId);
        }
      } else {
        openTab(pluginId, undefined, sessionId);
      }
    },
    [openTab, setActiveTab, definitions, openTabs, onCreateInstance, sessionId],
  );

  const barHeight = 56 + insets.bottom;

  React.useEffect(() => {
    onHeightChange?.(barHeight);
  }, [barHeight, onHeightChange]);

  return (
    <>
      <View style={[styles.container, { paddingBottom: insets.bottom, height: barHeight }]}>
        {/* Workspace plugin nav items */}
        {navItems.map((def) => {
          const isActive = activePluginId === def.id;
          const Icon = def.icon;

          return (
            <Pressable
              key={def.id}
              style={styles.navItem}
              onPress={() => handleNavPress(def.id)}
            >
              <Icon size={22} color={isActive ? colors.accent.primary : colors.fg.tertiary} />
              <Text style={[styles.navLabel, isActive && styles.navLabelActive]} numberOfLines={1}>
                {def.navLabel ?? def.name}
              </Text>
            </Pressable>
          );
        })}

        {/* Tools button — opens server-scoped plugins sheet */}
        {hasServerPlugins && serverId && (
          <Pressable style={styles.navItem} onPress={() => setShowToolsSheet(true)}>
            <Wrench size={22} color={colors.fg.tertiary} />
            <Text style={styles.navLabel}>Tools</Text>
          </Pressable>
        )}
      </View>

      {serverId && (
        <ServerToolsSheet
          visible={showToolsSheet}
          serverId={serverId}
          onClose={() => setShowToolsSheet(false)}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    backgroundColor: colors.bg.raised,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[2],
    gap: 2,
  },
  navLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
  },
  navLabelActive: {
    color: colors.accent.primary,
  },
});
