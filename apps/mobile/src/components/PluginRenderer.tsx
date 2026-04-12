// ============================================================
// PluginRenderer — renders all mounted plugin panels
// ============================================================
// Key behaviors:
// - All mounted panels stay alive (opacity-swap, not display:none)
//   This preserves WebView state, terminal sessions, editor content
// - Lazy mounting: panels mount only on first activation
// - MemoizedPanel: aggressive memoization, inactive panels never re-render
// - No Reanimated ref.current=undefined bug (we never use display:none)

import React, { useRef, useMemo, useCallback, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePluginRegistry, getPluginComponent } from '../stores/plugin-registry';
import { colors } from '../theme';
import type { PluginPanelProps, PluginInstance } from '@stavi/shared';

interface PluginRendererProps {
  bottomBarHeight: number;
}

export function PluginRenderer({ bottomBarHeight }: PluginRendererProps) {
  const openTabs = usePluginRegistry((s) => s.openTabs);
  const activeTabId = usePluginRegistry((s) => s.activeTabId);

  // Track which tabs have been mounted (lazy mounting)
  const mountedTabIds = useRef(new Set<string>());

  // Mount the active tab
  if (activeTabId) {
    mountedTabIds.current.add(activeTabId);
  }

  return (
    <View style={styles.container}>
      {openTabs.map((tab) => {
        // Don't render tabs that haven't been activated yet
        if (!mountedTabIds.current.has(tab.id)) return null;

        const isActive = tab.id === activeTabId;

        return (
          <MemoizedPanel
            key={tab.id}
            tab={tab}
            isActive={isActive}
            bottomBarHeight={bottomBarHeight}
          />
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------
// MemoizedPanel — aggressively memoized plugin panel
// ----------------------------------------------------------

interface PanelProps {
  tab: PluginInstance;
  isActive: boolean;
  bottomBarHeight: number;
}

const MemoizedPanel = memo(
  function Panel({ tab, isActive, bottomBarHeight }: PanelProps) {
    const Component = getPluginComponent(tab.pluginId);

    if (!Component) {
      return (
        <View style={[styles.panel, !isActive && styles.panelHidden]}>
          <View style={styles.errorContainer}>
            {/* Intentionally no Text import to keep this light */}
          </View>
        </View>
      );
    }

    return (
      <View
        style={[styles.panel, !isActive && styles.panelHidden]}
        // Prevent touch events from reaching hidden panels
        pointerEvents={isActive ? 'auto' : 'none'}
      >
        <Component
          instanceId={tab.id}
          isActive={isActive}
          bottomBarHeight={bottomBarHeight}
          initialState={tab.initialState}
        />
      </View>
    );
  },
  // Custom comparison: never re-render inactive panels
  (prev, next) => {
    // Always re-render when activation state changes
    if (prev.isActive !== next.isActive) return false;
    // Always re-render when instance changes
    if (prev.tab.id !== next.tab.id) return false;
    // Re-render when bottom bar height changes
    if (prev.bottomBarHeight !== next.bottomBarHeight) return false;
    // Never re-render inactive panels for any other reason
    if (!next.isActive) return true;
    // Active panel: re-render on state changes
    return prev.tab.status === next.tab.status;
  },
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  panel: {
    ...StyleSheet.absoluteFill,
  },
  panelHidden: {
    opacity: 0,
  },
  errorContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
