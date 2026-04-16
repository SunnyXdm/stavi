// ============================================================
// WorkspaceSidebar — persistent icon rail + expandable panel
// ============================================================
// WHAT: Replaces bottom tabs + slide drawer with a left-side sidebar.
// WHY:  Phase 8e — workspace sidebar shell. Always-visible icon rail
//       (52px collapsed) expands to ~260px panel with labels + chat list.
// HOW:  Animated.Value drives width. Tap rail edge or swipe → expand/collapse.
//       Tool icons: workspace-scoped plugins only. Bottom: Home + Settings.
//       Active chats: reads from SessionRegistry (AI plugin registration).
//       Chat list extracted to WorkspaceSidebarChats.tsx (> 400-line limit).
// SEE:  plans/08-restructure-plan.md §Phase 8e

import React, { useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  Pressable,
  PanResponder,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Home, Settings } from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionRegistry } from '../stores/session-registry';
import type { WorkspacePluginDefinition } from '@stavi/shared';
import { colors, typography, spacing } from '../theme';
import { WorkspaceSidebarChats } from './WorkspaceSidebarChats';
import type { SidebarChatEntry } from './WorkspaceSidebarChats';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const RAIL_WIDTH = 52;
const EXPANDED_WIDTH = 260;
const ANIMATION_MS = 220;

