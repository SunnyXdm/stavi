// ============================================================
// Core Plugin: Editor
// ============================================================
// Code viewer with file tabs. Opens files via GPI from Explorer
// or AI file changes. Uses ScrollView with monospace text for
// code display (WebView + CodeMirror planned for v2).
//
// Each plugin instance has its own file state keyed by instanceId.

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from 'react-native';
import { Code2, X, FileText } from 'lucide-react-native';
import type {
  WorkspacePluginDefinition,
  WorkspacePluginPanelProps,
} from '@stavi/shared';
import type { EditorPluginAPI } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { useConnectionStore } from '../../../stores/connection';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface OpenFile {
  path: string;
  content: string;
  loading: boolean;
  error: string | null;
}

interface InstanceState {
  openFiles: OpenFile[];
  activeFilePath: string | null;
  listeners: Set<() => void>;
}

// ----------------------------------------------------------
// Per-instance state (outside React, persists across renders)
// ----------------------------------------------------------

const instanceStateMap = new Map<string, InstanceState>();

function getInstanceState(instanceId: string): InstanceState {
  if (!instanceStateMap.has(instanceId)) {
    instanceStateMap.set(instanceId, {
      openFiles: [],
      activeFilePath: null,
      listeners: new Set(),
    });
  }
  return instanceStateMap.get(instanceId)!;
}

