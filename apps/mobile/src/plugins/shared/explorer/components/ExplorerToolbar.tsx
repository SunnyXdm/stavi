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

import React, { memo, useMemo } from 'react';
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
import { useTheme } from '../../../../theme';
import { typography, spacing, radii } from '../../../../theme';
import type { Colors } from '../../../../theme';

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
// Style factory
// ----------------------------------------------------------

function createToolbarStyles(colors: Colors) {
  return StyleSheet.create({
    container: {
      backgroundColor: colors.bg.overlay,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    selectionBadge: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      justifyContent: 'space-between' as const,
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
      flexDirection: 'row' as const,
      paddingHorizontal: spacing[3],
      paddingBottom: spacing[2],
      gap: spacing[1],
    },
    button: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
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
}

type ToolbarStyles = ReturnType<typeof createToolbarStyles>;

// ----------------------------------------------------------
// Toolbar button
// ----------------------------------------------------------

const ToolbarButton = memo(function ToolbarButton({
  icon: Icon,
  label,
  onPress,
  disabled = false,
  danger = false,
  styles,
  colors,
}: {
  icon: React.ComponentType<{ size?: number; color?: string }>;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
  styles: ToolbarStyles;
  colors: Colors;
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
  const { colors } = useTheme();
  const styles = useMemo(() => createToolbarStyles(colors), [colors]);

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
        <ToolbarButton icon={Trash2} label="Delete" onPress={onDelete} danger styles={styles} colors={colors} />
        <ToolbarButton icon={Move} label="Move" onPress={onMove} styles={styles} colors={colors} />
        <ToolbarButton icon={Copy} label="Copy" onPress={onCopy} styles={styles} colors={colors} />
        <ToolbarButton icon={Archive} label="Zip" onPress={onZip} styles={styles} colors={colors} />
        <ToolbarButton icon={Info} label="Info" onPress={onInfo} disabled={selectionCount !== 1} styles={styles} colors={colors} />
        <ToolbarButton icon={Terminal} label="Terminal" onPress={onOpenInTerminal} styles={styles} colors={colors} />
        <ToolbarButton icon={FileCode} label="Editor" onPress={onOpenInEditor} styles={styles} colors={colors} />
      </ScrollView>
    </View>
  );
});

// Styles computed dynamically via useMemo (createToolbarStyles factory) — see component body.
