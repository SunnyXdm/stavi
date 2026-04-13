// ============================================================
// DrawerContent — Left sidebar with session management
// ============================================================
// Reads sessions from SessionRegistry (populated by each plugin).
// Shows sessions for the active plugin only — matching lunel's
// pattern exactly:
//   [Search bar]  [Create button]
//   [Session list — scrollable]
//   [Home] [Settings] [Status dot]

import React, { memo, useCallback, useState } from 'react';
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
  X,
  PenLine,
} from 'lucide-react-native';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionRegistry } from '../stores/session-registry';
import { useConnectionStore } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';

// Plugins where sessions don't make sense in the sidebar
// (show logo/branding instead of session list)
const HIDE_SESSIONS_FOR = new Set(['git', 'browser', 'editor', 'explorer', 'search', 'monitor', 'ports', 'processes']);

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface DrawerContentProps {
  onClose: () => void;
  onNavigateHome: () => void;
  onNavigateSettings?: () => void;
  onCreateInstance?: (pluginId: string) => void;
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
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const openTabs = usePluginRegistry((s) => s.openTabs);
  const activeTabId = usePluginRegistry((s) => s.activeTabId);
  const definitions = usePluginRegistry((s) => s.definitions);
  const registrations = useSessionRegistry((s) => s.registrations);
  const connectionState = useConnectionStore((s) => s.state);

  // Determine active plugin
  const activeTab = openTabs.find((t) => t.id === activeTabId);
  const activePluginId = activeTab?.pluginId ?? null;
  const activePluginDef = activePluginId ? definitions[activePluginId] : null;

  // Get session registration for the active plugin
  const reg = activePluginId ? (registrations[activePluginId] ?? null) : null;
  const shouldHideSessions = activePluginId ? HIDE_SESSIONS_FOR.has(activePluginId) : false;

  // Filter sessions by search query
  const allSessions = reg?.sessions ?? [];
  const filteredSessions = search
    ? allSessions.filter((s) =>
        s.title.toLowerCase().includes(search.toLowerCase()) ||
        (s.subtitle?.toLowerCase().includes(search.toLowerCase()) ?? false)
      )
    : allSessions;

  const activeSessionId = reg?.activeSessionId ?? null;
  const isConnected = connectionState === 'connected';

  const handleSessionPress = useCallback((id: string) => {
    reg?.onSelectSession(id);
    onClose();
  }, [reg, onClose]);

  const handleCreate = useCallback(() => {
    if (reg?.onCreateSession) {
      reg.onCreateSession();
      onClose();
    } else if (activePluginId) {
      onCreateInstance?.(activePluginId);
      onClose();
    }
  }, [reg, activePluginId, onCreateInstance, onClose]);

  const handleCancelSearch = useCallback(() => {
    setSearch('');
    setSearchFocused(false);
  }, []);

  const showCreateButton = !shouldHideSessions && (reg?.onCreateSession || onCreateInstance);

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {!shouldHideSessions ? (
        <>
          {/* Search row + create button */}
          <View style={styles.topRow}>
            <View style={styles.searchWrap}>
              <Search size={16} color={colors.fg.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search sessions..."
                placeholderTextColor={colors.fg.muted}
                value={search}
                onChangeText={setSearch}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => setSearchFocused(false)}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <X size={14} color={colors.fg.muted} />
                </Pressable>
              )}
            </View>

            {/* Cancel (when search focused) or Create button */}
            {(searchFocused || showCreateButton) && (
              <Pressable
                style={styles.createBtn}
                onPress={searchFocused ? handleCancelSearch : handleCreate}
                hitSlop={4}
              >
                {searchFocused
                  ? <X size={18} color={colors.fg.secondary} />
                  : <PenLine size={18} color={colors.fg.secondary} />
                }
              </Pressable>
            )}
          </View>

          {/* Sessions label */}
          {activePluginDef && !searchFocused && (
            <Text style={styles.sectionLabel}>
              {activePluginDef.name} Sessions
            </Text>
          )}

          {/* Session list */}
          <ScrollView
            style={styles.sessionList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
          >
            {filteredSessions.length === 0 ? (
              <View style={styles.emptyState}>
                <Text style={styles.emptyText}>
                  {search ? 'No results' : 'No sessions yet'}
                </Text>
              </View>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <Pressable
                    key={session.id}
                    style={[
                      styles.sessionItem,
                      isActive && styles.sessionItemActive,
                    ]}
                    onPress={() => handleSessionPress(session.id)}
                  >
                    <Text
                      style={[
                        styles.sessionTitle,
                        isActive && styles.sessionTitleActive,
                      ]}
                      numberOfLines={1}
                    >
                      {session.title}
                    </Text>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      ) : (
        // For plugins like Git/Browser — show branding block
        <View style={styles.brandBlock}>
          <Text style={styles.brandName}>Stavi</Text>
          <Text style={styles.brandTagline}>Mobile AI IDE</Text>
        </View>
      )}

      {/* Bottom navigation */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing[2] }]}>
        <Pressable style={styles.bottomBtn} onPress={onNavigateHome}>
          <Home size={20} color={colors.fg.muted} strokeWidth={1.6} />
          <Text style={styles.bottomBtnLabel}>Home</Text>
        </Pressable>

        {onNavigateSettings && (
          <Pressable style={styles.bottomBtn} onPress={onNavigateSettings}>
            <Settings size={20} color={colors.fg.muted} strokeWidth={1.6} />
            <Text style={styles.bottomBtnLabel}>Settings</Text>
          </Pressable>
        )}

        <View style={styles.bottomSpacer} />

        {/* Connection status dot */}
        <View
          style={[
            styles.statusDot,
            { backgroundColor: isConnected ? colors.semantic.success : colors.fg.muted },
          ]}
        />
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

  // Top search row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingTop: spacing[4],
    paddingBottom: spacing[3],
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    height: 40,
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.sans,
    height: 40,
    paddingVertical: 0,
  },
  createBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
  },

  // Section label
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.muted,
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
    opacity: 0.65,
  },

  // Sessions
  sessionList: {
    flex: 1,
  },
  sessionItem: {
    paddingVertical: spacing[2] + 1,
    paddingHorizontal: spacing[5],
  },
  sessionItemActive: {
    backgroundColor: colors.bg.raised,
  },
  sessionTitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.sans,
    opacity: 0.8,
  },
  sessionTitleActive: {
    color: colors.fg.primary,
    opacity: 1,
  },
  emptyState: {
    paddingTop: spacing[5],
    paddingHorizontal: spacing[4],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },

  // Branding (for plugins that hide sessions)
  brandBlock: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[4],
  },
  brandName: {
    fontSize: typography.fontSize.xl,
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
  },
  brandTagline: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    marginTop: spacing[1],
  },

  // Bottom nav
  bottomBar: {
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
    paddingHorizontal: spacing[2],
    paddingTop: spacing[3],
    gap: spacing[1],
  },
  bottomBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
    gap: 2,
  },
  bottomBtnLabel: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  bottomSpacer: {
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: spacing[2],
  },
});