function notifyListeners(instanceId: string) {
  const state = instanceStateMap.get(instanceId);
  if (state) {
    for (const listener of state.listeners) {
      listener();
    }
  }
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function EditorPanel({ instanceId, session }: WorkspacePluginPanelProps) {
  const serverId = session.serverId;
  const connectionState = serverId
    ? useConnectionStore.getState().getStatusForServer(serverId)
    : 'disconnected';
  const client = serverId
    ? useConnectionStore.getState().getClientForServer(serverId)
    : undefined;
  const [, forceUpdate] = useState(0);

  // Get or create per-instance state
  const iState = getInstanceState(instanceId);

  // Subscribe to file changes for this instance
  useEffect(() => {
    const listener = () => forceUpdate((n) => n + 1);
    iState.listeners.add(listener);
    return () => {
      iState.listeners.delete(listener);
    };
  }, [iState]);

  const { openFiles, activeFilePath } = iState;
  const activeFile = openFiles.find((f) => f.path === activeFilePath);

  const handleCloseFile = useCallback((path: string) => {
    const s = getInstanceState(instanceId);
    s.openFiles = s.openFiles.filter((f) => f.path !== path);
    if (s.activeFilePath === path) {
      s.activeFilePath = s.openFiles[s.openFiles.length - 1]?.path ?? null;
    }
    notifyListeners(instanceId);
  }, [instanceId]);

  const handleSelectFile = useCallback((path: string) => {
    const s = getInstanceState(instanceId);
    s.activeFilePath = path;
    notifyListeners(instanceId);
  }, [instanceId]);

  // Not connected
  if (connectionState !== 'connected') {
    return (
      <View style={styles.empty}>
        <Code2 size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          Connect to a server to view files
        </Text>
      </View>
    );
  }

  // No open files
  if (openFiles.length === 0) {
    return (
      <View style={styles.empty}>
        <FileText size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          No files open{'\n'}
          Open files from the Explorer or AI tool calls
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* File tabs */}
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScroll}
        >
          {openFiles.map((file) => {
            const isSelected = file.path === activeFilePath;
            const fileName = file.path.split('/').pop() || file.path;
            return (
              <Pressable
                key={file.path}
                style={[styles.tab, isSelected && styles.tabActive]}
                onPress={() => handleSelectFile(file.path)}
              >
                <Code2
                  size={12}
                  color={isSelected ? colors.accent.primary : colors.fg.muted}
                />
                <Text
                  style={[styles.tabText, isSelected && styles.tabTextActive]}
                  numberOfLines={1}
                >
                  {fileName}
                </Text>
                <Pressable
                  style={styles.tabClose}
                  onPress={() => handleCloseFile(file.path)}
                  hitSlop={8}
                >
                  <X size={10} color={colors.fg.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* File content */}
      {activeFile?.loading ? (
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
        </View>
      ) : activeFile?.error ? (
        <View style={styles.empty}>
          <Text style={[textStyles.body, { color: colors.semantic.error }]}>
            {activeFile.error}
          </Text>
        </View>
      ) : activeFile ? (
        <ScrollView
          style={styles.codeScroll}
          horizontal={false}
          showsVerticalScrollIndicator
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.codeContainer}>
              {activeFile.content.split('\n').map((line, idx) => (
                <View key={idx} style={styles.codeLine}>
                  <Text style={styles.lineNumber}>{idx + 1}</Text>
                  <Text style={styles.lineContent}>{line || ' '}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </ScrollView>
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin API (for GPI cross-plugin calls)
// ----------------------------------------------------------

function getEditorClient(serverId?: string) {
  if (!serverId) return undefined;
  return useConnectionStore.getState().getClientForServer(serverId);
}

function editorApi(): EditorPluginAPI {
  return {
    openFile: async (path, line) => {
      // Find first editor instance, or use a global fallback
      const [firstInstanceId] = instanceStateMap.keys();
      if (!firstInstanceId) return;

      const s = getInstanceState(firstInstanceId);

      // Check if already open
      if (s.openFiles.find((f) => f.path === path)) {
        s.activeFilePath = path;
        notifyListeners(firstInstanceId);
        return;
      }

      // Add as loading
      const file: OpenFile = { path, content: '', loading: true, error: null };
      s.openFiles = [...s.openFiles, file];
      s.activeFilePath = path;
      notifyListeners(firstInstanceId);

      try {
        const serverId = useConnectionStore.getState().savedConnections[0]?.id;
        const result = await getEditorClient(serverId)?.request<{ content: string }>('fs.read', { path });
        const content = result?.content || '(unable to read file)';
        s.openFiles = s.openFiles.map((f) =>
          f.path === path ? { ...f, content, loading: false } : f,
        );
      } catch (err) {
        s.openFiles = s.openFiles.map((f) =>
          f.path === path
            ? { ...f, loading: false, error: err instanceof Error ? err.message : 'Failed to load' }
            : f,
        );
      }
      notifyListeners(firstInstanceId);
    },

    saveFile: async (path) => {
      const [firstInstanceId] = instanceStateMap.keys();
      if (!firstInstanceId) return;
      const s = getInstanceState(firstInstanceId);
      const file = s.openFiles.find((f) => f.path === path);
      if (!file) return;
      const serverId = useConnectionStore.getState().savedConnections[0]?.id;
      await getEditorClient(serverId)?.request('fs.write', {
        path,
        content: file.content,
      });
    },

    getCurrentFile: () => {
      const [firstInstanceId] = instanceStateMap.keys();
      if (!firstInstanceId) return null;
      return getInstanceState(firstInstanceId).activeFilePath;
    },
  };
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const editorPlugin: WorkspacePluginDefinition = {
  id: 'editor',
  name: 'Editor',
  description: 'Source code viewer with syntax highlighting',
  scope: 'workspace',
  kind: 'core',
  icon: Code2,
  component: EditorPanel,
  navOrder: 1,
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
  empty: {
    flex: 1,
    backgroundColor: colors.bg.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },

  // Tab bar
  tabBar: {
    backgroundColor: colors.bg.raised,
    height: 32,
  },
  tabScroll: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[1],
    gap: 1,
  },
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    height: 32,
    maxWidth: 160,
  },
  tabActive: {
    backgroundColor: colors.bg.base,
  },
  tabText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
  tabTextActive: {
    color: colors.fg.primary,
  },
  tabClose: {
    width: 16,
    height: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Code display
  codeScroll: {
    flex: 1,
  },
  codeContainer: {
    padding: spacing[2],
    minWidth: '100%',
  },
  codeLine: {
    flexDirection: 'row',
    minHeight: 20,
  },
  lineNumber: {
    width: 44,
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.muted,
    textAlign: 'right',
    paddingRight: spacing[3],
    lineHeight: 20,
  },
  lineContent: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
    lineHeight: 20,
  },
});
