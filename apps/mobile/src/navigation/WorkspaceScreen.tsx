// WHAT: WorkspaceScreen — the main IDE layout, now Session-bound.
// WHY:  Phase 3 binds every workspace to a specific Session. Route takes sessionId,
//       plugins receive session: Session as a prop, folder picker is gone.
// HOW:  Resolves Session from sessions-store via route param. Calls session.touch
//       on mount and re-focus. BackHandler routes to SessionsHome on Android.
// SEE:  apps/mobile/src/stores/sessions-store.ts, apps/mobile/src/stores/plugin-registry.ts

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  Animated,
  Pressable,
  Dimensions,
  BackHandler,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, useFocusEffect } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AlertTriangle, ArrowLeft } from 'lucide-react-native';
import { PluginRenderer } from '../components/PluginRenderer';
import { PluginBottomBar } from '../components/PluginBottomBar';
import { PluginHeader } from '../components/PluginHeader';
import { DrawerContent } from '../components/DrawerContent';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionsStore } from '../stores/sessions-store';
import { useConnectionStore } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';
import { logEvent } from '../services/telemetry';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);

export function WorkspaceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const [bottomBarHeight, setBottomBarHeight] = useState(56);
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

  // Drawer animation
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [drawerOpen, setDrawerOpen] = useState(false);

  const openDrawer = useCallback(() => {
    setDrawerOpen(true);
    Animated.timing(drawerAnim, {
      toValue: 1,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [drawerAnim]);

  const closeDrawer = useCallback(() => {
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
    }).start(() => {
      setDrawerOpen(false);
    });
  }, [drawerAnim]);

  const handleNavigateHome = useCallback(() => {
    closeDrawer();
    // Navigate without disconnecting — WebSockets stay alive
    navigation.navigate('SessionsHome');
  }, [closeDrawer, navigation]);

  const handleNavigateSettings = useCallback(() => {
    closeDrawer();
    navigation.navigate('Settings');
  }, [closeDrawer, navigation]);

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

  const handleBarHeightChange = useCallback((height: number) => {
    setBottomBarHeight(height);
  }, []);

  // Create a new plugin instance — no more directory picker
  const handleCreateInstance = useCallback(
    (pluginId: string) => {
      openTab(pluginId, undefined, sessionId);
    },
    [openTab, sessionId],
  );

  // Active plugin's ID
  const activePluginId = (openTabs ?? []).find((t) => t.id === activeTabId)?.pluginId ?? null;
  const activePluginAllowsMultiple = activePluginId
    ? (definitions[activePluginId]?.allowMultipleInstances ?? false)
    : false;

  const handleHeaderCreateInstance = useCallback(() => {
    if (activePluginId) {
      handleCreateInstance(activePluginId);
    }
  }, [activePluginId, handleCreateInstance]);

  // Error state: session not found, archived, or deleted
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

  // Animated transforms
  const mainTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, DRAWER_WIDTH],
  });

  const drawerTranslateX = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [-DRAWER_WIDTH, 0],
  });

  const scrimOpacity = drawerAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.5],
  });

  return (
    <View style={styles.root}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />

      {/* Drawer layer */}
      {drawerOpen && (
        <Animated.View
          style={[
            styles.drawerContainer,
            { width: DRAWER_WIDTH, transform: [{ translateX: drawerTranslateX }] },
          ]}
        >
          <DrawerContent
            onClose={closeDrawer}
            onNavigateHome={handleNavigateHome}
            onNavigateSettings={handleNavigateSettings}
            onCreateInstance={handleCreateInstance}
            sessionId={sessionId}
          />
        </Animated.View>
      )}

      {/* Main content */}
      <Animated.View
        style={[styles.mainContainer, { transform: [{ translateX: mainTranslateX }] }]}
      >
        <SafeAreaView style={styles.container} edges={['top']}>
          {/* Plugin header */}
          <PluginHeader
            onOpenDrawer={openDrawer}
            onCreateInstance={activePluginAllowsMultiple ? handleHeaderCreateInstance : undefined}
            sessionId={sessionId}
          />

          {/* Plugin panels */}
          <View style={[styles.content, { marginBottom: bottomBarHeight }]}>
            <PluginRenderer
              bottomBarHeight={bottomBarHeight}
              sessionId={sessionId}
              session={session}
            />
          </View>

          {/* Bottom navigation */}
          <View style={styles.bottomBar}>
            <PluginBottomBar
              onHeightChange={handleBarHeightChange}
              onCreateInstance={handleCreateInstance}
              sessionId={sessionId}
              serverId={serverId}
            />
          </View>
        </SafeAreaView>

        {/* Scrim overlay */}
        {drawerOpen && (
          <Animated.View style={[styles.scrim, { opacity: scrimOpacity }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeDrawer} />
          </Animated.View>
        )}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  loading: {
    flex: 1,
    backgroundColor: colors.bg.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flex: 1,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },

  // Drawer
  drawerContainer: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    zIndex: 10,
  },
  mainContainer: {
    flex: 1,
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg.scrim,
    zIndex: 5,
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
