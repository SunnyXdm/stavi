// WHAT: DestinationPicker — modal for selecting a move/copy destination directory.
// WHY:  Explorer batch Move and Copy need the user to explicitly choose a destination
//       directory. Per Phase 7c spec, destination must be explicitly picked — never
//       defaults to cwd. This component wraps DirectoryPicker and adds a confirmation
//       button ("Move here" / "Copy here") so the user commits their choice.
// HOW:  Uses the existing DirectoryPicker component (NewSessionFlow's only caller,
//       but DirectoryPicker is a general-purpose component). Adds a footer with a
//       "Confirm" button that fires onSelect with the chosen path.
//       Uses only tokens from theme/tokens.ts — zero hardcoded values.
// SEE:  apps/mobile/src/components/DirectoryPicker.tsx,
//       apps/mobile/src/plugins/shared/explorer/index.tsx (host)

import React, { memo, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Pressable,
} from 'react-native';
import { X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { DirectoryPicker } from '../../../../components/DirectoryPicker';
import { colors, typography, spacing, radii } from '../../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface DestinationPickerProps {
  visible: boolean;
  serverId: string;
  sessionFolder: string;
  actionLabel: string;  // e.g. "Move here" | "Copy here"
  onSelect: (destinationPath: string) => void;
  onClose: () => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export const DestinationPicker = memo(function DestinationPicker({
  visible,
  serverId,
  sessionFolder,
  actionLabel,
  onSelect,
  onClose,
}: DestinationPickerProps) {
  const insets = useSafeAreaInsets();
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const handlePickerSelect = useCallback((path: string) => {
    // DirectoryPicker calls onSelect when the user taps "Select This Directory"
    // — we capture the path and wait for the user to tap our Confirm button.
    setSelectedPath(path);
  }, []);

  const handleConfirm = useCallback(() => {
    if (selectedPath) {
      onSelect(selectedPath);
      setSelectedPath(null);
    }
  }, [selectedPath, onSelect]);

  const handleClose = useCallback(() => {
    setSelectedPath(null);
    onClose();
  }, [onClose]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={[styles.container, { paddingBottom: insets.bottom }]}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Select Destination</Text>
          <Pressable onPress={handleClose} hitSlop={8}>
            <X size={20} color={colors.fg.muted} />
          </Pressable>
        </View>

        {/* Selected path preview */}
        {selectedPath && (
          <View style={styles.selectedBanner}>
            <Text style={styles.selectedLabel}>Selected:</Text>
            <Text style={styles.selectedPath} numberOfLines={1}>{selectedPath}</Text>
          </View>
        )}

        {/* Directory Picker */}
        <DirectoryPicker
          visible={visible}
          serverId={serverId}
          initialPath={sessionFolder}
          onClose={handleClose}
          onSelect={handlePickerSelect}
        />

        {/* Confirm footer */}
        <View style={styles.footer}>
          <Pressable
            style={[styles.confirmButton, !selectedPath && styles.confirmButtonDisabled]}
            onPress={handleConfirm}
            disabled={!selectedPath}
          >
            <Text style={[styles.confirmButtonText, !selectedPath && styles.confirmButtonTextDisabled]}>
              {actionLabel}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  headerTitle: {
    fontSize: typography.fontSize.lg,
    fontFamily: typography.fontFamily.sansSemiBold,
    color: colors.fg.primary,
  },
  selectedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    backgroundColor: colors.accent.subtle,
    gap: spacing[2],
  },
  selectedLabel: {
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.sansMedium,
    color: colors.accent.primary,
  },
  selectedPath: {
    flex: 1,
    fontSize: typography.fontSize.xs,
    fontFamily: typography.fontFamily.mono,
    color: colors.fg.secondary,
  },
  footer: {
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  confirmButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingVertical: spacing[3],
    alignItems: 'center',
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonText: {
    fontSize: typography.fontSize.base,
    fontFamily: typography.fontFamily.sansSemiBold,
    color: colors.fg.onAccent,
  },
  confirmButtonTextDisabled: {
    color: colors.fg.onAccent,
  },
});
