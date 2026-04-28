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

import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from 'react-native';
import { Code2 } from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import type { EditorPluginAPI } from '@stavi/shared';
import { useTheme } from '../../../theme';
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

// Sentinel empty array — reused by Zustand selectors to avoid new-array-per-call
// (which triggers the useSyncExternalStore infinite-loop guard).
const EMPTY_OPEN_FILES: never[] = Object.freeze([]) as never[];

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function EditorPanel({ instanceId, session, isActive }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },
    body: { flex: 1, flexDirection: 'row' },
    treePane: { backgroundColor: colors.bg.raised },
    // Tablet: pinned side panel — occupies 220px in the flex row
    treePinned: { width: 220 },
    // Phone: overlay drawer — absolutely positioned over the editor, full height,
    // casts a shadow so the editor content is still visible behind it
    treeOverlay: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 220,
      zIndex: 10,
      elevation: 8,
      shadowColor: '#000',
      shadowOffset: { width: 2, height: 0 },
      shadowOpacity: 0.35,
      shadowRadius: 8,
    },
    content: { flex: 1, flexDirection: 'column' },
  }), [colors]);

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

  const openFiles = useEditorStore((s) => s.openFilesBySession[sessionId] ?? EMPTY_OPEN_FILES);
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
        {/* Content area always fills the row — tree overlays on top on phone */}
        <View style={styles.content}>
          <EditorTabs sessionId={sessionId} />
          {/* EditorSurface is always rendered — never conditionally mounted.
              Fabric (New Architecture) crashes if the WebView inside it
              unmounts and remounts ("addViewAt: child already has a parent").
              activeFile=undefined shows the empty overlay inside EditorSurface. */}
          <EditorSurface
            activeFile={activeFile}
            sessionId={sessionId}
            serverId={serverId}
            onAction={handleAction}
            onCursorMoved={handleCursorMoved}
            bridgeRef={bridgeRef}
          />
        </View>

        {/* File tree — pinned column (tablet) or absolute overlay (phone) */}
        {treeVisible && (
          <>
            {/* Phone backdrop — tapping outside dismisses the drawer */}
            {!isTablet && (
              <Pressable
                style={StyleSheet.absoluteFill}
                onPress={() => setPhoneTreeVisible(false)}
                accessible={false}
              />
            )}
            <View style={[styles.treePane, isTablet ? styles.treePinned : styles.treeOverlay]}>
              <FileTree session={session} />
            </View>
          </>
        )}
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

// Styles computed dynamically via useMemo — see component body.