// Plugin IDs that are server-scoped and must NOT appear in sidebar rail.
// Done-criterion (6): only workspace-scoped plugins shown here.
const SERVER_SCOPED_IDS = new Set([
  'processes', 'ports', 'monitor', 'system-search',
]);

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface WorkspaceSidebarProps {
  sessionId?: string;
  serverId?: string;
  expanded: boolean;
  onToggle: () => void;
  onNavigateHome: () => void;
  onNavigateSettings: () => void;
  onCreateInstance?: (pluginId: string) => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function WorkspaceSidebar({
  sessionId,
  expanded,
  onToggle,
  onNavigateHome,
  onNavigateSettings,
  onCreateInstance,
}: WorkspaceSidebarProps) {
  const insets = useSafeAreaInsets();
  const animValue = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  // Keep animation in sync with controlled `expanded` prop
  const prevExpanded = useRef(expanded);
  if (prevExpanded.current !== expanded) {
    prevExpanded.current = expanded;
    Animated.timing(animValue, {
      toValue: expanded ? 1 : 0,
      duration: ANIMATION_MS,
      useNativeDriver: false,
    }).start();
  }

  const sidebarWidth = animValue.interpolate({
    inputRange: [0, 1],
    outputRange: [RAIL_WIDTH, EXPANDED_WIDTH],
  });

  // ----------------------------------------------------------
  // Plugin registry
  // ----------------------------------------------------------

  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const openTab = usePluginRegistry((s) => s.openTab);
  const setActiveTab = usePluginRegistry((s) => s.setActiveTab);

  // Workspace-scoped nav plugins only (excludes server-scoped)
  const navPlugins = useMemo(() => {
    return Object.values(definitions)
      .filter((d): d is WorkspacePluginDefinition & { navOrder: number } =>
        d.scope === 'workspace' &&
        d.navOrder != null &&
        !SERVER_SCOPED_IDS.has(d.id),
      )
      .sort((a, b) => a.navOrder - b.navOrder);
  }, [definitions]);

  const activePluginId = useMemo(() => {
    const t = openTabs.find((t) => t.id === activeTabId);
    return t?.pluginId ?? null;
  }, [openTabs, activeTabId]);

  const handleNavPress = useCallback(
    (pluginId: string) => {
      const def = definitions[pluginId];
      if (!def) return;
      if (def.allowMultipleInstances) {
        const existing = openTabs.find((t) => t.pluginId === pluginId);
        if (existing) {
          setActiveTab(existing.id, sessionId);
        } else {
          onCreateInstance?.(pluginId);
        }
      } else {
        openTab(pluginId, undefined, sessionId);
      }
    },
    [openTab, setActiveTab, definitions, openTabs, onCreateInstance, sessionId],
  );

  // ----------------------------------------------------------
  // Session registry — active AI chats for this workspace
  // ----------------------------------------------------------

  const registrations = useSessionRegistry((s) => s.registrations);
  const aiReg = registrations['ai'] ?? null;

  const chats: SidebarChatEntry[] = useMemo(
    () => (aiReg?.sessions ?? []).map((s) => ({ id: s.id, title: s.title, subtitle: s.subtitle })),
    [aiReg?.sessions],
  );

  const activeChatId = aiReg?.activeSessionId ?? null;

  const handleChatPress = useCallback(
    (chatId: string) => {
      aiReg?.onSelectSession(chatId);
      openTab('ai', undefined, sessionId);
    },
    [aiReg, openTab, sessionId],
  );

  const handleNewChat = useCallback(() => {
    if (aiReg?.onCreateSession) {
      aiReg.onCreateSession();
    } else {
      openTab('ai', undefined, sessionId);
    }
  }, [aiReg, openTab, sessionId]);

  // ----------------------------------------------------------
  // Swipe gesture on the rail edge
  // ----------------------------------------------------------

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8,
      onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 8,
      onPanResponderRelease: (_, gs) => {
        if (gs.dx > 30 || gs.dx < -30) {
          onToggle();
        }
      },
    }),
  ).current;

  // ----------------------------------------------------------
  // Render
  // ----------------------------------------------------------

  return (
    <Animated.View
      style={[styles.sidebar, { width: sidebarWidth, paddingTop: insets.top }]}
      {...panResponder.panHandlers}
    >
      {/* Tool icons */}
      <View style={styles.pluginSection}>
        {navPlugins.map((def) => {
          const isActive = activePluginId === def.id;
          const Icon = def.icon;
          return (
            <Pressable
              key={def.id}
              style={[styles.navItem, isActive && styles.navItemActive]}
              onPress={() => handleNavPress(def.id)}
              accessibilityLabel={def.navLabel ?? def.name}
              accessibilityRole="button"
            >
              {isActive && <View style={styles.activeAccent} />}
              <View style={styles.navItemContent}>
                <Icon
                  size={22}
                  color={isActive ? colors.accent.primary : colors.fg.tertiary}
                />
                {expanded && (
                  <Text
                    style={[styles.navLabel, isActive && styles.navLabelActive]}
                    numberOfLines={1}
                  >
                    {def.navLabel ?? def.name}
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.divider} />

      {/* Active chats section (visible only when expanded) */}
      {expanded && (
        <WorkspaceSidebarChats
          chats={chats}
          activeChatId={activeChatId}
          onChatPress={handleChatPress}
          onNewChat={handleNewChat}
        />
      )}

      <View style={styles.spacer} />

      {/* Bottom: Home + Settings */}
      <View style={[styles.bottomSection, { paddingBottom: insets.bottom + spacing[2] }]}>
        <View style={styles.divider} />
        <Pressable
          style={styles.navItem}
          onPress={onNavigateHome}
          accessibilityLabel="Home"
          accessibilityRole="button"
        >
          <View style={styles.navItemContent}>
            <Home size={20} color={colors.fg.muted} />
            {expanded && (
              <Text style={styles.navLabel} numberOfLines={1}>Home</Text>
            )}
          </View>
        </Pressable>
        <Pressable
          style={styles.navItem}
          onPress={onNavigateSettings}
          accessibilityLabel="Settings"
          accessibilityRole="button"
        >
          <View style={styles.navItemContent}>
            <Settings size={20} color={colors.fg.muted} />
            {expanded && (
              <Text style={styles.navLabel} numberOfLines={1}>Settings</Text>
            )}
          </View>
        </Pressable>
      </View>
    </Animated.View>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  sidebar: {
    backgroundColor: colors.bg.raised,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: colors.divider,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  pluginSection: {
    paddingTop: spacing[2],
  },
  navItem: {
    height: 48,
    justifyContent: 'center',
    position: 'relative',
  },
  navItemActive: {
    backgroundColor: colors.accent.subtle,
  },
  navItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: spacing[3] + 2,
    gap: spacing[3],
  },
  navLabel: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
    flex: 1,
  },
  navLabelActive: {
    color: colors.accent.primary,
  },
  activeAccent: {
    position: 'absolute',
    left: 0,
    top: 8,
    bottom: 8,
    width: 3,
    backgroundColor: colors.accent.primary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginHorizontal: spacing[2],
    marginVertical: spacing[1],
  },
  spacer: {
    flex: 1,
  },
  bottomSection: {
    paddingTop: spacing[1],
  },
});
