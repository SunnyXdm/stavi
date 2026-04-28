// WHAT: PluginBottomBar — fixed bottom navigation bar with 6 slots for workspace plugins.
// WHY:  Phase 9 replaces the 52px sidebar rail (Phase 8e) with a bottom tab bar, restoring
//       full-width content. Mobile screens are taller than wide; bottom nav is the idiomatic
//       mobile pattern and wastes no horizontal pixels.
// HOW:  6 fixed NAV_ITEMS rendered as Pressables in a row. Active state derived from a
//       single Zustand selector (getActiveTabId). Press handlers read state imperatively to
//       avoid extra subscriptions. "Tabs" slot opens a Modal sheet listing extra plugins.
// SEE:  apps/mobile/src/stores/plugin-registry.ts (openTab, setActiveTab, getActiveTabId)
//       apps/mobile/src/navigation/WorkspaceScreen.tsx (host layout)
//       plans/09-navigation-overhaul.md (phase plan)

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  Modal,
  StyleSheet,
  FlatList,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Sparkles,
  Code2,
  TerminalSquare,
  GitBranch,
  Globe,
  LayoutGrid,
  ChevronRight,
  X,
} from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useShallow } from 'zustand/react/shallow';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';
import type { PluginDefinition } from '@stavi/shared';
import { useHaptics } from '../hooks/useHaptics';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface PluginBottomBarProps {
  sessionId: string;
}

interface NavItem {
  pluginId: string;
  label: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon: React.ComponentType<any>;
}

// ----------------------------------------------------------
// Nav items — order matches the design spec
// ----------------------------------------------------------

const NAV_ITEMS: NavItem[] = [
  { pluginId: 'ai',       label: 'AI',       icon: Sparkles },
  { pluginId: 'editor',   label: 'Editor',   icon: Code2 },
  { pluginId: 'terminal', label: 'Terminal', icon: TerminalSquare },
  { pluginId: 'git',      label: 'Git',      icon: GitBranch },
  { pluginId: 'browser',  label: 'Browser',  icon: Globe },
  { pluginId: '_tabs',    label: 'Tabs',     icon: LayoutGrid },
];

