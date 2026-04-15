// WHAT: System Search plugin — server-scoped search across the host machine.
// WHY:  Replaces the Phase 0/7b "Coming in Phase 7c" stub with a real search UI.
//       Searches file names (fs.search) AND file content (fs.grep) across the
//       server's workspaceRoot. Server-scoped: searches the whole host, not just
//       one session's folder.
// HOW:  scope: 'server' — receives serverId, not session. Search root is the
//       server's workspaceRoot (ctx.workspaceRoot on the daemon). Queries both
//       fs.search (filename match) and fs.grep (content match) in parallel.
//       Results are merged, deduped, and displayed in SearchResults (FlashList).
//       Respects the 10s timeout built into fs.grep on the server side.
//       Zero hardcoded colors/fonts/spacing — all from theme/tokens.ts.
// SEE:  apps/mobile/src/plugins/server/system-search/components/SearchResults.tsx,
//       packages/server-core/src/handlers/fs.ts (fs.grep, fs.search RPCs),
//       docs/PROTOCOL.md §5.5

import React, { useState, useCallback, useRef } from 'react';
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
import type { ServerPluginDefinition, ServerPluginPanelProps } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';
import { SearchResults } from './components/SearchResults';
import type { SearchMatch } from './components/SearchResults';
import { colors, typography, spacing, radii } from '../../../theme';

// ----------------------------------------------------------
// Panel
// ----------------------------------------------------------

function SystemSearchPanel({ serverId }: ServerPluginPanelProps) {
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
// Plugin definition — scope: 'server' (searches the whole host)
// ----------------------------------------------------------

export const systemSearchPlugin: ServerPluginDefinition = {
  id: 'system-search',
  name: 'System Search',
  description: 'Search across the entire host machine.',
  scope: 'server',
  kind: 'extra',
  icon: Search,
  component: SystemSearchPanel,
};

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    gap: spacing[2],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
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
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  idleText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
});
