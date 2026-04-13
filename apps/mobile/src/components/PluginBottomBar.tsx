// ============================================================
// PluginBottomBar — plugin-driven navigation bar
// ============================================================
// Design decisions:
// - Uses Zustand store directly (NOT AsyncStorage polling)
// - Nav items are driven by plugin definitions, not hardcoded
// - No innerApi hack, no setTimeout(0), no stateRef workaround
// - Clean reactive data flow

import React, { useCallback, useMemo, useState } from 'react';
import { View, Pressable, Text, StyleSheet, Modal, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePluginRegistry } from '../stores/plugin-registry';
import { colors, typography, spacing, radii } from '../theme';
import type { PluginDefinition } from '@stavi/shared';

// Special "Tabs" icon (we'll use a grid icon)
import { LayoutGrid } from 'lucide-react-native';

interface PluginBottomBarProps {
  onHeightChange?: (height: number) => void;
  /** Called when tapping a multi-instance plugin with no existing instances */
  onCreateInstance?: (pluginId: string) => void;
}

export function PluginBottomBar({ onHeightChange, onCreateInstance }: PluginBottomBarProps) {
  const insets = useSafeAreaInsets();
  const [showTabsSheet, setShowTabsSheet] = useState(false);

  const openTabs = usePluginRegistry((s) => s.openTabs);
  const activeTabId = usePluginRegistry((s) => s.activeTabId);
  const definitions = usePluginRegistry((s) => s.definitions);
  const openTab = usePluginRegistry((s) => s.openTab);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);

  // Build nav items from core plugins with navOrder
  const navItems = useMemo(() => {
    return Object.values(definitions)
      .filter((d): d is PluginDefinition & { navOrder: number } => d.navOrder != null)
      .sort((a, b) => a.navOrder - b.navOrder);
  }, [definitions]);

  // Get extra plugins (for the Tabs sheet)
  const extraPlugins = useMemo(() => {
    return Object.values(definitions)
      .filter((d) => d.kind === 'extra')
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [definitions]);

  const activePluginId = useMemo(() => {
    const activeTab = openTabs.find((t) => t.id === activeTabId);
    return activeTab?.pluginId ?? null;
  }, [openTabs, activeTabId]);

  // True when an extra plugin (not in the nav bar) is currently active
  const isExtraPluginActive = useMemo(() => {
    if (!activePluginId) return false;
    return definitions[activePluginId]?.kind === 'extra';
  }, [activePluginId, definitions]);

  const handleNavPress = useCallback(
    (pluginId: string) => {
      const def = definitions[pluginId];
      // For multi-instance plugins: switch to existing, or trigger create flow
      if (def?.allowMultipleInstances) {
        const existingTab = openTabs.find((t) => t.pluginId === pluginId);
        if (existingTab) {
          setActiveTab(existingTab.id);
        } else {
          onCreateInstance?.(pluginId);
        }
      } else {
        openTab(pluginId);
      }
    },
    [openTab, setActiveTab, definitions, openTabs, onCreateInstance],
  );

  const handleExtraPress = useCallback(
    (pluginId: string) => {
      openTab(pluginId);
      setShowTabsSheet(false);
    },
    [openTab],
  );

  const barHeight = 56 + insets.bottom;

  // Report height to parent
  React.useEffect(() => {
    onHeightChange?.(barHeight);
  }, [barHeight, onHeightChange]);

  return (
    <>
      <View style={[styles.container, { paddingBottom: insets.bottom, height: barHeight }]}>
        {/* Core plugin nav items */}
        {navItems.map((def) => {
          const isActive = activePluginId === def.id;
          const Icon = def.icon;

          return (
            <Pressable
              key={def.id}
              style={styles.navItem}
              onPress={() => handleNavPress(def.id)}
            >
              <Icon
                size={22}
                color={isActive ? colors.accent.primary : colors.fg.tertiary}
              />
              <Text
                style={[
                  styles.navLabel,
                  isActive && styles.navLabelActive,
                ]}
                numberOfLines={1}
              >
                {def.navLabel ?? def.name}
              </Text>
            </Pressable>
          );
        })}

        {/* Tabs button (opens extra plugins sheet) */}
        {extraPlugins.length > 0 && (
          <Pressable
            style={styles.navItem}
            onPress={() => setShowTabsSheet(true)}
          >
            <LayoutGrid
              size={22}
              color={isExtraPluginActive ? colors.accent.primary : colors.fg.tertiary}
            />
            <Text style={[styles.navLabel, isExtraPluginActive && styles.navLabelActive]}>
              Tools
            </Text>
          </Pressable>
        )}
      </View>

      {/* Extra Plugins Sheet */}
      <Modal
        visible={showTabsSheet}
        animationType="slide"
        transparent
        onRequestClose={() => setShowTabsSheet(false)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setShowTabsSheet(false)}>
          <View style={[styles.sheet, { paddingBottom: insets.bottom + spacing[4] }]}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>Plugins</Text>
            <ScrollView style={styles.sheetScroll}>
              {extraPlugins.map((def) => {
                const Icon = def.icon;
                const isOpen = openTabs.some((t) => t.pluginId === def.id);

                return (
                  <Pressable
                    key={def.id}
                    style={styles.sheetItem}
                    onPress={() => handleExtraPress(def.id)}
                  >
                    <Icon size={20} color={colors.fg.secondary} />
                    <View style={styles.sheetItemText}>
                      <Text style={styles.sheetItemName}>{def.name}</Text>
                      <Text style={styles.sheetItemDesc} numberOfLines={1}>
                        {def.description}
                      </Text>
                    </View>
                    {isOpen && <View style={styles.openIndicator} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>
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

  // Sheet styles
  sheetBackdrop: {
    flex: 1,
    backgroundColor: colors.bg.scrim,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingTop: spacing[3],
    maxHeight: '60%',
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: colors.fg.muted,
    borderRadius: radii.full,
    alignSelf: 'center',
    marginBottom: spacing[4],
  },
  sheetTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    paddingHorizontal: spacing[4],
    marginBottom: spacing[4],
  },
  sheetScroll: {
    paddingHorizontal: spacing[4],
  },
  sheetItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    gap: spacing[3],
  },
  sheetItemText: {
    flex: 1,
  },
  sheetItemName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.primary,
  },
  sheetItemDesc: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.tertiary,
    marginTop: 2,
  },
  openIndicator: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.accent.primary,
  },
});
