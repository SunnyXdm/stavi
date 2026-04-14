// ============================================================
// WorkspaceScreen — the main IDE layout
// ============================================================
// Drawer sidebar + PluginHeader + Plugin panels + bottom bar.
// Creating a new AI or Editor instance opens DirectoryPicker first.

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, StatusBar, Animated, Pressable, Dimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { PluginRenderer } from '../components/PluginRenderer';
import { PluginBottomBar } from '../components/PluginBottomBar';
import { PluginHeader } from '../components/PluginHeader';
import { DrawerContent } from '../components/DrawerContent';
import { DirectoryPicker } from '../components/DirectoryPicker';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useSessionsStore } from '../stores/sessions-store';
import { colors } from '../theme';

const SCREEN_WIDTH = Dimensions.get('window').width;
const DRAWER_WIDTH = Math.min(SCREEN_WIDTH * 0.82, 340);

// Plugins that require a directory to be chosen before creating an instance
const DIRECTORY_SCOPED_PLUGINS = new Set(['ai', 'editor']);

export function WorkspaceScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const route = useRoute<any>();
  const [bottomBarHeight, setBottomBarHeight] = useState(56);
  const isReady = usePluginRegistry((s) => s.isReady);
  const initialize = usePluginRegistry((s) => s.initialize);
  const openTab = usePluginRegistry((s) => s.openTab);
  const definitions = usePluginRegistry((s) => s.definitions);
  const getSession = useSessionsStore((state) => state.getSession);
  const sessionId = route.params?.sessionId as string | undefined;
  const session = sessionId ? getSession(sessionId) : undefined;
  const serverId = session?.serverId ?? (route.params?.serverId as string | undefined);
  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));

  // Drawer animation
  const drawerAnim = useRef(new Animated.Value(0)).current;
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Directory picker state
  const [dirPickerVisible, setDirPickerVisible] = useState(false);
  const [pendingPluginId, setPendingPluginId] = useState<string | null>(null);

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
    navigation.navigate('SessionsHome');
  }, [closeDrawer, navigation]);

  const handleNavigateSettings = useCallback(() => {
    closeDrawer();
    navigation.navigate('Settings');
  }, [closeDrawer, navigation]);

  // Initialize plugin tabs for this session on mount
  useEffect(() => {
    initialize(sessionId);
  }, [initialize, sessionId]);

  const handleBarHeightChange = useCallback((height: number) => {
    setBottomBarHeight(height);
  }, []);

  // Create a new plugin instance — opens directory picker for scoped plugins
  const handleCreateInstance = useCallback(
    (pluginId: string) => {
      if (DIRECTORY_SCOPED_PLUGINS.has(pluginId)) {
        if (!serverId) return;
        setPendingPluginId(pluginId);
        setDirPickerVisible(true);
      } else {
        openTab(pluginId, undefined, sessionId);
      }
    },
    [openTab, serverId, sessionId],
  );

  // Called when user selects a directory in the picker
  const handleDirectorySelect = useCallback(
    (path: string) => {
      if (pendingPluginId && sessionId) {
        openTab(pendingPluginId, { directory: path, sessionId, serverId });
      }
      setPendingPluginId(null);
      setDirPickerVisible(false);
    },
    [pendingPluginId, openTab, serverId, sessionId],
  );

  const handleDirPickerClose = useCallback(() => {
    setPendingPluginId(null);
    setDirPickerVisible(false);
  }, []);

  // Active plugin's ID (for determining if we need directory picker on "+" press)
  const activePluginId = (openTabs ?? []).find((t) => t.id === activeTabId)?.pluginId ?? null;
  const activePluginAllowsMultiple = activePluginId
    ? (definitions[activePluginId]?.allowMultipleInstances ?? false)
    : false;

  const handleHeaderCreateInstance = useCallback(() => {
    if (activePluginId) {
      handleCreateInstance(activePluginId);
    }
  }, [activePluginId, handleCreateInstance]);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />
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

      {/* Directory picker modal */}
      <DirectoryPicker
        visible={dirPickerVisible}
        onClose={handleDirPickerClose}
        onSelect={handleDirectorySelect}
        serverId={serverId ?? session?.serverId ?? ''}
      />
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
    backgroundColor: '#000',
    zIndex: 5,
  },
});
