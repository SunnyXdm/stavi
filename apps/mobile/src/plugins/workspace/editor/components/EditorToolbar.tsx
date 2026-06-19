// WHAT: THE editor header (the plugin sets hideHeader, so this is the only
//       top bar): drawer hamburger + filename + Find/Undo/Redo/Save + cursor.
// WHY:  PluginHeader + EditorToolbar stacked two bars and wasted 44px; the
//       file tree lives in the workspace drawer now (drawerContent).
// HOW:  Accepts an onAction callback so EditorSurface can register the bridge
//       handler; onOpenDrawer opens the SessionDrawer (file tree).
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx,
//       apps/mobile/src/plugins/workspace/editor/index.tsx

import React, { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import {
  Save,
  Undo2,
  Redo2,
  Search,
  Menu,
} from 'lucide-react-native';
import { useTheme, typography, spacing } from '../../../../theme';
import type { Colors } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type EditorAction = 'save' | 'undo' | 'redo' | 'find';

interface EditorToolbarProps {
  /** Opens the workspace drawer (which hosts the file tree). */
  onOpenDrawer?: () => void;

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
// Styles factory (used by EditorToolbar + ToolbarBtn)
// ----------------------------------------------------------

function createToolbarStyles(colors: Colors) {
  return StyleSheet.create({
    toolbar: { height: 44, backgroundColor: colors.bg.overlay, flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[2], gap: spacing[1], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    left: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing[2], overflow: 'hidden' },
    right: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
    btn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 6 },
    btnActive: { backgroundColor: colors.accent.subtle },
    btnPressed: { backgroundColor: colors.bg.active },
    btnHighlight: { backgroundColor: colors.accent.subtle },
    fileName: { flex: 1, fontSize: typography.fontSize.xs, color: colors.fg.tertiary, fontFamily: typography.fontFamily.mono },
    cursor: { fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono, marginLeft: spacing[2] },
  });
}

type ToolbarStyles = ReturnType<typeof createToolbarStyles>;

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const EditorToolbar = React.memo(function EditorToolbar({
  onOpenDrawer,
  onAction,
  isDirty,
  cursor,
  fileName,
}: EditorToolbarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createToolbarStyles(colors), [colors]);

  return (
    <View style={styles.toolbar}>
      {/* Left: drawer hamburger + file name */}
      <View style={styles.left}>
        <Pressable
          onPress={onOpenDrawer}
          hitSlop={8}
          style={styles.btn}
          accessibilityLabel="Open drawer"
        >
          <Menu size={18} color={colors.fg.secondary} />
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
          styles={styles}
        />
        <ToolbarBtn
          icon={<Undo2 size={15} color={colors.fg.muted} />}
          onPress={() => onAction('undo')}
          label="Undo"
          styles={styles}
        />
        <ToolbarBtn
          icon={<Redo2 size={15} color={colors.fg.muted} />}
          onPress={() => onAction('redo')}
          label="Redo"
          styles={styles}
        />
        <ToolbarBtn
          icon={<Save size={15} color={isDirty ? colors.accent.primary : colors.fg.muted} />}
          onPress={() => onAction('save')}
          label="Save"
          highlight={isDirty}
          styles={styles}
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
  styles,
}: {
  icon: React.ReactNode;
  onPress: () => void;
  label: string;
  highlight?: boolean;
  styles: ToolbarStyles;
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

// Styles computed dynamically via createToolbarStyles — see component body.
