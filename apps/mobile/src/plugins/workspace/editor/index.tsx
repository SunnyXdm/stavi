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
  StyleSheet,
} from 'react-native';
import { Code2 } from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
  Session,
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
import Reanimated from 'react-native-reanimated';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useKeyboardPanelStyle } from '../../../hooks/useKeyboardPanelStyle';
import { EditorSymbolsBar } from './components/EditorSymbolsBar';


// Sentinel empty array — reused by Zustand selectors to avoid new-array-per-call
// (which triggers the useSyncExternalStore infinite-loop guard).
const EMPTY_OPEN_FILES: never[] = Object.freeze([]) as never[];

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function EditorPanel({ instanceId, session, isActive, onOpenDrawer, bottomBarHeight }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  // Editor rides the keyboard like the terminal/AI panels — the CodeMirror
  // WebView shrinks and the symbols bar sits exactly on the keyboard top.
  const keyboardPad = useKeyboardPanelStyle(bottomBarHeight ?? 0);
  const keyboardVisible = useKeyboardState((state) => state.isVisible);
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },
    content: { flex: 1, flexDirection: 'column' },
  }), [colors]);

  const sessionId = session.id;
  const serverId = session.serverId;

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
    }
  }, []);

  // -------------------------------------------------------
  // Cursor moved callback from EditorSurface
  // -------------------------------------------------------
  const handleCursorMoved = useCallback((line: number, col: number) => {
    setCursor({ line, col });
  }, []);

  // -------------------------------------------------------
  // Render
  // -------------------------------------------------------
  return (
    <Reanimated.View style={[styles.container, keyboardPad]}>
      {/* Single header: hamburger (drawer hosts the file tree) + filename +
          find/undo/redo/save. The plugin sets hideHeader so the generic
          PluginHeader is gone — two stacked bars wasted 44px. */}
      <EditorToolbar
        onOpenDrawer={onOpenDrawer}
        onAction={handleAction}
        isDirty={isDirty}
        fileName={activeFilePath?.split('/').pop()}
        cursor={cursor}
      />

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

      {/* Quick-insert symbols + Save, only while typing (lunel pattern) */}
      {keyboardVisible && activeFile && (
        <EditorSymbolsBar
          onInsert={(text) => bridgeRef.current?.insertText(text)}
          onSave={() => handleAction('save')}
          isDirty={isDirty}
        />
      )}
    </Reanimated.View>
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

// Theme ids must match THEMES in assets/editor/src/theme.ts.
// Each carries a `preview` palette so the picker renders a live syntax-
// highlighted snippet (palettes mirror the actual thememirror theme colors).
export const EDITOR_THEME_OPTIONS = [
  { value: 'stavi-dark', label: 'Stavi Dark', preview: { bg: '#161616', fg: '#c0c0c0', comment: '#7f848e', keyword: '#c678dd', string: '#98c379', func: '#61afef', number: '#d19a66' } },
  { value: 'dracula', label: 'Dracula', preview: { bg: '#2d2f3f', fg: '#f8f8f2', comment: '#6272a4', keyword: '#ff79c6', string: '#f1fa8c', func: '#50fa7b', number: '#bd93f9' } },
  { value: 'tomorrow', label: 'Tomorrow', preview: { bg: '#ffffff', fg: '#4d4d4c', comment: '#8e908c', keyword: '#3e999f', string: '#718c00', func: '#c82829', number: '#f5871f' } },
  { value: 'cobalt', label: 'Cobalt', preview: { bg: '#00254b', fg: '#ffffff', comment: '#0088ff', keyword: '#ff9d00', string: '#3ad900', func: '#cccccc', number: '#ff628c' } },
  { value: 'cool-glow', label: 'Cool Glow', preview: { bg: '#060521', fg: '#e0e0e0', comment: '#aeaeae', keyword: '#2bf1dc', string: '#8dff8e', func: '#a3ebff', number: '#62e9bd' } },
  { value: 'espresso', label: 'Espresso', preview: { bg: '#ffffff', fg: '#000000', comment: '#aaaaaa', keyword: '#2f6f9f', string: '#cf4f5f', func: '#43a8ed', number: '#cf4f5f' } },
  { value: 'amy', label: 'Amy', preview: { bg: '#200020', fg: '#d0d0ff', comment: '#404080', keyword: '#60b0ff', string: '#999999', func: '#008080', number: '#7090b0' } },
  { value: 'barf', label: 'Barf', preview: { bg: '#15191e', fg: '#eef2f7', comment: '#6e6e6e', keyword: '#697a8e', string: '#5c81b3', func: '#a3d295', number: '#c1e1b8' } },
  { value: 'bespin', label: 'Bespin', preview: { bg: '#2e241d', fg: '#baae9e', comment: '#666666', keyword: '#5ea6ea', string: '#54be0d', func: '#7587a6', number: '#cf6a4c' } },
  { value: 'birds-of-paradise', label: 'Birds of Paradise', preview: { bg: '#3b2627', fg: '#e6e1c4', comment: '#6b4e32', keyword: '#ef5d32', string: '#d9d762', func: '#efac32', number: '#6c99bb' } },
  { value: 'boys-and-girls', label: 'Boys and Girls', preview: { bg: '#000205', fg: '#ffffff', comment: '#404040', keyword: '#e62286', string: '#00d8ff', func: '#e62286', number: '#e62286' } },
  { value: 'github-light', label: 'Light (Ayu)', preview: { bg: '#fcfcfc', fg: '#5c6166', comment: '#8a8d92', keyword: '#fa8d3e', string: '#86b300', func: '#399ee6', number: '#ffaa33' } },
  { value: 'solarized-light', label: 'Solarized Light', preview: { bg: '#fef7e5', fg: '#586e75', comment: '#93a1a1', keyword: '#859900', string: '#2aa198', func: '#268bd2', number: '#d33682' } },
  { value: 'rose-pine-dawn', label: 'Rosé Pine Dawn', preview: { bg: '#faf4ed', fg: '#575279', comment: '#9893a5', keyword: '#286983', string: '#ea9d34', func: '#d7827e', number: '#286983' } },
  { value: 'clouds', label: 'Clouds', preview: { bg: '#ffffff', fg: '#000000', comment: '#bcc8ba', keyword: '#af956f', string: '#5d90cd', func: '#46a609', number: '#46a609' } },
  { value: 'noctis-lilac', label: 'Noctis Lilac', preview: { bg: '#f2f1f8', fg: '#0c006b', comment: '#9995b7', keyword: '#ff5792', string: '#00b368', func: '#0095a8', number: '#5842ff' } },
  { value: 'smoothy', label: 'Smoothy', preview: { bg: '#ffffff', fg: '#000000', comment: '#cfcfcf', keyword: '#d8b229', string: '#704d3d', func: '#2eb43b', number: '#e66c29' } },
];

// Drawer body for the editor: the file tree, explorer-style. Picking a file
// emits editor.openFile (handled by the mounted EditorPanel) and closes the
// drawer so the editor is immediately visible.
function EditorDrawerTree({ session, close }: { session: Session; close: () => void }) {
  useEffect(() => {
    const unsub = eventBus.on('editor.openFile', () => close());
    return unsub;
  }, [close]);
  return <FileTree session={session} />;
}

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
  // Single-bar chrome: EditorToolbar hosts the hamburger + actions.
  hideHeader: true,
  drawerContent: EditorDrawerTree,
  api: editorApi,
  settings: {
    sections: [
      {
        title: 'Appearance',
        fields: [
          {
            key: 'theme',
            type: 'select',
            label: 'Editor theme',
            description: 'Syntax-highlighting theme for the code editor',
            default: 'stavi-dark',
            options: EDITOR_THEME_OPTIONS,
          },
        ],
      },
    ],
  },
};

// Styles computed dynamically via useMemo — see component body.
