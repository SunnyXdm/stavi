// WHAT: Workspace Plugin — Editor (Acode-style IDE surface).
// WHY:  Phase 4b upgrades the Phase 4a placeholder to a real CodeMirror 6 editor
//       via a WebView bridge. Save/Undo/Redo/Find toolbar actions now route through
//       the EditorBridgeHandle exposed by EditorSurface.
// HOW:  bridgeRef (MutableRefObject<EditorBridgeHandle|null>) is created here and
//       threaded down to EditorSurface, which populates it once the WebView is ready.
//       handleAction() calls the appropriate bridge method. Cursor position returned
//       via onCursorMoved callback and stored in local state for the toolbar.
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx,
//       apps/mobile/src/plugins/workspace/editor/store.ts,
//       packages/shared/src/plugin-events.ts

import React, { useCallback, useEffect, useState, useRef } from 'react';
import {
  View,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Code2 } from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import type { EditorPluginAPI } from '@stavi/shared';
import { colors } from '../../../theme';
import { useEditorStore } from './store';
import { FileTree } from './components/FileTree';
import { EditorTabs } from './components/EditorTabs';
import { EditorSurface } from './components/EditorSurface';
import type { EditorBridgeHandle } from './components/EditorSurface';
import { EditorToolbar } from './components/EditorToolbar';
import type { EditorAction } from './components/EditorToolbar';
import { eventBus } from '../../../services/event-bus';

// Width threshold: ≥ 900 = tablet (tree pinned), < 900 = phone (tree toggleable)
const TABLET_BREAKPOINT = 900;

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function EditorPanel({ instanceId, session, isActive }: WorkspacePluginPanelProps) {
  const { width } = useWindowDimensions();
  const isTablet = width >= TABLET_BREAKPOINT;

  const sessionId = session.id;
  const serverId = session.serverId;

  // Tree visibility: always visible on tablet, toggle on phone
  const [phoneTreeVisible, setPhoneTreeVisible] = useState(false);
  const treeVisible = isTablet || phoneTreeVisible;

  // Bridge handle — populated by EditorSurface once the WebView is ready
  const bridgeRef = useRef<EditorBridgeHandle | null>(null);

  // Cursor position for toolbar display
  const [cursor, setCursor] = useState<{ line: number; col: number } | undefined>(undefined);

  const openFiles = useEditorStore((s) => s.openFilesBySession[sessionId] ?? []);
  const activeFilePath = useEditorStore(
    (s) => s.activeFileBySession[sessionId] ?? null,
  );
  const isDirty = openFiles.find((f) => f.path === activeFilePath)?.dirty ?? false;
  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const { openFile: openFileInStore } = useEditorStore.getState();

  // -------------------------------------------------------
  // Subscribe to editor.openFile cross-plugin event
  // -------------------------------------------------------
  useEffect(() => {
    const unsub = eventBus.on('editor.openFile', (payload) => {
      if (payload.sessionId !== sessionId) return;
      void openFileInStore(sessionId, payload.path, serverId);
    });
    return unsub;
  }, [sessionId, serverId, openFileInStore]);

  // -------------------------------------------------------
  // Toolbar action handler — routes through WebView bridge
  // -------------------------------------------------------
  const handleAction = useCallback((action: EditorAction) => {
    switch (action) {
      case 'save':
        void bridgeRef.current?.save();
        break;
      case 'undo':
        bridgeRef.current?.undo();
        break;
      case 'redo':
        bridgeRef.current?.redo();
        break;
      case 'find':
        bridgeRef.current?.find();
        break;
      case 'format':
        // Phase 4b: no formatter. No-op.
        break;
    }
  }, []);

  // -------------------------------------------------------
  // Cursor moved callback from EditorSurface
  // -------------------------------------------------------
  const handleCursorMoved = useCallback((line: number, col: number) => {
    setCursor({ line, col });
  }, []);

  // -------------------------------------------------------
  // Toggle tree (phone only)
  // -------------------------------------------------------
  const handleToggleTree = useCallback(() => {
    if (!isTablet) {
      setPhoneTreeVisible((v) => !v);
    }
  }, [isTablet]);

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <View style={styles.container}>
      {/* Toolbar */}
      <EditorToolbar
        treeVisible={treeVisible}
        onToggleTree={handleToggleTree}
        onAction={handleAction}
        isDirty={isDirty}
        fileName={activeFilePath?.split('/').pop()}
        cursor={cursor}
      />

      {/* Main area: tree + content */}
      <View style={styles.body}>
        {/* File tree */}
        {treeVisible && (
          <View style={[styles.treePane, isTablet ? styles.treePinned : styles.treeOverlay]}>
            <FileTree session={session} />
          </View>
        )}

        {/* Content area */}
        <View style={styles.content}>
          <EditorTabs sessionId={sessionId} />
          <EditorSurface
            activeFile={activeFile}
            sessionId={sessionId}
            serverId={serverId}
            onAction={handleAction}
            onCursorMoved={handleCursorMoved}
            bridgeRef={bridgeRef}
          />
        </View>
      </View>
    </View>
  );
}

// ----------------------------------------------------------
// Plugin API (GPI cross-plugin calls)
// ----------------------------------------------------------

function editorApi(): EditorPluginAPI {
  return {
    openFile: async (path: string, _line?: number) => {
      // Find sessions with an open editor by checking the store
      const state = useEditorStore.getState();
      const sessions = Object.keys(state.openFilesBySession);
      if (sessions.length === 0) return;
      // Emit the event — the active editor instance will handle it
      // We pick the first session as fallback
      const sessionId = sessions[0];
      eventBus.emit('editor.openFile', { sessionId, path });
    },

    saveFile: async (_path: string) => {
      // Phase 4b: save is handled via the toolbar action / Cmd+S shortcut inside the editor.
      // Cross-plugin save-by-path is not implemented in Phase 4b.
    },

    getCurrentFile: () => {
      const state = useEditorStore.getState();
      const sessions = Object.keys(state.activeFileBySession);
      if (sessions.length === 0) return null;
      return state.activeFileBySession[sessions[0]] ?? null;
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const editorPlugin: WorkspacePluginDefinition = {
  id: 'editor',
  name: 'Editor',
  description: 'Acode-style code editor with file tree and syntax highlighting',
  scope: 'workspace',
  kind: 'core',
  icon: Code2,
  component: EditorPanel,
  navOrder: 1,
  navLabel: 'Editor',
  allowMultipleInstances: true,
  api: editorApi,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  body: {
    flex: 1,
    flexDirection: 'row',
  },

  // Tree pane
  treePane: {
    backgroundColor: colors.bg.raised,
  },
  treePinned: {
    width: 220,
  },
  treeOverlay: {
    width: 220,
    // On phone the tree is toggled — it occupies its 220px and the content shifts right.
    // A future enhancement could make it a drawer overlay, but keeping it simple in 4a.
  },

  // Content area
  content: {
    flex: 1,
    flexDirection: 'column',
  },
});
