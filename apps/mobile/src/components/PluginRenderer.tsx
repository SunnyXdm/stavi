// WHAT: Renders all mounted workspace plugin panels using opacity-swap for persistence.
// WHY:  Phase 2 passes session to workspace plugins (scope-based props). Server plugins
//       are not rendered here — they go through ServerToolsSheet.
// HOW:  Reads openTabsBySession for the current session. WorkspacePluginPanelProps
//       receives session; ServerPluginPanelProps receives serverId (filtered out here).
// SEE:  apps/mobile/src/stores/plugin-registry.ts, packages/shared/src/plugin-types.ts

import React, { useRef, memo } from 'react';
import { View, StyleSheet } from 'react-native';
import { usePluginRegistry, getPluginComponent } from '../stores/plugin-registry';
import { colors } from '../theme';
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
          <MemoizedPanel
            key={tab.id}
            tab={tab}
            scope={definition.scope}
            isActive={isActive}
            bottomBarHeight={bottomBarHeight}
            session={session}
          />
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

const MemoizedPanel = memo(
  function Panel({ tab, scope, isActive, bottomBarHeight, session }: PanelProps) {
    const Component = getPluginComponent(tab.pluginId);

    if (!Component) {
      return <View style={[styles.panel, !isActive && styles.panelHidden]} />;
    }

    if (scope === 'workspace' && !session) {
      return <View style={[styles.panel, !isActive && styles.panelHidden]} />;
    }

    const serverId = session?.serverId ?? '';

    return (
      <View
        style={[styles.panel, !isActive && styles.panelHidden]}
        pointerEvents={isActive ? 'auto' : 'none'}
      >
        {scope === 'workspace' ? (
          <Component
            scope="workspace"
            instanceId={tab.id}
            isActive={isActive}
            session={session!}
            bottomBarHeight={bottomBarHeight}
            initialState={tab.initialState}
          />
        ) : (
          <Component
            scope="server"
            instanceId={tab.id}
            isActive={isActive}
            serverId={serverId}
            bottomBarHeight={bottomBarHeight}
            initialState={tab.initialState}
          />
        )}
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  panel: { ...StyleSheet.absoluteFill },
  panelHidden: { opacity: 0 },
});