const BAR_HEIGHT = 56;

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function PluginBottomBar({ sessionId }: PluginBottomBarProps) {
  const insets = useSafeAreaInsets();
  const [modalVisible, setModalVisible] = useState(false);
  const { colors } = useTheme();
  const haptics = useHaptics();

  const styles = useMemo(() => StyleSheet.create({
    bar: {
      flexDirection: 'row',
      backgroundColor: colors.bg.raised,
      borderTopWidth: 1,
      borderTopColor: colors.divider,
      // Height is set inline to include safe area inset
    },
    slot: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: spacing[2],
      minHeight: 44,
      gap: spacing[1],
    },
    label: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.medium,
    },
    labelActive: {
      color: colors.accent.primary,
    },
    labelInactive: {
      color: colors.fg.muted,
      opacity: 0.7,
    },
  }), [colors]);

  // Single selector — avoids re-render storms. We only need the active tab id for highlight.
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));

  // Derive active pluginId from open tabs imperatively when highlighting
  // (not a selector — avoids subscribing to the whole tab array)
  const getActivePluginId = useCallback((): string | null => {
    const { getOpenTabs } = usePluginRegistry.getState();
    const tabs = getOpenTabs(sessionId);
    const tab = tabs.find((t) => t.id === activeTabId);
    return tab?.pluginId ?? null;
  }, [activeTabId, sessionId]);

  const activePluginId = getActivePluginId();

  const handleNavPress = useCallback(
    (pluginId: string) => {
      haptics.selection();
      if (pluginId === '_tabs') {
        setModalVisible(true);
        return;
      }
      const { openTab, setActiveTab, getOpenTabs } = usePluginRegistry.getState();
      const tabs = getOpenTabs(sessionId);
      const existing = tabs.find((t) => t.pluginId === pluginId);
      if (existing) {
        setActiveTab(existing.id, sessionId);
      } else {
        openTab(pluginId, undefined, sessionId);
      }
    },
    [sessionId, haptics],
  );

  const handleExtraPluginPress = useCallback(
    (pluginId: string) => {
      const { openTab, setActiveTab } = usePluginRegistry.getState();
      const instanceId = openTab(pluginId, undefined, sessionId);
      if (instanceId) {
        setActiveTab(instanceId, sessionId);
      }
      setModalVisible(false);
    },
    [sessionId],
  );

  const closeModal = useCallback(() => setModalVisible(false), []);

  return (
    <>
      <View style={[styles.bar, { paddingBottom: insets.bottom, height: BAR_HEIGHT + insets.bottom }]}>
        {NAV_ITEMS.map((item) => {
          const isActive = item.pluginId !== '_tabs' && item.pluginId === activePluginId;
          const Icon = item.icon;
          return (
            <Pressable
              key={item.pluginId}
              style={styles.slot}
              onPress={() => handleNavPress(item.pluginId)}
              hitSlop={4}
              accessibilityRole="tab"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: isActive }}
            >
              <Icon
                size={22}
                color={isActive ? colors.accent.primary : colors.fg.muted}
              />
              <Text style={[styles.label, isActive ? styles.labelActive : styles.labelInactive]}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <ExtraPluginsModal
        visible={modalVisible}
        sessionId={sessionId}
        onClose={closeModal}
        onSelectPlugin={handleExtraPluginPress}
      />
    </>
  );
}

// ----------------------------------------------------------
// Extra Plugins Modal
// ----------------------------------------------------------

interface ExtraPluginsModalProps {
  visible: boolean;
  sessionId: string;
  onClose: () => void;
  onSelectPlugin: (pluginId: string) => void;
}

function ExtraPluginsModal({ visible, onClose, onSelectPlugin }: ExtraPluginsModalProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  const modalStyles = useMemo(() => StyleSheet.create({
    backdrop: {
      ...StyleSheet.absoluteFill,
      backgroundColor: colors.bg.scrim,
    },
    sheet: {
      position: 'absolute',
      bottom: 0,
      left: 0,
      right: 0,
      backgroundColor: colors.bg.raised,
      borderTopLeftRadius: radii.xl,
      borderTopRightRadius: radii.xl,
    },
    sheetHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[4],
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    sheetTitle: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    closeButton: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[4],
    },
    rowBorder: {
      borderBottomWidth: 1,
      borderBottomColor: colors.divider,
    },
    rowName: {
      flex: 1,
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
    },
    empty: {
      paddingVertical: spacing[8],
      alignItems: 'center',
    },
    emptyText: {
      fontSize: typography.fontSize.base,
      color: colors.fg.tertiary,
    },
  }), [colors]);

  // useShallow so the selector returns stable reference when definitions object hasn't changed.
  // Calling getExtraPlugins() inside the selector creates a new array every snapshot,
  // triggering React's "getSnapshot should be cached" infinite-loop guard.
  const definitions = usePluginRegistry(useShallow((s) => s.definitions));
  const extraPlugins = useMemo(
    () =>
      Object.values(definitions)
        .filter((d) => d.kind === 'extra')
        .sort((a, b) => a.name.localeCompare(b.name)),
    [definitions],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: PluginDefinition; index: number }) => {
      const isLast = index === extraPlugins.length - 1;
      return (
        <Pressable
          style={[modalStyles.row, !isLast && modalStyles.rowBorder]}
          onPress={() => onSelectPlugin(item.id)}
          accessibilityRole="button"
          accessibilityLabel={item.name}
        >
          <Text style={modalStyles.rowName}>{item.name}</Text>
          <ChevronRight size={16} color={colors.fg.muted} />
        </Pressable>
      );
    },
    [extraPlugins.length, onSelectPlugin, modalStyles, colors],
  );

  const keyExtractor = useCallback((item: PluginDefinition) => item.id, []);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      {/* Backdrop */}
      <Pressable style={modalStyles.backdrop} onPress={onClose} accessible={false} />

      {/* Sheet */}
      <View style={[modalStyles.sheet, { paddingBottom: insets.bottom || spacing[4] }]}>
        {/* Header */}
        <View style={modalStyles.sheetHeader}>
          <Text style={modalStyles.sheetTitle}>More Tools</Text>
          <Pressable style={modalStyles.closeButton} onPress={onClose} hitSlop={8} accessibilityLabel="Close">
            <X size={20} color={colors.fg.secondary} />
          </Pressable>
        </View>

        {/* Plugin list */}
        {extraPlugins.length === 0 ? (
          <View style={modalStyles.empty}>
            <Text style={modalStyles.emptyText}>No additional tools available</Text>
          </View>
        ) : (
          <FlatList
            data={extraPlugins}
            renderItem={renderItem}
            keyExtractor={keyExtractor}
            scrollEnabled={false}
          />
        )}
      </View>
    </Modal>
  );
}

// Styles are created inside each component via useMemo (see PluginBottomBar and ExtraPluginsModal above).
