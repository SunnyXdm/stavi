// ============================================================
// PluginHeader — top bar with hamburger + per-plugin instance tabs
// ============================================================
// Shows tabs for all open instances of the ACTIVE plugin.
// [Hamburger] [Instance 1] [Instance 2] ... [+ new]
// Reads directly from plugin-registry (not SessionRegistry).

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { Menu, Plus, X } from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { colors, typography, spacing, radii } from '../theme';
import type { PluginInstance } from '@stavi/shared';

interface PluginHeaderProps {
  onOpenDrawer: () => void;
  /** Called when user presses "+" for a multi-instance plugin */
  onCreateInstance?: () => void;
}

function instanceDisplayTitle(instance: PluginInstance, index: number): string {
  // Use directory name from initialState if available
  const dir = instance.initialState?.directory as string | undefined;
  if (dir) {
    const parts = dir.split('/').filter(Boolean);
    return parts[parts.length - 1] || dir;
  }
  return `${instance.title} ${index + 1}`;
}

export const PluginHeader = memo(function PluginHeader({
  onOpenDrawer,
  onCreateInstance,
}: PluginHeaderProps) {
  const openTabs = usePluginRegistry((s) => s.openTabs);
  const activeTabId = usePluginRegistry((s) => s.activeTabId);
  const definitions = usePluginRegistry((s) => s.definitions);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);
  const closeTab = usePluginRegistry((s) => s.closeTab);
  const canCloseTab = usePluginRegistry((s) => s.canCloseTab);

  // Active plugin
  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId),
    [openTabs, activeTabId],
  );
  const activePluginId = activeTab?.pluginId ?? null;
  const activePluginName = activePluginId ? (definitions[activePluginId]?.name ?? '') : '';

  // All instances of the active plugin
  const pluginInstances = useMemo(() => {
    if (!activePluginId) return [];
    return openTabs.filter((t) => t.pluginId === activePluginId);
  }, [openTabs, activePluginId]);

  // Whether this plugin supports multiple instances
  const allowMultipleInstances = activePluginId
    ? (definitions[activePluginId]?.allowMultipleInstances ?? false)
    : false;

  // Show tabs only when plugin supports multiple instances
  const showTabs = allowMultipleInstances && pluginInstances.length >= 1;

  const handleTabPress = useCallback(
    (instanceId: string) => {
      setActiveTab(instanceId);
    },
    [setActiveTab],
  );

  const handleCloseTab = useCallback(
    (instanceId: string) => {
      closeTab(instanceId);
    },
    [closeTab],
  );

  const renderTab = useCallback(
    ({ item, index }: { item: PluginInstance; index: number }) => {
      const isActive = item.id === activeTabId;
      const title = instanceDisplayTitle(item, index);
      const closeable = canCloseTab(item.id);

      return (
        <Pressable
          style={[styles.tab, isActive && styles.tabActive]}
          onPress={() => handleTabPress(item.id)}
        >
          <Text
            style={[styles.tabText, isActive && styles.tabTextActive]}
            numberOfLines={1}
          >
            {title}
          </Text>
          {closeable && (
            <Pressable
              style={styles.tabClose}
              onPress={() => handleCloseTab(item.id)}
              hitSlop={6}
            >
              <X size={10} color={isActive ? colors.fg.secondary : colors.fg.muted} />
            </Pressable>
          )}
        </Pressable>
      );
    },
    [activeTabId, canCloseTab, handleTabPress, handleCloseTab],
  );

  const keyExtractor = useCallback((item: PluginInstance) => item.id, []);

  return (
    <View style={styles.container}>
      {/* Hamburger menu */}
      <Pressable style={styles.hamburger} onPress={onOpenDrawer} hitSlop={8}>
        <Menu size={20} color={colors.fg.secondary} />
      </Pressable>

      {/* Content area */}
      {showTabs ? (
        <FlatList
          data={pluginInstances}
          renderItem={renderTab}
          keyExtractor={keyExtractor}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScroll}
          style={styles.tabList}
        />
      ) : (
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {activePluginName}
          </Text>
        </View>
      )}

      {/* Add new instance button (only for multi-instance plugins) */}
      {allowMultipleInstances && onCreateInstance && (
        <Pressable style={styles.addButton} onPress={onCreateInstance} hitSlop={6}>
          <Plus size={18} color={colors.fg.secondary} />
        </Pressable>
      )}
    </View>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 44,
    backgroundColor: colors.bg.raised,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  hamburger: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    paddingHorizontal: spacing[2],
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  tabList: {
    flex: 1,
  },
  tabScroll: {
    alignItems: 'center',
    paddingHorizontal: spacing[1],
    gap: spacing[1],
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    borderRadius: radii.sm,
    height: 28,
    maxWidth: 140,
  },
  tabActive: {
    backgroundColor: colors.bg.active,
  },
  tabText: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.muted,
  },
  tabTextActive: {
    color: colors.fg.primary,
  },
  tabClose: {
    width: 14,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.divider,
  },
});
