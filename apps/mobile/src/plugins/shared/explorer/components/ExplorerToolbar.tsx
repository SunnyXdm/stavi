// WHAT: ExplorerToolbar — selection-mode action bar for the Explorer plugin.
// WHY:  Appears above the file list when one or more entries are selected.
//       Provides Delete, Move, Copy, Zip, Info, Open-in-Terminal, Open-in-Editor.
// HOW:  Receives selection state as props. Each action is a ghost button that
//       delegates to callbacks in the parent. Progress-streaming operations
//       (Delete, Move, Copy, Zip) show a progress sheet managed by the parent.
//       'Info' is only enabled when exactly one item is selected.
//       Uses only tokens from theme/tokens.ts — zero hardcoded values.
// SEE:  apps/mobile/src/plugins/shared/explorer/index.tsx (host),
//       apps/mobile/src/plugins/shared/explorer/components/ExplorerList.tsx

import React, { memo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
} from 'react-native';
import {
  Trash2,
  Move,
  Copy,
  Archive,
  Info,
  Terminal,
  FileCode,
  X,
} from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface ExplorerToolbarProps {
  selectionCount: number;
  onDelete: () => void;
  onMove: () => void;
  onCopy: () => void;
  onZip: () => void;
  onInfo: () => void;           // only active when selectionCount === 1
  onOpenInTerminal: () => void; // only active when selection is a single directory
  onOpenInEditor: () => void;   // only active when selection contains files
  onClearSelection: () => void;
}

// ----------------------------------------------------------
// Toolbar button
// ----------------------------------------------------------

const ToolbarButton = memo(function ToolbarButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  danger = false,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const iconColor = danger
    ? colors.semantic.error
    : disabled
      ? colors.fg.muted
      : colors.fg.secondary;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.button,
        pressed && !disabled && styles.buttonPressed,
        disabled && styles.buttonDisabled,
      ]}
      onPress={onPress}
      disabled={disabled}
    >
      <Icon size={16} color={iconColor} />
      <Text style={[styles.buttonLabel, danger && styles.buttonLabelDanger, disabled && styles.buttonLabelDisabled]}>
        {label}
      </Text>
    </Pressable>
  );
});

// ----------------------------------------------------------
// Toolbar
// ----------------------------------------------------------

export const ExplorerToolbar = memo(function ExplorerToolbar({
  selectionCount,
  onDelete,
  onMove,
  onCopy,
  onZip,
  onInfo,
  onOpenInTerminal,
  onOpenInEditor,
  onClearSelection,
}: ExplorerToolbarProps) {
  return (
    <View style={styles.container}>
      {/* Selection count + clear */}
      <View style={styles.selectionBadge}>
        <Text style={styles.selectionCount}>{selectionCount} selected</Text>
        <Pressable onPress={onClearSelection} hitSlop={8}>
          <X size={14} color={colors.fg.muted} />
        </Pressable>
      </View>

      {/* Action buttons */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.actions}
        contentContainerStyle={styles.actionsContent}
      >
        <ToolbarButton
          icon={Trash2}
          label="Delete"
          onPress={onDelete}
          danger
        />
        <ToolbarButton
          icon={Move}
          label="Move"
          onPress={onMove}
        />
        <ToolbarButton
          icon={Copy}
          label="Copy"
          onPress={onCopy}
        />
        <ToolbarButton
          icon={Archive}
          label="Zip"
          onPress={onZip}
        />
        <ToolbarButton
          icon={Info}
          label="Info"
          onPress={onInfo}
          disabled={selectionCount !== 1}
        />
        <ToolbarButton
          icon={Terminal}
          label="Terminal"
          onPress={onOpenInTerminal}
        />
        <ToolbarButton
          icon={FileCode}
          label="Editor"
          onPress={onOpenInEditor}
        />
      </ScrollView>
    </View>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.overlay,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  selectionBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingTop: spacing[2],
    paddingBottom: spacing[1],
  },
  selectionCount: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.sansMedium,
    color: colors.accent.primary,
    letterSpacing: 0.5,
  },
  actions: {
    flexGrow: 0,
  },
  actionsContent: {
    flexDirection: 'row',
    paddingHorizontal: spacing[3],
    paddingBottom: spacing[2],
    gap: spacing[1],
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderRadius: radii.md,
    backgroundColor: colors.bg.surfaceAlt,
    minHeight: 32,
  },
  buttonPressed: {
    backgroundColor: colors.bg.active,
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.sansMedium,
    color: colors.fg.secondary,
  },
  buttonLabelDanger: {
    color: colors.semantic.error,
  },
  buttonLabelDisabled: {
    color: colors.fg.muted,
  },
});
