// ============================================================
// DrawerContent — Left sidebar with session management
// ============================================================
// Reads sessions from SessionRegistry (populated by each plugin).
// Shows sessions for the active plugin only — lunel pattern:
//   [Plugin name]
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

// Plugins where sessions don't make sense — show plugin icon + branding instead
const HIDE_SESSIONS_FOR = new Set([
  'git', 'browser', 'editor', 'explorer',
  'search', 'monitor', 'ports', 'processes',
]);

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface DrawerContentProps {
  onClose: () => void;
  onNavigateHome: () => void;
  onNavigateSettings?: () => void;
  onCreateInstance?: (pluginId: string) => void;
  sessionId?: string;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const DrawerContent = memo(function DrawerContent({
  onClose,
  onNavigateHome,
  onNavigateSettings,
  onCreateInstance,
  sessionId,
}: DrawerContentProps) {
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');

  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const registrations = useSessionRegistry((s) => s.registrations);
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const connectionState = savedConnections[0]
    ? useConnectionStore.getState().getServerStatus(savedConnections[0].id)
    : 'disconnected';

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
    ? allSessions.filter(
        (s) =>
          s.title.toLowerCase().includes(search.toLowerCase()) ||
          (s.subtitle?.toLowerCase().includes(search.toLowerCase()) ?? false),
      )
    : allSessions;

  const activeSessionId = reg?.activeSessionId ?? null;
  const isConnected = connectionState === 'connected';

  const handleSessionPress = useCallback(
    (id: string) => {
      reg?.onSelectSession(id);
      onClose();
    },
    [reg, onClose],
  );

  const handleCreate = useCallback(() => {
    if (reg?.onCreateSession) {
      reg.onCreateSession();
      onClose();
    } else if (activePluginId) {
      onCreateInstance?.(activePluginId);
      onClose();
    }
  }, [reg, activePluginId, onCreateInstance, onClose]);

  const canCreate = !shouldHideSessions && (reg?.onCreateSession || onCreateInstance);
  const PluginIcon = activePluginDef?.icon;

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>

      {!shouldHideSessions ? (
        <>
          {/* Plugin name header */}
          {activePluginDef && (
            <View style={styles.pluginHeader}>
              {PluginIcon && (
                <PluginIcon size={18} color={colors.fg.secondary} />
              )}
              <Text style={styles.pluginName}>{activePluginDef.name}</Text>
            </View>
          )}

          {/* Search row */}
          <View style={styles.topRow}>
            <View style={styles.searchWrap}>
              <Search size={14} color={colors.fg.muted} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search..."
                placeholderTextColor={colors.fg.muted}
                value={search}
                onChangeText={setSearch}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {search.length > 0 && (
                <Pressable onPress={() => setSearch('')} hitSlop={8}>
                  <X size={12} color={colors.fg.muted} />
                </Pressable>
              )}
            </View>

            {canCreate && (
              <Pressable style={styles.createBtn} onPress={handleCreate} hitSlop={4}>
                <PenLine size={16} color={colors.fg.secondary} />
              </Pressable>
            )}
          </View>

          {/* Session list */}
          <ScrollView
            style={styles.sessionList}
            showsVerticalScrollIndicator={false}
            keyboardDismissMode="on-drag"
          >
            {filteredSessions.length === 0 ? (
              <View style={styles.emptyState}>
                {PluginIcon && (
                  <PluginIcon size={28} color={colors.fg.muted} />
                )}
                <Text style={styles.emptyTitle}>
                  {search ? 'No results' : `No ${activePluginDef?.name ?? ''} sessions`}
                </Text>
                {!search && canCreate && (
                  <Pressable style={styles.emptyCreateBtn} onPress={handleCreate}>
                    <PenLine size={14} color={colors.accent.primary} />
                    <Text style={styles.emptyCreateText}>
                      {reg?.createLabel ?? 'New session'}
                    </Text>
                  </Pressable>
                )}
              </View>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                return (
                  <Pressable
                    key={session.id}
                    style={({ pressed }) => [
                      styles.sessionItem,
                      isActive && styles.sessionItemActive,
                      pressed && !isActive && styles.sessionItemPressed,
                    ]}
                    onPress={() => handleSessionPress(session.id)}
                  >
                    {/* Left accent bar for active session */}
                    {isActive && <View style={styles.activeBar} />}

                    <View style={styles.sessionContent}>
                      <Text
                        style={[
                          styles.sessionTitle,
                          isActive && styles.sessionTitleActive,
                        ]}
                        numberOfLines={1}
                      >
                        {session.title}
                      </Text>
                      {session.subtitle ? (
                        <Text style={styles.sessionSubtitle} numberOfLines={1}>
                          {session.subtitle}
                        </Text>
                      ) : null}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>
        </>
      ) : (
        // For plugins like Git/Browser/Explorer — show plugin icon + name
        <View style={styles.brandBlock}>
          {PluginIcon && (
            <PluginIcon size={32} color={colors.fg.muted} />
          )}
          <Text style={styles.brandName}>{activePluginDef?.name ?? 'Stavi'}</Text>
          <Text style={styles.brandTagline}>
            {activePluginDef?.description ?? 'Mobile AI IDE'}
          </Text>
        </View>
      )}

      {/* Bottom navigation */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + spacing[2] }]}>
        <Pressable style={styles.bottomBtn} onPress={onNavigateHome}>
          <Home size={20} color={colors.fg.muted} />
          <Text style={styles.bottomBtnLabel}>Home</Text>
        </Pressable>

        {onNavigateSettings && (
          <Pressable style={styles.bottomBtn} onPress={onNavigateSettings}>
            <Settings size={20} color={colors.fg.muted} />
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

  // Plugin name header (top of session section)
  pluginHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingTop: spacing[5],
    paddingBottom: spacing[2],
  },
  pluginName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },

  // Search row
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[3],
  },
  searchWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    height: 36,
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.sans,
    height: 36,
    paddingVertical: 0,
  },
  createBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
  },

  // Session list
  sessionList: {
    flex: 1,
  },
  sessionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  sessionItemActive: {
    backgroundColor: colors.bg.raised,
  },
  sessionItemPressed: {
    backgroundColor: colors.bg.active,
  },
  activeBar: {
    width: 3,
    alignSelf: 'stretch',
    backgroundColor: colors.accent.primary,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  sessionContent: {
    flex: 1,
    paddingVertical: spacing[2] + 1,
    paddingLeft: spacing[4],
    paddingRight: spacing[4],
  },
  sessionTitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.sans,
  },
  sessionTitleActive: {
    color: colors.fg.primary,
    fontWeight: typography.fontWeight.medium,
  },
  sessionSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    marginTop: 2,
    fontFamily: typography.fontFamily.mono,
  },

  // Empty state
  emptyState: {
    alignItems: 'center',
    paddingTop: spacing[10],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
  },
  emptyTitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  emptyCreateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent.primary + '66',
    marginTop: spacing[2],
  },
  emptyCreateText: {
    fontSize: typography.fontSize.sm,
    color: colors.accent.primary,
  },

  // Branding (for plugins that hide sessions)
  brandBlock: {
    flex: 1,
    paddingHorizontal: spacing[4],
    paddingTop: spacing[6],
    gap: spacing[3],
  },
  brandName: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
  },
  brandTagline: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    lineHeight: 20,
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
