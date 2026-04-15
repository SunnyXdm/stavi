// WHAT: ExplorerList — FlashList of FsEntry items with multi-select checkboxes.
// WHY:  The core content area of the Explorer plugin. Uses FlashList for
//       performance on directories with many files. Multi-select mode is
//       entered via long-press; tap toggles within that mode.
// HOW:  Each row shows: checkbox (in selection mode), type icon, name, size.
//       Long-press → enterSelectionMode + toggleSelection.
//       Tap in selection mode → toggleSelection.
//       Tap in normal mode → navigate (dir) or openFile event (file).
//       Emits 'editor.openFile' and 'terminal.openHere' via the event bus.
//       Uses only tokens from theme/tokens.ts — zero hardcoded colors/spacing.
// SEE:  apps/mobile/src/plugins/shared/explorer/store.ts,
//       apps/mobile/src/plugins/shared/explorer/index.tsx,
//       apps/mobile/src/services/event-bus.ts

import React, { memo, useCallback } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
} from 'react-native';
import {
  Folder,
  FileText,
  FileCode,
  Check,
  Square,
  Film,
  Image as ImageIcon,
  Archive,
} from 'lucide-react-native';
import { FlashList } from '@shopify/flash-list';
import type { FsEntry } from '../store';
import { colors, typography, spacing, radii } from '../../../../theme';
import { eventBus } from '../../../../services/event-bus';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface ExplorerListProps {
  sessionId: string;
  entries: FsEntry[];
  selection: Set<string>;
  isSelecting: boolean;
  onNavigate: (path: string) => void;
  onLongPress: (path: string) => void;
  onToggleSelect: (path: string) => void;
  onRefresh: () => void;
  refreshing: boolean;
}

// ----------------------------------------------------------
// File icon helper
// ----------------------------------------------------------

function FileIcon({ name, size = 16 }: { name: string; size?: number }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const codeExts = [
    'ts','tsx','js','jsx','mjs','cjs','py','rs','go','java','kt','swift',
    'rb','cpp','c','h','cs','php','vue','svelte','sh','bash','zsh',
  ];
  const mediaExts = ['mp4','mov','avi','mkv','webm','mp3','wav','flac','ogg'];
  const imgExts = ['png','jpg','jpeg','gif','svg','webp','bmp','ico'];
  const archiveExts = ['zip','tar','gz','bz2','xz','rar','7z'];

  if (codeExts.includes(ext)) return <FileCode size={size} color={colors.semantic.info} />;
  if (mediaExts.includes(ext)) return <Film size={size} color={colors.semantic.warning} />;
  if (imgExts.includes(ext)) return <ImageIcon size={size} color={colors.semantic.success} />;
  if (archiveExts.includes(ext)) return <Archive size={size} color={colors.semantic.warning} />;
  return <FileText size={size} color={colors.fg.tertiary} />;
}

function formatSize(bytes?: number): string {
  if (bytes === undefined || bytes < 0) return '';
  if (bytes === 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ----------------------------------------------------------
// Row
// ----------------------------------------------------------

const EntryRow = memo(function EntryRow({
  entry,
  selected,
  isSelecting,
  sessionId,
  onNavigate,
  onLongPress,
  onToggleSelect,
}: {
  entry: FsEntry;
  selected: boolean;
  isSelecting: boolean;
  sessionId: string;
  onNavigate: (path: string) => void;
  onLongPress: (path: string) => void;
  onToggleSelect: (path: string) => void;
}) {
  const isDir = entry.type === 'directory';

  const handlePress = useCallback(() => {
    if (isSelecting) {
      onToggleSelect(entry.path);
      return;
    }
    if (isDir) {
      onNavigate(entry.path);
    } else {
      eventBus.emit('editor.openFile', { sessionId, path: entry.path });
    }
  }, [isSelecting, isDir, entry.path, sessionId, onNavigate, onToggleSelect]);

  const handleLongPress = useCallback(() => {
    onLongPress(entry.path);
  }, [entry.path, onLongPress]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.row,
        pressed && styles.rowPressed,
        selected && styles.rowSelected,
      ]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      delayLongPress={350}
    >
      {/* Checkbox (only visible in selection mode) */}
      {isSelecting && (
        <View style={[styles.checkbox, selected && styles.checkboxSelected]}>
          {selected && <Check size={12} color={colors.fg.onAccent} />}
        </View>
      )}

      {/* Entry icon */}
      {isDir ? (
        <Folder size={18} color={colors.semantic.warning} />
      ) : (
        <FileIcon name={entry.name} size={18} />
      )}

      {/* Name */}
      <Text style={[styles.name, isDir && styles.nameDir]} numberOfLines={1}>
        {entry.name}
      </Text>

      {/* Size (files only) */}
      {!isDir && entry.size !== undefined && (
        <Text style={styles.meta}>{formatSize(entry.size)}</Text>
      )}
    </Pressable>
  );
});

// ----------------------------------------------------------
// List
// ----------------------------------------------------------

export const ExplorerList = memo(function ExplorerList({
  sessionId,
  entries,
  selection,
  isSelecting,
  onNavigate,
  onLongPress,
  onToggleSelect,
  onRefresh,
  refreshing,
}: ExplorerListProps) {
  const renderItem = useCallback(({ item }: { item: FsEntry }) => (
    <EntryRow
      entry={item}
      selected={selection.has(item.path)}
      isSelecting={isSelecting}
      sessionId={sessionId}
      onNavigate={onNavigate}
      onLongPress={onLongPress}
      onToggleSelect={onToggleSelect}
    />
  ), [selection, isSelecting, sessionId, onNavigate, onLongPress, onToggleSelect]);

  const keyExtractor = useCallback((item: FsEntry) => item.path, []);

  return (
    <FlashList
      data={entries}
      renderItem={renderItem}
      keyExtractor={keyExtractor}
      onRefresh={onRefresh}
      refreshing={refreshing}
      contentContainerStyle={styles.listContent}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>This folder is empty</Text>
        </View>
      }
    />
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    gap: spacing[3],
    minHeight: 44,
  },
  rowPressed: {
    backgroundColor: colors.bg.active,
  },
  rowSelected: {
    backgroundColor: colors.accent.subtle,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: radii.sm,
    borderWidth: 1.5,
    borderColor: colors.fg.muted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxSelected: {
    backgroundColor: colors.accent.primary,
    borderColor: colors.accent.primary,
  },
  name: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
  },
  nameDir: {
    color: colors.fg.primary,
    fontFamily: typography.fontFamily.monoMedium,
  },
  meta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
  },
  listContent: {
    paddingBottom: spacing[4],
  },
  empty: {
    paddingTop: spacing[16],
    alignItems: 'center',
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
});
