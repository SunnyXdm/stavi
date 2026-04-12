// ============================================================
// DrawerContent — Left sidebar with session management
// ============================================================
// Shows open plugin instances grouped by tool type.
// Reads from plugin-registry (openTabs) directly — no
// SessionRegistry indirection here.

import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Home,
  Settings,
  Search,
  Plus,
  Sparkles,
  Code2,
  SquareTerminal,
  GitBranch,
  X,
  ChevronRight,
} from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { colors, typography, spacing, radii } from '../theme';
import type { PluginInstance } from '@stavi/shared';

// ----------------------------------------------------------
// Plugin display config
// ----------------------------------------------------------

const PLUGIN_META: Record<string, { icon: typeof Sparkles; label: string; order: number }> = {
  ai: { icon: Sparkles, label: 'AI', order: 0 },
  editor: { icon: Code2, label: 'Editor', order: 1 },
  terminal: { icon: SquareTerminal, label: 'Terminal', order: 2 },
  git: { icon: GitBranch, label: 'Git', order: 3 },
};

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface DrawerContentProps {
  onClose: () => void;
  onNavigateHome: () => void;
  onNavigateSettings?: () => void;
  /** Called when user wants to create a new instance of a multi-instance plugin */
  onCreateInstance?: (pluginId: string) => void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function instanceTitle(instance: PluginInstance, index: number): string {
  const dir = instance.initialState?.directory as string | undefined;
  if (dir) {
    const parts = dir.split('/').filter(Boolean);
    return parts[parts.length - 1] || dir;
  }
  return `${instance.title} ${index + 1}`;
}

function instanceSubtitle(instance: PluginInstance): string | undefined {
  const dir = instance.initialState?.directory as string | undefined;
  return dir || undefined;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const DrawerContent = memo(function DrawerContent({
  onClose,
  onNavigateHome,
  onNavigateSettings,
  onCreateInstance,
}: DrawerContentProps) {
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');

  const openTabs = usePluginRegistry((s) => s.openTabs);
  const activeTabId = usePluginRegistry((s) => s.activeTabId);
  const definitions = usePluginRegistry((s) => s.definitions);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);
  const closeTab = usePluginRegistry((s) => s.closeTab);
  const canCloseTab = usePluginRegistry((s) => s.canCloseTab);

  // Group tabs by pluginId, sorted by PLUGIN_META order
  const sections = useMemo(() => {
    const grouped: Record<string, PluginInstance[]> = {};
    for (const tab of openTabs) {
      if (!grouped[tab.pluginId]) grouped[tab.pluginId] = [];
      grouped[tab.pluginId].push(tab);
    }

    const result = Object.entries(grouped).map(([pluginId, instances]) => {
      const meta = PLUGIN_META[pluginId];
      let filtered = instances;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        filtered = instances.filter((inst, i) => {
          const title = instanceTitle(inst, i);
          const subtitle = instanceSubtitle(inst);
          return (
            title.toLowerCase().includes(q) ||
            (subtitle?.toLowerCase().includes(q) ?? false)
          );
        });
      }
      return {
        pluginId,
        label: meta?.label ?? definitions[pluginId]?.name ?? pluginId,
        icon: meta?.icon ?? Sparkles,
        order: meta?.order ?? 99,
        instances: filtered,
        allowMultipleInstances: definitions[pluginId]?.allowMultipleInstances ?? false,
      };
    });

    return result.sort((a, b) => a.order - b.order);
  }, [openTabs, definitions, searchQuery]);

  const handleSelectInstance = useCallback(
    (instanceId: string) => {
      setActiveTab(instanceId);
      onClose();
    },
    [setActiveTab, onClose],
  );

  const handleCloseInstance = useCallback(
    (instanceId: string) => {
      closeTab(instanceId);
    },
    [closeTab],
  );

  const handleCreateInstance = useCallback(
    (pluginId: string) => {
      onCreateInstance?.(pluginId);
      onClose();
    },
    [onCreateInstance, onClose],
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Stavi</Text>
        <Pressable style={styles.closeButton} onPress={onClose} hitSlop={8}>
          <X size={20} color={colors.fg.muted} />
        </Pressable>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <Search size={16} color={colors.fg.muted} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search instances..."
          placeholderTextColor={colors.fg.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          autoCapitalize="none"
          autoCorrect={false}
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} hitSlop={8}>
            <X size={14} color={colors.fg.muted} />
          </Pressable>
        )}
      </View>

      {/* Instances grouped by tool */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {sections.map((section) => (
          <View key={section.pluginId} style={styles.section}>
            {/* Section header */}
            <View style={styles.sectionHeader}>
              <section.icon size={16} color={colors.fg.tertiary} />
              <Text style={styles.sectionLabel}>{section.label}</Text>
              <Text style={styles.sectionCount}>{section.instances.length}</Text>
              {section.allowMultipleInstances && onCreateInstance && (
                <Pressable
                  style={styles.sectionAdd}
                  onPress={() => handleCreateInstance(section.pluginId)}
                  hitSlop={6}
                >
                  <Plus size={14} color={colors.accent.primary} />
                </Pressable>
              )}
            </View>

            {/* Instance rows */}
            {section.instances.map((instance, idx) => {
              const isActive = instance.id === activeTabId;
              const title = instanceTitle(instance, idx);
              const subtitle = instanceSubtitle(instance);
              const closeable = canCloseTab(instance.id);

              return (
                <Pressable
                  key={instance.id}
                  style={[styles.sessionItem, isActive && styles.sessionItemActive]}
                  onPress={() => handleSelectInstance(instance.id)}
                >
                  <View style={styles.sessionDot}>
                    <View
                      style={[
                        styles.dot,
                        { backgroundColor: isActive ? colors.accent.primary : colors.fg.muted },
                      ]}
                    />
                  </View>
                  <View style={styles.sessionText}>
                    <Text
                      style={[styles.sessionTitle, isActive && styles.sessionTitleActive]}
                      numberOfLines={1}
                    >
                      {title}
                    </Text>
                    {subtitle && (
                      <Text style={styles.sessionSubtitle} numberOfLines={1}>
                        {subtitle}
                      </Text>
                    )}
                  </View>
                  {closeable ? (
                    <Pressable
                      onPress={() => handleCloseInstance(instance.id)}
                      hitSlop={6}
                      style={styles.closeInstanceButton}
                    >
                      <X size={12} color={colors.fg.muted} />
                    </Pressable>
                  ) : (
                    <ChevronRight size={14} color={colors.fg.muted} />
                  )}
                </Pressable>
              );
            })}

            {section.instances.length === 0 && (
              <Text style={styles.emptySection}>No instances</Text>
            )}
          </View>
        ))}

        {sections.length === 0 && (
          <View style={styles.emptySections}>
            <Text style={styles.emptyText}>No active instances</Text>
          </View>
        )}
      </ScrollView>

      {/* Bottom navigation */}
      <View style={[styles.bottomNav, { paddingBottom: insets.bottom + spacing[2] }]}>
        <Pressable style={styles.navItem} onPress={onNavigateHome}>
          <Home size={18} color={colors.fg.secondary} />
          <Text style={styles.navLabel}>Servers</Text>
        </Pressable>
        {onNavigateSettings && (
          <Pressable style={styles.navItem} onPress={onNavigateSettings}>
            <Settings size={18} color={colors.fg.secondary} />
            <Text style={styles.navLabel}>Settings</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
  },
  closeButton: {
    padding: spacing[1],
  },

  // Search
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: spacing[4],
    marginVertical: spacing[3],
    backgroundColor: colors.bg.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    height: 36,
    gap: spacing[2],
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    padding: 0,
    fontFamily: typography.fontFamily.sans,
  },

  // Scroll
  scrollArea: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing[4],
  },

  // Section
  section: {
    marginBottom: spacing[2],
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
  },
  sectionLabel: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.tertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sectionCount: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
  sectionAdd: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.sm,
  },

  // Instance rows
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[2],
    marginHorizontal: spacing[2],
    borderRadius: radii.md,
  },
  sessionItemActive: {
    backgroundColor: colors.bg.active,
  },
  sessionDot: {
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  sessionText: {
    flex: 1,
  },
  sessionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  sessionTitleActive: {
    color: colors.fg.primary,
  },
  sessionSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    marginTop: 1,
  },
  closeInstanceButton: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptySection: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    fontStyle: 'italic',
    marginLeft: spacing[6],
  },
  emptySections: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing[10],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },

  // Bottom nav
  bottomNav: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingTop: spacing[2],
    paddingHorizontal: spacing[4],
    gap: spacing[1],
  },
  navItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[2],
    borderRadius: radii.md,
  },
  navLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
});
