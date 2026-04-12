// ============================================================
// WorkspaceScreen — the main IDE layout
// ============================================================
// Plugin panels + bottom bar. This is where the user spends 99% of their time.

import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, StatusBar } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PluginRenderer } from '../components/PluginRenderer';
import { PluginBottomBar } from '../components/PluginBottomBar';
import { usePluginRegistry } from '../stores/plugin-registry';
import { colors } from '../theme';

export function WorkspaceScreen() {
  const [bottomBarHeight, setBottomBarHeight] = useState(56);
  const isReady = usePluginRegistry((s) => s.isReady);
  const initialize = usePluginRegistry((s) => s.initialize);

  // Initialize plugin system on mount
  useEffect(() => {
    if (!isReady) {
      initialize();
    }
  }, [isReady, initialize]);

  const handleBarHeightChange = useCallback((height: number) => {
    setBottomBarHeight(height);
  }, []);

  if (!isReady) {
    return (
      <View style={styles.loading}>
        <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg.base} />

      {/* Plugin panels */}
      <View style={[styles.content, { marginBottom: bottomBarHeight }]}>
        <PluginRenderer bottomBarHeight={bottomBarHeight} />
      </View>

      {/* Bottom navigation */}
      <View style={styles.bottomBar}>
        <PluginBottomBar onHeightChange={handleBarHeightChange} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
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
});
