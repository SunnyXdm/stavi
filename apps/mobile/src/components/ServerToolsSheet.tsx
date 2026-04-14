// WHAT: Bottom sheet showing server-scoped plugins (Processes, Ports, Monitor, System Search).
// WHY:  Server plugins are not workspace-tab plugins; they need a separate sheet that can
//       be opened from both SessionsHomeScreen and WorkspaceScreen simultaneously while
//       sharing a single underlying WebSocket subscription (ref-counted via server-plugins-store).
// HOW:  Renders all ServerPluginDefinitions as tabs. Subscribes on mount, unsubscribes on unmount.
// SEE:  apps/mobile/src/stores/server-plugins-store.ts, apps/mobile/src/stores/plugin-registry.ts

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { X } from 'lucide-react-native';
import { usePluginRegistry, getPluginComponent } from '../stores/plugin-registry';
import { useServerPluginsStore } from '../stores/server-plugins-store';
import { colors, spacing, typography, radii } from '../theme';
import type { ServerPluginDefinition } from '@stavi/shared';

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface ServerToolsSheetProps {
  visible: boolean;
  serverId: string;
  onClose: () => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function ServerToolsSheet({ visible, serverId, onClose }: ServerToolsSheetProps) {
  const insets = useSafeAreaInsets();
  const definitions = usePluginRegistry((s) => s.definitions);
  const subscribeProcesses = useServerPluginsStore((s) => s.subscribeProcesses);
  const subscribePorts = useServerPluginsStore((s) => s.subscribePorts);
  const subscribeMonitor = useServerPluginsStore((s) => s.subscribeMonitor);

  // Server-scoped plugin definitions, sorted by navOrder
  const serverPlugins = useMemo(
    () =>
      Object.values(definitions)
        .filter((d): d is ServerPluginDefinition => d.scope === 'server')
        .sort((a, b) => (a.navOrder ?? 99) - (b.navOrder ?? 99)),
    [definitions],
  );

  const [activePluginId, setActivePluginId] = useState<string>('');

  // Default to first plugin
  useEffect(() => {
    if (serverPlugins.length > 0 && !activePluginId) {
      setActivePluginId(serverPlugins[0].id);
    }
  }, [serverPlugins, activePluginId]);

  // Ref-counted subscriptions: subscribe when visible, unsubscribe when hidden
  useEffect(() => {
    if (!visible || !serverId) return;
    const unsubProcesses = subscribeProcesses(serverId);
    const unsubPorts = subscribePorts(serverId);
    const unsubMonitor = subscribeMonitor(serverId);
    return () => {
      unsubProcesses();
      unsubPorts();
      unsubMonitor();
    };
  }, [visible, serverId, subscribeProcesses, subscribePorts, subscribeMonitor]);

  const handleTabPress = useCallback((pluginId: string) => {
    setActivePluginId(pluginId);
  }, []);

  const barHeight = 56 + insets.bottom;
  const instanceId = `server-tools-${serverId}`;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable style={styles.backdrop} onPress={onClose}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom }]}>
          {/* Handle */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Server Tools</Text>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <X size={18} color={colors.fg.secondary} />
            </Pressable>
          </View>

          {/* Tab bar */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.tabBar}
            contentContainerStyle={styles.tabBarContent}
          >
            {serverPlugins.map((def) => {
              const isActive = def.id === activePluginId;
              const Icon = def.icon;
              return (
                <Pressable
                  key={def.id}
                  style={[styles.tab, isActive && styles.tabActive]}
                  onPress={() => handleTabPress(def.id)}
                >
                  <Icon size={14} color={isActive ? colors.accent.primary : colors.fg.tertiary} />
                  <Text style={[styles.tabLabel, isActive && styles.tabLabelActive]}>
                    {def.navLabel ?? def.name}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Plugin panel area */}
          <View style={styles.panelArea}>
            {serverPlugins.map((def) => {
              if (def.id !== activePluginId) return null;
              const Component = getPluginComponent(def.id);
              if (!Component) return null;
              return (
                <Component
                  key={def.id}
                  scope="server"
                  instanceId={instanceId}
                  isActive
                  serverId={serverId}
                  bottomBarHeight={barHeight}
                />
              );
            })}
          </View>
        </View>
      </Pressable>
    </Modal>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.bg.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    height: '75%',
    overflow: 'hidden',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: colors.fg.muted,
    borderRadius: radii.full,
    alignSelf: 'center',
    marginTop: spacing[3],
    marginBottom: spacing[2],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  headerTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.bg.input,
  },
  tabBar: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tabBarContent: {
    paddingHorizontal: spacing[4],
    gap: spacing[1],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  tabActive: {
    borderBottomColor: colors.accent.primary,
  },
  tabLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
  },
  tabLabelActive: {
    color: colors.accent.primary,
  },
  panelArea: {
    flex: 1,
  },
});
