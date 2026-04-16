// WHAT: WorkspaceScreen — IDE layout with persistent sidebar shell (Phase 8e).
// WHY:  Phase 8e replaces bottom-tab + drawer layout with a flex-row sidebar + content area.
//       WorkspaceSidebar is always visible (collapsed = 52px rail, expanded = 260px panel).
//       No animated drawer/scrim/bottomBarHeight. PluginBottomBar removed.
// HOW:  flex-row: <WorkspaceSidebar> + <content area>. Sidebar manages its own
//       collapsed/expanded state. Content area is full remaining width × full height.
// SEE:  apps/mobile/src/components/WorkspaceSidebar.tsx, plans/08-restructure-plan.md §8e

import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Pressable,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AlertTriangle, ArrowLeft } from 'lucide-react-native';
import { PluginRenderer } from '../components/PluginRenderer';
import { PluginHeader } from '../components/PluginHeader';
import { WorkspaceSidebar } from '../components/WorkspaceSidebar';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionsStore } from '../stores/sessions-store';
import { useConnectionStore } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';
import { logEvent } from '../services/telemetry';

export function WorkspaceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();

  const isReady = usePluginRegistry((s) => s.isReady);
  const initialize = usePluginRegistry((s) => s.initialize);
  const openTab = usePluginRegistry((s) => s.openTab);
  const definitions = usePluginRegistry((s) => s.definitions);

  // Session resolution from route param
  const sessionId = route.params?.sessionId as string | undefined;
  const session = useSessionsStore((state) =>
    sessionId ? state.sessionsById[sessionId] : undefined,
  );
  const serverId = session?.serverId;

  // Per-session tab state
  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));

  // Sidebar collapsed/expanded state
  const [sidebarExpanded, setSidebarExpanded] = useState(false);

  const handleToggleSidebar = useCallback(() => {
    setSidebarExpanded((v) => !v);
  }, []);

  const handleNavigateHome = useCallback(() => {
    setSidebarExpanded(false);
    navigation.navigate('SessionsHome');
  }, [navigation]);

  const handleNavigateSettings = useCallback(() => {
    setSidebarExpanded(false);
    navigation.navigate('Settings');
  }, [navigation]);

  // Initialize plugin tabs for this session on mount
  useEffect(() => {
    if (sessionId && session) {
      initialize(sessionId);
    }
  }, [initialize, sessionId, session]);

  // Log session.opened once on mount — dep is sessionId (stable string), not session
  // object, to avoid re-firing on every Zustand store update.
  useEffect(() => {
    if (!sessionId) return;
    const s = useSessionsStore.getState().sessionsById[sessionId];
    if (!s) return;
    logEvent('session.opened', { sessionId: s.id, serverId: s.serverId, folder: s.folder });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // session.touch on mount — deps are stable strings only, not the session object.
  useEffect(() => {
    if (!sessionId || !serverId) return;
    const client = useConnectionStore.getState().getClientForServer(serverId);
    if (!client) return;
    client.request('session.touch', { sessionId }).catch((err) => {
      console.warn('[WorkspaceScreen] session.touch failed:', err);
    });
  }, [sessionId, serverId]);

  // session.touch on re-focus (after navigating back from Home)
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

  // Hardware back (Android): consume event, navigate to SessionsHome
  useFocusEffect(
    useCallback(() => {
      const handler = BackHandler.addEventListener('hardwareBackPress', () => {
        navigation.navigate('SessionsHome');
        return true; // consume the event — do NOT exit the app
      });
      return () => handler.remove();
    }, [navigation]),
  );

  // Collapse sidebar when keyboard is open: handled by letting the content area
  // absorb keyboard avoidance. The sidebar stays visible (collapsed rail).

  const handleCreateInstance = useCallback(
    (pluginId: string) => {
      openTab(pluginId, undefined, sessionId);
    },
    [openTab, sessionId],
  );

  // Active plugin's ID for header
  const activePluginId = (openTabs ?? []).find((t) => t.id === activeTabId)?.pluginId ?? null;
  const activePluginAllowsMultiple = activePluginId
    ? (definitions[activePluginId]?.allowMultipleInstances ?? false)
    : false;

  const handleHeaderCreateInstance = useCallback(() => {
    if (activePluginId) {
      handleCreateInstance(activePluginId);
    }
  }, [activePluginId, handleCreateInstance]);

  // ----------------------------------------------------------
  // Error states
  // ----------------------------------------------------------

  if (!sessionId || (!session && sessionId)) {
    return (
      <View style={styles.errorContainer}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />
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
        <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />
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
        <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />
        <ActivityIndicator size="large" color={colors.accent.primary} />
      </View>
    );
  }

  // ----------------------------------------------------------
  // Main layout: flex-row sidebar + content area
  // ----------------------------------------------------------

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />

      {/* Persistent sidebar — always visible icon rail, expands to full panel */}
      <WorkspaceSidebar
        sessionId={sessionId}
        serverId={serverId}
        expanded={sidebarExpanded}
        onToggle={handleToggleSidebar}
        onNavigateHome={handleNavigateHome}
        onNavigateSettings={handleNavigateSettings}
        onCreateInstance={handleCreateInstance}
      />

      {/* Content area — full remaining width × full height */}
      <SafeAreaView style={styles.content} edges={['top']}>
        {/* Plugin header */}
        <PluginHeader
          onOpenDrawer={handleToggleSidebar}
          onCreateInstance={activePluginAllowsMultiple ? handleHeaderCreateInstance : undefined}
          sessionId={sessionId}
        />

        {/* Plugin panels — full height, no bottom margin */}
        <View style={styles.panelArea}>
          <PluginRenderer
            bottomBarHeight={0}
            sessionId={sessionId}
            session={session}
          />
        </View>
      </SafeAreaView>

      {/* Tap-to-collapse scrim when expanded */}
      {sidebarExpanded && (
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={handleToggleSidebar}
          accessible={false}
          pointerEvents="box-only"
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    flexDirection: 'row',
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

  // Error state
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
});
