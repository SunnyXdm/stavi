// WHAT: Renders all mounted workspace plugin panels using opacity-swap for persistence.
// WHY:  Phase 2 passes session to workspace plugins (scope-based props).
//       Phase 9 removes server-scoped plugins — all plugins now receive WorkspacePluginPanelProps.
// HOW:  Reads openTabsBySession for the current session. All panels receive session props.
// SEE:  apps/mobile/src/stores/plugin-registry.ts, packages/shared/src/plugin-types.ts

import React, { useRef, memo, useMemo } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePluginRegistry, getPluginComponent } from '../stores/plugin-registry';
import { useTheme } from '../theme';
import { ErrorBoundary } from './ErrorBoundary';
import type { Session } from '@stavi/shared';
import type { PluginInstance } from '@stavi/shared';

interface PluginRendererProps {
  bottomBarHeight: number;
  sessionId?: string;
  session?: Session;
}

export function PluginRenderer({ bottomBarHeight, sessionId, session }: PluginRendererProps) {
  const openTabs = usePluginRegistry((s) => s.getOpenTabs(sessionId));
  const activeTabId = usePluginRegistry((s) => s.getActiveTabId(sessionId));
  const definitions = usePluginRegistry((s) => s.definitions);
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },
  }), [colors]);

  // Track which tabs have been mounted (lazy mounting)
  const mountedTabIds = useRef(new Set<string>());

  if (activeTabId) {
    mountedTabIds.current.add(activeTabId);
  }

  return (
    <View style={styles.container}>
      {openTabs.map((tab) => {
        if (!mountedTabIds.current.has(tab.id)) return null;
        const definition = definitions[tab.pluginId];
        if (!definition) return null;
        const isActive = tab.id === activeTabId;
        return (
          <ErrorBoundary key={tab.id} label={definition.name ?? tab.pluginId}>
            <MemoizedPanel
              key={tab.id}
              tab={tab}
              scope={definition.scope}
              isActive={isActive}
              bottomBarHeight={bottomBarHeight}
              session={session}
            />
          </ErrorBoundary>
        );
      })}
    </View>
  );
}

// ----------------------------------------------------------
// MemoizedPanel
// ----------------------------------------------------------

interface PanelProps {
  tab: PluginInstance;
  scope: 'workspace' | 'server';
  isActive: boolean;
  bottomBarHeight: number;
  session?: Session;
}

// Static panel styles — do not reference colors, so they don't need useMemo.
const panelStyles = StyleSheet.create({
  panel: { ...StyleSheet.absoluteFill },
  panelHidden: { opacity: 0 },
});

const MemoizedPanel = memo(
  function Panel({ tab, scope, isActive, bottomBarHeight, session }: PanelProps) {
    const Component = getPluginComponent(tab.pluginId);

    if (!Component) {
      return <View style={[panelStyles.panel, !isActive && panelStyles.panelHidden]} />;
    }

    if (scope === 'workspace' && !session) {
      return <View style={[panelStyles.panel, !isActive && panelStyles.panelHidden]} />;
    }

    return (
      <View
        style={[panelStyles.panel, !isActive && panelStyles.panelHidden]}
        pointerEvents={isActive ? 'auto' : 'none'}
      >
        <Component
          scope="workspace"
          instanceId={tab.id}
          isActive={isActive}
          session={session!}
          bottomBarHeight={bottomBarHeight}
          initialState={tab.initialState}
        />
      </View>
    );
  },
  (prev, next) => {
    if (prev.scope !== next.scope) return false;
    if (prev.isActive !== next.isActive) return false;
    if (prev.tab.id !== next.tab.id) return false;
    if (prev.bottomBarHeight !== next.bottomBarHeight) return false;
    if (!next.isActive) return true;
    if (prev.tab.status !== next.tab.status) return false;
    if (prev.tab.title !== next.tab.title) return false;
    if (prev.session?.id !== next.session?.id) return false;
    return true;
  },
);

// Styles are created inside the component via useMemo (see PluginRenderer body above).
