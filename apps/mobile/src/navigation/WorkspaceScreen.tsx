// WHAT: WorkspaceScreen — IDE layout with bottom tab bar + session drawer (Phase 9 §1–2).
// WHY:  Phase 9 replaces the 52px sidebar rail with bottom nav (§1) and a swipe-from-left
//       session drawer (§2). Both give back full screen width while keeping navigation reachable.
// HOW:  flex column: SafeAreaView(top) → PluginHeader + PluginRenderer → PluginBottomBar.
//       SessionDrawer is an absolute overlay managed by drawerOpen state.
//       Android back button closes drawer first, then navigates home.
// SEE:  apps/mobile/src/components/SessionDrawer.tsx, PluginBottomBar.tsx
//       plans/09-navigation-overhaul.md §1–2

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Pressable,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { AppNavigation, AppRoute } from './types';
import { AlertTriangle, ArrowLeft } from 'lucide-react-native';
import { PluginRenderer } from '../components/PluginRenderer';
import { PluginHeader } from '../components/PluginHeader';
import { PluginBottomBar } from '../components/PluginBottomBar';
import { SessionDrawer } from '../components/SessionDrawer';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionsStore } from '../stores/sessions-store';
import { useConnectionStore } from '../stores/connection';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';
import { logEvent } from '../services/telemetry';

export function WorkspaceScreen() {
  const navigation = useNavigation<AppNavigation>();
  const route = useRoute<AppRoute<'Workspace'>>();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.bg.base,
    },
    content: {
      flex: 1,
      backgroundColor: colors.bg.base,
    },
    loading: {
      flex: 1,
      backgroundColor: colors.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
    },
    panelArea: {
      flex: 1,
    },
    errorContainer: {
      flex: 1,
      backgroundColor: colors.bg.base,
    },
    errorContent: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: spacing[6],
      gap: spacing[3],
    },
    errorTitle: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    errorSubtitle: {
      fontSize: typography.fontSize.base,
      color: colors.fg.tertiary,
      textAlign: 'center',
      lineHeight: typography.fontSize.base * 1.5,
    },
    errorButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      backgroundColor: colors.accent.primary,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[3],
      borderRadius: radii.md,
      marginTop: spacing[4],
    },
    errorButtonText: {
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.onAccent,
    },
  }), [colors]);

  const isReady = usePluginRegistry((s) => s.isReady);
  const initialize = usePluginRegistry((s) => s.initialize);

  // Resolve the active plugin definition so we can check hideHeader
  const activePluginDef = usePluginRegistry((s) => {
    const activeTabId = s.getActiveTabId(sessionId);
    const activeTab = activeTabId
      ? (s.getOpenTabs(sessionId)).find((t) => t.id === activeTabId)
      : undefined;
    return activeTab ? (s.definitions[activeTab.pluginId] ?? null) : null;
  });
  const showHeader = !(activePluginDef?.hideHeader ?? false);

  // Session resolution from route param
  const sessionId = route.params?.sessionId as string | undefined;
  const session = useSessionsStore((state) =>
    sessionId ? state.sessionsById[sessionId] : undefined,
  );
  const serverId = session?.serverId;

  const bottomBarHeight = 56 + insets.bottom;

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false);
  const handleOpenDrawer = useCallback(() => setDrawerOpen(true), []);
  const handleCloseDrawer = useCallback(() => setDrawerOpen(false), []);

  // Initialize plugin tabs for this session on mount
  useEffect(() => {
    if (sessionId && session) {
      initialize(sessionId);
    }
  }, [initialize, sessionId, session]);

  // Log session.opened once on mount
  useEffect(() => {
    if (!sessionId) return;
    const s = useSessionsStore.getState().sessionsById[sessionId];
    if (!s) return;
    logEvent('session.opened', { sessionId: s.id, serverId: s.serverId, folder: s.folder });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // session.touch on mount
  useEffect(() => {
    if (!sessionId || !serverId) return;
    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client) return;
    client.request('session.touch', { sessionId }).catch((err) => {
      console.warn('[WorkspaceScreen] session.touch failed:', err);
    });
  }, [sessionId, serverId]);

  // session.touch on re-focus
  useFocusEffect(
    useCallback(() => {
      if (!session || !serverId) return;
      const client = useConnectionStore.getState().getClientForServer(serverId);
      if (!client) return;
      client.request('session.touch', { sessionId: session.id }).catch((err) => {
        console.warn('[WorkspaceScreen] session.touch on re-focus failed:', err);
      });
    }, [session, serverId]),
  );

  // Hardware back (Android): close drawer first, then navigate home
  useFocusEffect(
    useCallback(() => {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        if (drawerOpen) {
          setDrawerOpen(false);
          return true;
        }
        navigation.navigate('SessionsHome');
        return true;
      });
      return () => handler.remove();
    }, [navigation, drawerOpen]),
  );

  // ----------------------------------------------------------
  // Error states
  // ----------------------------------------------------------

  if (!sessionId || (!session && sessionId)) {
    return (
      <View style={styles.errorContainer}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg.base} />
        <SafeAreaView style={styles.errorContent} edges={['top', 'bottom']}>
          <AlertTriangle size={48} color={colors.semantic.warning} />
          <Text style={styles.errorTitle}>Workspace not found</Text>
          <Text style={styles.errorSubtitle}>
            This workspace may have been archived or deleted.
          </Text>
          <Pressable style={styles.errorButton} onPress={() => navigation.navigate('SessionsHome')}>
            <ArrowLeft size={16} color={colors.fg.onAccent} />
            <Text style={styles.errorButtonText}>Back to Home</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (session?.status === 'archived') {
    return (
      <View style={styles.errorContainer}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg.base} />
        <SafeAreaView style={styles.errorContent} edges={['top', 'bottom']}>
          <AlertTriangle size={48} color={colors.semantic.warning} />
          <Text style={styles.errorTitle}>Workspace archived</Text>
          <Text style={styles.errorSubtitle}>
            This workspace has been archived and is no longer active.
          </Text>
          <Pressable style={styles.errorButton} onPress={() => navigation.navigate('SessionsHome')}>
            <ArrowLeft size={16} color={colors.fg.onAccent} />
            <Text style={styles.errorButtonText}>Back to Home</Text>
          </Pressable>
        </SafeAreaView>
      </View>
    );
  }

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg.base} />
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }

  // ----------------------------------------------------------
  // Main layout
  // ----------------------------------------------------------

  return (
    <View style={styles.root}>
      <StatusBar barStyle={isDark ? 'light-content' : 'dark-content'} backgroundColor={colors.bg.base} />
      <SafeAreaView style={styles.content} edges={['top']}>
        {showHeader && (
          <PluginHeader
            onOpenDrawer={handleOpenDrawer}
            sessionId={sessionId}
          />
        )}
        <View style={styles.panelArea}>
          <PluginRenderer
            bottomBarHeight={bottomBarHeight}
            sessionId={sessionId}
            session={session}
          />
        </View>
      </SafeAreaView>
      <PluginBottomBar sessionId={sessionId} />

      {/* Session drawer — absolute overlay, owns edge-zone touch when closed */}
      {sessionId && (
        <SessionDrawer
          visible={drawerOpen}
          sessionId={sessionId}
          onClose={handleCloseDrawer}
          onOpen={handleOpenDrawer}
        />
      )}
    </View>
  );
}

// Styles are created inside the component via useMemo (see WorkspaceScreen body above).
