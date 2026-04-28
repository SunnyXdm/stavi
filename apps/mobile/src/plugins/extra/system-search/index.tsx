// WHAT: System Search plugin — search across the host machine (workspace tab, Phase 9).
// WHY:  Phase 9 promotes server-scoped plugins to workspace tabs so they're reachable
//       from the Tabs modal without a separate ServerToolsSheet.
// HOW:  scope: 'workspace' — receives WorkspacePluginPanelProps; extracts serverId from
//       session.serverId. Search RPCs unchanged (fs.search + fs.grep in parallel).
// SEE:  apps/mobile/src/plugins/extra/system-search/components/SearchResults.tsx,
//       packages/server-core/src/handlers/fs.ts, plans/09-navigation-overhaul.md §4

import React, { useState, useCallback, useRef, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { Search, X } from 'lucide-react-native';
import type { WorkspacePluginDefinition, WorkspacePluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { useTheme } from '../../../theme';
import { typography, spacing, radii } from '../../../theme';
import { SearchResults } from './components/SearchResults';
import type { SearchMatch } from './components/SearchResults';

// ----------------------------------------------------------
// Panel
// ----------------------------------------------------------

function SystemSearchPanel({ session }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.bg.base,
    },
    inputRow: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      gap: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    inputWrap: {
      flex: 1,
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: colors.bg.input,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      gap: spacing[2],
      height: 36,
    },
    input: {
      flex: 1,
      fontSize: typography.fontSize.sm,
      color: colors.fg.primary,
      padding: 0,
    },
    searchBtn: {
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      height: 36,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      minWidth: 72,
    },
    searchBtnDisabled: {
      opacity: 0.5,
    },
    searchBtnText: {
      fontSize: typography.fontSize.sm,
      fontFamily: typography.fontFamily.sansSemiBold,
      color: colors.fg.onAccent,
    },
    metaBar: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.dividerSubtle,
    },
    metaText: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
    },
    errorBanner: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      backgroundColor: colors.semantic.errorSubtle,
    },
    errorText: {
      fontSize: typography.fontSize.sm,
      color: colors.semantic.error,
    },
    center: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: spacing[3],
      padding: spacing[6],
    },
    idleText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.muted,
      textAlign: 'center' as const,
      lineHeight: 20,
    },
    emptyText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.muted,
      textAlign: 'center' as const,
    },
  }), [colors]);

  const serverId = session.serverId;
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<SearchMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchMeta, setSearchMeta] = useState<{
    fileCount: number;
    elapsedMs: number;
  } | null>(null);
  const abortRef = useRef(false);

  const getClient = useConnectionStore((s) => s.getClientForServer);

  const handleSearch = useCallback(async () => {
    const q = query.trim();
    if (!q) return;

    const client = getClient(serverId);
    if (!client || client.getState() !== 'connected') {
      setError('Server not connected');
      return;
    }

    abortRef.current = false;
    setSearching(true);
    setError(null);
    setMatches([]);
    setSearchMeta(null);

    const startMs = Date.now();
    const combined: SearchMatch[] = [];

    try {
      // Run filename search and content search in parallel
      const [filenameResult, contentResult] = await Promise.allSettled([
        client.request<{
          entries: Array<{ name: string; path: string; type: string }>;
        }>('fs.search', { query: q, limit: 100 }),

        client.request<{
          matches: Array<{ file: string; line: number; text: string }>;
        }>('fs.grep', { pattern: q, limit: 200 }),
      ]);

      if (abortRef.current) return;

      // Add filename matches
      if (filenameResult.status === 'fulfilled') {
        for (const entry of filenameResult.value.entries ?? []) {
          if (entry.type === 'file') {
            combined.push({
              file: entry.path,
              kind: 'filename',
            });
          }
        }
      }

      // Add content matches
      if (contentResult.status === 'fulfilled') {
        for (const m of contentResult.value.matches ?? []) {
          combined.push({
            file: m.file,
            line: m.line,
            text: m.text,
            kind: 'content',
          });
        }
      }

      // Dedup: if a file appears both as a filename match and content match,
      // keep the content matches (more informative). Remove bare filename entries
      // for files that already have content matches.
      const contentFiles = new Set(
        combined.filter((m) => m.kind === 'content').map((m) => m.file),
      );
      const deduped = combined.filter(
        (m) => m.kind === 'content' || !contentFiles.has(m.file),
      );

      const elapsedMs = Date.now() - startMs;
      setMatches(deduped);
      setSearchMeta({ fileCount: deduped.length, elapsedMs });
    } catch (err) {
      if (!abortRef.current) {
        const msg = err instanceof Error ? err.message : 'Search failed';
        setError(msg.includes('timeout') ? 'Search timed out — try a more specific query' : msg);
      }
    } finally {
      if (!abortRef.current) setSearching(false);
    }
  }, [query, serverId, getClient]);

  const handleClear = useCallback(() => {
    abortRef.current = true;
    setQuery('');
    setMatches([]);
    setError(null);
    setSearchMeta(null);
    setSearching(false);
  }, []);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Search input */}
      <View style={styles.inputRow}>
        <View style={styles.inputWrap}>
          <Search size={16} color={colors.fg.muted} />
          <TextInput
            style={styles.input}
            value={query}
            onChangeText={setQuery}
            placeholder="Search filenames and content…"
            placeholderTextColor={colors.fg.muted}
            returnKeyType="search"
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query.length > 0 && (
            <Pressable onPress={handleClear} hitSlop={8}>
              <X size={14} color={colors.fg.muted} />
            </Pressable>
          )}
        </View>
        <Pressable
          style={[styles.searchBtn, searching && styles.searchBtnDisabled]}
          onPress={handleSearch}
          disabled={searching || !query.trim()}
        >
          {searching ? (
            <ActivityIndicator size="small" color={colors.fg.onAccent} />
          ) : (
            <Text style={styles.searchBtnText}>Search</Text>
          )}
        </Pressable>
      </View>

      {/* Meta line */}
      {searchMeta && !searching && (
        <View style={styles.metaBar}>
          <Text style={styles.metaText}>
            {searchMeta.fileCount} result{searchMeta.fileCount !== 1 ? 's' : ''} · {searchMeta.elapsedMs}ms
          </Text>
        </View>
      )}

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* Empty state (after a search with no results) */}
      {!searching && !error && searchMeta && matches.length === 0 && (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No results for "{query}"</Text>
        </View>
      )}

      {/* Idle state (before first search) */}
      {!searching && !error && !searchMeta && (
        <View style={styles.center}>
          <Search size={32} color={colors.fg.muted} />
          <Text style={styles.idleText}>
            Search filenames and file contents{'\n'}across the entire server
          </Text>
        </View>
      )}

      {/* Results */}
      {matches.length > 0 && !searching && (
        <SearchResults
          matches={matches}
          searchRoot=""
        />
      )}
    </KeyboardAvoidingView>
  );
}

// ----------------------------------------------------------
// Plugin definition — scope: 'workspace', kind: 'extra' (appears in Tabs modal)
// ----------------------------------------------------------

export const systemSearchPlugin: WorkspacePluginDefinition = {
  id: 'search',
  name: 'Search',
  description: 'Search filenames and content across the workspace.',
  scope: 'workspace',
  kind: 'extra',
  icon: Search,
  component: SystemSearchPanel,
};

// Styles computed dynamically via useMemo — see component body.
