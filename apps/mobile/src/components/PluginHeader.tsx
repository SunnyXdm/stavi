// ============================================================
// PluginHeader — top bar showing active plugin name + instance tabs
// ============================================================
// Phase 8e: Hamburger menu button removed (sidebar is persistent, no drawer).
// Shows active plugin name + multi-instance tabs + add-instance button.
// The onOpenDrawer prop is kept as optional for backward compat during transition
// but the hamburger icon is no longer rendered.

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, FlatList } from 'react-native';
import { Plus, X } from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { colors, typography, spacing, radii } from '../theme';
import type { PluginInstance } from '@stavi/shared';

interface PluginHeaderProps {
  /** @deprecated Phase 8e — sidebar is persistent. No longer used. */
  onOpenDrawer?: () => void;
  onCreateInstance?: () => void;
  sessionId?: string;
}

function instanceDisplayTitle(instance: PluginInstance, index: number): string {
  const dir = instance.initialState?.directory as string | undefined;
  const dirBasename = dir ? dir.split('/').filter(Boolean).pop() || dir : null;
  const isDefaultTitle = instance.title === 'AI' || instance.title === 'Editor';
  if (!isDefaultTitle) {
    return dirBasename ?? instance.title;
  }
  return dirBasename ?? `${instance.title} ${index + 1}`;
}

export const PluginHeader = memo(function PluginHeader({
  onCreateInstance,
  sessionId,
}: PluginHeaderProps) {
  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);
  const closeTab = usePluginRegistry((s) => s.closeTab);
  const canCloseTab = usePluginRegistry((s) => s.canCloseTab);

  const activeTab = useMemo(
    () => openTabs.find((t) => t.id === activeTabId),
    [openTabs, activeTabId],
  );
  const activePluginId = activeTab?.pluginId ?? null;
  const activePluginName = activePluginId ? (definitions[activePluginId]?.name ?? '') : '';

  const pluginInstances = useMemo(() => {
    if (!activePluginId) return [];
    return openTabs.filter((t) => t.pluginId === activePluginId);
  }, [openTabs, activePluginId]);

  const allowMultipleInstances = activePluginId
    ? (definitions[activePluginId]?.allowMultipleInstances ?? false)
    : false;

  const showTabs = allowMultipleInstances && pluginInstances.length >= 1;

  const handleTabPress = useCallback(
    (instanceId: string) => {
      setActiveTab(instanceId, sessionId);
    },
    [setActiveTab, sessionId],
  );

  const handleCloseTab = useCallback(
    (instanceId: string) => {
      closeTab(instanceId, sessionId);
    },
    [closeTab, sessionId],
  );

  const renderTab = useCallback(
    ({ item, index }: { item: PluginInstance; index: number }) => {
      const isActive = item.id === activeTabId;
      const title = instanceDisplayTitle(item, index);
      const closeable = canCloseTab(item.id, sessionId);

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
    [activeTabId, canCloseTab, handleTabPress, handleCloseTab, sessionId],
  );

  const keyExtractor = useCallback((item: PluginInstance) => item.id, []);

  return (
    <View style={styles.container}>
      {/* Content area — title or multi-instance tab strip */}
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
  titleContainer: {
    flex: 1,
    paddingHorizontal: spacing[4],
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
