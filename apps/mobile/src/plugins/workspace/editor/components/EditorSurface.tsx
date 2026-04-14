// WHAT: Content area of the Editor plugin — displays the active file's content.
// WHY:  Phase 4a uses a plain-text ScrollView as a read-only placeholder.
//       Phase 4b replaces this component with a WebView + CodeMirror 6 bridge.
// HOW:  Reads the active OpenFile from EditorStore and renders it in a
//       horizontally and vertically scrollable monospace view with line numbers.
//       Binary files show a card; loading and error states are handled.
// SEE:  apps/mobile/src/plugins/workspace/editor/store.ts (OpenFile shape),
//       apps/mobile/src/plugins/workspace/editor/index.tsx

import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { FileText, AlertCircle } from 'lucide-react-native';
import { colors, typography, spacing } from '../../../../theme';
import type { OpenFile } from '../store';
import type { EditorAction } from './EditorToolbar';

// ----------------------------------------------------------
// Binary extension detection (Phase 4b: isBinary helper)
// ----------------------------------------------------------

const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'svg',
  'pdf', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin',
  'mp3', 'mp4', 'wav', 'ogg', 'flac', 'aac',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'db', 'sqlite', 'sqlite3',
  'class', 'jar',
  'pyc', 'pyo',
]);

export function isBinary(path: string): boolean {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return BINARY_EXTENSIONS.has(ext);
}

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface EditorSurfaceProps {
  /** The currently active open file (or undefined if none) */
  activeFile: OpenFile | undefined;
  /** Called when toolbar actions fire (no-op in 4a; wired to bridge in 4b) */
  onAction?: (action: EditorAction) => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function EditorSurface({ activeFile }: EditorSurfaceProps) {
  if (!activeFile) {
    return (
      <View style={styles.empty}>
        <FileText size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>
          Open a file from the tree or tap a file in the Explorer
        </Text>
      </View>
    );
  }

  if (activeFile.loading) {
    return (
      <View style={styles.empty}>
        <ActivityIndicator size="small" color={colors.accent.primary} />
      </View>
    );
  }

  if (activeFile.error) {
    return (
      <View style={styles.empty}>
        <AlertCircle size={24} color={colors.semantic.error} />
        <Text style={[styles.emptyText, { color: colors.semantic.error }]}>
          {activeFile.error}
        </Text>
      </View>
    );
  }

  if (isBinary(activeFile.path)) {
    return (
      <View style={styles.empty}>
        <FileText size={32} color={colors.fg.muted} />
        <Text style={styles.emptyText}>Binary file — preview not available</Text>
        <Text style={styles.emptySubText}>{activeFile.path.split('/').pop()}</Text>
      </View>
    );
  }

  // Plain-text display (Phase 4a placeholder)
  const lines = activeFile.content.split('\n');

  return (
    <ScrollView
      style={styles.codeScroll}
      showsVerticalScrollIndicator
      contentContainerStyle={styles.codeContent}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View>
          {lines.map((line, idx) => (
            <View key={idx} style={styles.codeLine}>
              <Text style={styles.lineNumber}>{idx + 1}</Text>
              <Text style={styles.lineContent}>{line || ' '}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </ScrollView>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
    backgroundColor: colors.bg.base,
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  emptySubText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },

  // Code display
  codeScroll: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  codeContent: {
    padding: spacing[2],
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
    flexShrink: 0,
  },
  lineContent: {
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
    lineHeight: 20,
  },
});
