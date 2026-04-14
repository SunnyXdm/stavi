// ============================================================
// Extra Plugin: Search
// ============================================================
// Full-text code search via the fs.grep RPC (ripgrep on server).
// Displays file:line results with a text snippet per match.
// Tap any match → opens the file in the Editor plugin via GPI.

import React, { useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  TextInput,
  ActivityIndicator,
  Keyboard,
} from 'react-native';
import { Search, FileCode, AlertCircle } from 'lucide-react-native';
import type { PluginDefinition, PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing, radii } from '../../../theme';
import { useConnectionStore } from '../../../stores/connection';
import { staviClient } from '../../../stores/stavi-client';
import { gPI } from '../../../services/gpi';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface SearchMatch {
  file: string;
  line: number;
  text: string;
}

// ----------------------------------------------------------
// Panel Component
// ----------------------------------------------------------

function SearchPanel({ instanceId, isActive }: PluginPanelProps) {
  const connectionState = useConnectionStore((s) => s.state);
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const inputRef = useRef<TextInput>(null);

  const runSearch = useCallback(async () => {
    const q = query.trim();
    if (!q || staviClient.getState() !== 'connected') return;

    Keyboard.dismiss();
    setLoading(true);
    setError(null);
    setSearched(true);

    try {
      const result = await staviClient.request<{ matches: SearchMatch[] }>('fs.grep', {
        pattern: q,
        limit: 200,
      });
      setMatches(result.matches ?? []);
    } catch (err: any) {
      setError(err?.message ?? 'Search failed');
      setMatches([]);
    } finally {
      setLoading(false);
    }
  }, [query]);

  const handleTapMatch = useCallback(async (match: SearchMatch) => {
    try {
      await gPI.editor.openFile(match.file, match.line);
    } catch (err) {
      console.error('[Search] Open file error:', err);
    }
  }, []);

  if (connectionState !== 'connected') {
    return (
      <View style={styles.centered}>
        <Search size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Connect to a server to search</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <View style={styles.searchBar}>
        <Search size={16} color={colors.fg.muted} />
        <TextInput
          ref={inputRef}
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={runSearch}
          placeholder="Search codebase..."
          placeholderTextColor={colors.fg.muted}
          returnKeyType="search"
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
        />
        {loading && <ActivityIndicator size="small" color={colors.accent.primary} />}
      </View>

      {/* Results */}
      {error ? (
        <View style={styles.centered}>
          <AlertCircle size={24} color={colors.semantic.error} />
          <Text style={[styles.emptyText, { color: colors.semantic.error }]}>{error}</Text>
        </View>
      ) : !searched ? (
        <View style={styles.centered}>
          <Text style={styles.hintText}>Type a pattern and press Search</Text>
        </View>
      ) : matches.length === 0 && !loading ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item, idx) => `${item.file}:${item.line}:${idx}`}
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.matchRow, pressed && styles.matchRowPressed]}
              onPress={() => handleTapMatch(item)}
            >
              <View style={styles.matchHeader}>
                <FileCode size={12} color={colors.accent.primary} />
                <Text style={styles.matchFile} numberOfLines={1}>
                  {item.file}
                  <Text style={styles.matchLine}>:{item.line}</Text>
                </Text>
              </View>
              <Text style={styles.matchText} numberOfLines={2}>
                {item.text.trim()}
              </Text>
            </Pressable>
          )}
          contentContainerStyle={styles.listContent}
          keyboardDismissMode="on-drag"
          ListHeaderComponent={
            matches.length > 0 ? (
              <Text style={styles.resultCount}>
                {matches.length} result{matches.length !== 1 ? 's' : ''}
              </Text>
            ) : null
          }
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------
// Plugin Definition
// ----------------------------------------------------------

export const workspaceSearchPlugin: PluginDefinition = {
  id: 'workspace-search',
  name: 'Search',
  description: 'Search across all project files',
  kind: 'extra',
  icon: Search,
  component: SearchPanel,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  searchBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    marginHorizontal: spacing[3],
    marginVertical: spacing[2],
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    gap: spacing[2],
    height: 40,
  },
  searchInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    padding: 0,
  },
  listContent: {
    paddingBottom: spacing[6],
  },
  resultCount: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
  },
  matchRow: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  matchRowPressed: {
    backgroundColor: colors.bg.active,
  },
  matchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginBottom: 2,
  },
  matchFile: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.accent.primary,
    fontFamily: typography.fontFamily.mono,
  },
  matchLine: {
    color: colors.fg.muted,
  },
  matchText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontFamily: typography.fontFamily.mono,
    lineHeight: 18,
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  hintText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
});
