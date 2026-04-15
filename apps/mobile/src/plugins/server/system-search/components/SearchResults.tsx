// WHAT: SearchResults — FlashList of system search matches for the System Search plugin.
// WHY:  Renders the results of fs.grep and fs.search in a scannable, tappable list.
//       Each row shows the relative file path, optional match line/preview, and line
//       number. Tapping a result emits 'editor.openFile' if a connected session owns
//       the file; otherwise shows a toast that the file is not in any open session.
// HOW:  Receives a flat array of SearchMatch. FlashList renders rows efficiently.
//       File-path display is relative to the search root when possible.
//       Uses only tokens from theme/tokens.ts — zero hardcoded values.
// SEE:  apps/mobile/src/plugins/server/system-search/index.tsx (host),
//       apps/mobile/src/services/event-bus.ts ('editor.openFile' event),
//       packages/server-core/src/handlers/fs.ts (fs.grep RPC)

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ToastAndroid,
  Platform,
  Alert,
} from 'react-native';
import { FileCode, FileText } from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import { eventBus } from '../../../../services/event-bus';
import { useSessionsStore } from '../../../../stores/sessions-store';
import { colors, typography, spacing, radii } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface SearchMatch {
  file: string;          // path as returned by server (absolute or relative)
  line?: number;
  text?: string;         // match preview line
  kind: 'content' | 'filename';
}

interface SearchResultsProps {
  matches: SearchMatch[];
  searchRoot: string;    // path the search was scoped to (for display purposes)
  onResultPress?: (match: SearchMatch) => void;
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function relativePath(fullPath: string, root: string): string {
  if (fullPath.startsWith(root + '/')) return fullPath.slice(root.length + 1);
  if (fullPath.startsWith(root)) return fullPath.slice(root.length);
  return fullPath;
}

function showToast(msg: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.show(msg, ToastAndroid.SHORT);
  } else {
    Alert.alert('', msg, [{ text: 'OK' }]);
  }
}

// ----------------------------------------------------------
// Row
// ----------------------------------------------------------

const ResultRow = memo(function ResultRow({
  match,
  searchRoot,
}: {
  match: SearchMatch;
  searchRoot: string;
}) {
  const allSessions = useSessionsStore((s) =>
    Object.values(s.sessionsByServer).flat(),
  );

  const handlePress = useCallback(() => {
    // Find a session whose folder contains this file
    const owner = allSessions.find((sess) => match.file.startsWith(sess.folder));
    if (owner) {
      eventBus.emit('editor.openFile', {
        sessionId: owner.id,
        path: match.file,
        line: match.line,
      });
    } else {
      showToast('File not in any open session');
    }
  }, [match, allSessions]);

  const rel = relativePath(match.file, searchRoot);
  const ext = match.file.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = ['ts','tsx','js','jsx','py','rs','go','java','kt','swift','rb','c','h','cpp'];
  const IconComponent = codeExts.includes(ext) ? FileCode : FileText;
  const iconColor = codeExts.includes(ext) ? colors.semantic.info : colors.fg.tertiary;

  return (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
      onPress={handlePress}
    >
      <IconComponent size={16} color={iconColor} />
      <View style={styles.rowContent}>
        <Text style={styles.filePath} numberOfLines={1}>{rel}</Text>
        {match.text ? (
          <Text style={styles.matchPreview} numberOfLines={2}>{match.text.trim()}</Text>
        ) : null}
      </View>
      {match.line !== undefined && (
        <Text style={styles.lineNumber}>:{match.line}</Text>
      )}
    </Pressable>
  );
});

// ----------------------------------------------------------
// List
// ----------------------------------------------------------

export const SearchResults = memo(function SearchResults({
  matches,
  searchRoot,
}: SearchResultsProps) {
  const renderItem = useCallback(({ item }: { item: SearchMatch }) => (
    <ResultRow match={item} searchRoot={searchRoot} />
  ), [searchRoot]);

  const keyExtractor = useCallback((item: SearchMatch, index: number) =>
    `${item.file}:${item.line ?? ''}:${index}`,
  []);

  return (
    <FlashList
      data={matches}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      contentContainerStyle={styles.listContent}
    />
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    gap: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.dividerSubtle,
    minHeight: 48,
  },
  rowPressed: {
    backgroundColor: colors.bg.active,
  },
  rowContent: {
    flex: 1,
    gap: spacing[1],
  },
  filePath: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
  },
  matchPreview: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.muted,
  },
  lineNumber: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.accent.primary,
    alignSelf: 'flex-start',
    marginTop: 2,
  },
  listContent: {
    paddingBottom: spacing[4],
  },
});
