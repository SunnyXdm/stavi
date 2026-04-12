// ============================================================
// Extra Plugin: Explorer
// ============================================================
// File tree browser. Lists project files via Stavi's
// projects.searchEntries RPC. Tap file → opens in Editor via GPI.

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import {
  FolderTree,
  Folder,
  FolderOpen,
  FileText,
  FileCode,
  ChevronRight,
  ChevronDown,
  Search,
} from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { textStyles } from '../../../theme/styles';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';
import { gPI } from '../../../services/gpi';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileEntry[];
  expanded?: boolean;
  depth: number;
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function ExplorerPanel({ instanceId, isActive }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [entries, setEntries] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch project entries
  const fetchEntries = useCallback(async () => {
    if (staviClient.getState() !== 'connected') return;

    setLoading(true);
    try {
      const result = await staviClient.request<{
        entries: Array<{ name: string; path: string; type: string }>;
      }>('fs.search', {
        query: searchQuery || '*',
        limit: 200,
      });

      // Build flat list with depth info
      const flat: FileEntry[] = (result.entries || []).map((entry: any) => {
        const depth = (entry.path || '').split('/').length - 1;
        return {
          name: entry.name || entry.path?.split('/').pop() || '',
          path: entry.path || '',
          type: entry.type === 'directory' ? 'directory' : 'file',
          depth: Math.min(depth, 6),
        };
      });

      setEntries(flat);
    } catch (err) {
      console.error('[Explorer] Fetch error:', err);
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [searchQuery]);

  useEffect(() => {
    if (connectionState === 'connected') {
      fetchEntries();
    }
  }, [connectionState, fetchEntries]);

  const handleTapFile = useCallback(async (entry: FileEntry) => {
    if (entry.type === 'directory') return;

    try {
      // Open in editor via GPI
      await gPI.editor.openFile(entry.path);
    } catch (err) {
      console.error('[Explorer] Open file error:', err);
    }
  }, []);

  // Not connected
  if (connectionState !== 'connected') {
    return (
      <View style={styles.empty}>
        <FolderTree size={32} color={colors.fg.muted} />
        <Text style={[textStyles.body, { color: colors.fg.muted, textAlign: 'center' }]}>
          Connect to a server to browse files
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Search size={16} color={colors.fg.muted} />
        <TextInput
          style={styles.searchInput}
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder="Search files..."
          placeholderTextColor={colors.fg.muted}
          returnKeyType="search"
          onSubmitEditing={fetchEntries}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      {/* File list */}
      {loading ? (
        <View style={styles.empty}>
          <ActivityIndicator size="small" color={colors.accent.primary} />
        </View>
      ) : (
        <FlatList
          data={entries}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [
                styles.fileRow,
                { paddingLeft: spacing[4] + item.depth * spacing[4] },
                pressed && styles.fileRowPressed,
              ]}
              onPress={() => handleTapFile(item)}
            >
              {item.type === 'directory' ? (
                <Folder size={16} color={colors.semantic.warning} />
              ) : (
                <FileIcon name={item.name} />
              )}
              <Text style={styles.fileName} numberOfLines={1}>
                {item.name}
              </Text>
            </Pressable>
          )}
          keyExtractor={(item) => item.path}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            <View style={styles.emptyList}>
              <Text style={styles.emptyListText}>No files found</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

// File icon based on extension
function FileIcon({ name }: { name: string }) {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  const codeExts = ['ts', 'tsx', 'js', 'jsx', 'kt', 'swift', 'py', 'rs', 'go', 'java', 'rb', 'cpp', 'c', 'h'];

  if (codeExts.includes(ext)) {
    return <FileCode size={16} color={colors.semantic.info} />;
  }
  return <FileText size={16} color={colors.fg.tertiary} />;
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const explorerPlugin: PluginDefinition = {
  id: 'explorer',
  name: 'Explorer',
  description: 'Browse and manage project files',
  kind: 'extra',
  icon: FolderTree,
  component: ExplorerPanel,
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

  // Search bar
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    marginHorizontal: spacing[3],
    marginVertical: spacing[2],
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    gap: spacing[2],
    height: 36,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    padding: 0,
  },

  // File list
  listContent: {
    paddingBottom: spacing[4],
  },
  fileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    paddingVertical: spacing[2],
    paddingRight: spacing[4],
    minHeight: 36,
  },
  fileRowPressed: {
    backgroundColor: colors.bg.active,
  },
  fileName: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
  },
  emptyList: {
    alignItems: 'center',
    paddingTop: spacing[16],
  },
  emptyListText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
});
