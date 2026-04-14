// WHAT: Top toolbar for the Editor plugin panel.
// WHY:  Provides Save, Undo, Redo, Find, and file-tree toggle actions.
//       In Phase 4a these are structural stubs (Save/Undo/Redo are no-ops;
//       only the tree toggle is functional). Phase 4b wires Save through the
//       WebView bridge and Undo/Redo/Find through postMessage.
// HOW:  Accepts an onAction callback so EditorSurface can register the bridge
//       handler. onToggleTree shows/hides the FileTree on phone-size screens.
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx,
//       apps/mobile/src/plugins/workspace/editor/index.tsx

import React from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import {
  Save,
  Undo2,
  Redo2,
  Search,
  PanelLeft,
} from 'lucide-react-native';
import { colors, typography, spacing } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type EditorAction = 'save' | 'undo' | 'redo' | 'find' | 'format';

interface EditorToolbarProps {
  /** Whether the tree pane is currently pinned (tablet) or toggle-visible (phone) */
  treeVisible: boolean;
  onToggleTree: () => void;

  /** Called when a toolbar action is pressed. EditorSurface wires these in 4b. */
  onAction: (action: EditorAction) => void;

  /** True when the active file has unsaved changes */
  isDirty: boolean;

  /** Cursor position, shown at right of toolbar */
  cursor?: { line: number; col: number };

  /** Active file name for display */
  fileName?: string;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const EditorToolbar = React.memo(function EditorToolbar({
  treeVisible,
  onToggleTree,
  onAction,
  isDirty,
  cursor,
  fileName,
}: EditorToolbarProps) {
  return (
    <View style={styles.toolbar}>
      {/* Left: tree toggle + file name */}
      <View style={styles.left}>
        <Pressable
          onPress={onToggleTree}
          hitSlop={8}
          style={[styles.btn, treeVisible && styles.btnActive]}
        >
          <PanelLeft
            size={16}
            color={treeVisible ? colors.accent.primary : colors.fg.muted}
          />
        </Pressable>
        {fileName ? (
          <Text style={styles.fileName} numberOfLines={1}>
            {fileName}
            {isDirty ? ' ●' : ''}
          </Text>
        ) : null}
      </View>

      {/* Right: actions */}
      <View style={styles.right}>
        <ToolbarBtn
          icon={<Search size={15} color={colors.fg.muted} />}
          onPress={() => onAction('find')}
          label="Find"
        />
        <ToolbarBtn
          icon={<Undo2 size={15} color={colors.fg.muted} />}
          onPress={() => onAction('undo')}
          label="Undo"
        />
        <ToolbarBtn
          icon={<Redo2 size={15} color={colors.fg.muted} />}
          onPress={() => onAction('redo')}
          label="Redo"
        />
        <ToolbarBtn
          icon={<Save size={15} color={isDirty ? colors.accent.primary : colors.fg.muted} />}
          onPress={() => onAction('save')}
          label="Save"
          highlight={isDirty}
        />
        {cursor && (
          <Text style={styles.cursor}>
            {cursor.line}:{cursor.col}
          </Text>
        )}
      </View>
    </View>
  );
});

// ----------------------------------------------------------
// Toolbar button helper
// ----------------------------------------------------------

function ToolbarBtn({
  icon,
  onPress,
  label,
  highlight,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  label: string;
  highlight?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [
        styles.btn,
        pressed && styles.btnPressed,
        highlight && styles.btnHighlight,
      ]}
      accessibilityLabel={label}
    >
      {icon}
    </Pressable>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  toolbar: {
    height: 36,
    backgroundColor: colors.bg.overlay,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    gap: spacing[1],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  left: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    overflow: 'hidden',
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  btn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
  },
  btnActive: {
    backgroundColor: colors.accent.subtle,
  },
  btnPressed: {
    backgroundColor: colors.bg.active,
  },
  btnHighlight: {
    backgroundColor: colors.accent.subtle,
  },
  fileName: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    color: colors.fg.tertiary,
    fontFamily: typography.fontFamily.mono,
  },
  cursor: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
    marginLeft: spacing[2],
  },
});
