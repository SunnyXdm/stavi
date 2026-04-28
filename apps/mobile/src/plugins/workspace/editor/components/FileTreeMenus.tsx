// WHAT: Context-menu sheet and create/rename dialogs for FileTree.
// WHY:  Extracted to keep FileTree.tsx under 400 lines.
// HOW:  Exposes FileContextMenu, RenameDialog, NewEntryDialog, and shared types.
// SEE:  FileTree.tsx, store.ts

import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Modal,
  TextInput,
  Alert,
} from 'react-native';
import {
  FilePlus,
  FolderPlus,
  Pencil,
  Trash2,
  Copy,
  Terminal,
} from 'lucide-react-native';
import { useTheme, typography, spacing } from '../../../../theme';
import type { Colors } from '../../../../theme';

// ----------------------------------------------------------
// Exported types
// ----------------------------------------------------------

export interface TreeEntry {
  name: string;
  type: 'file' | 'directory';
  path: string; // absolute
  size?: number;
}

export interface ContextMenuState {
  visible: boolean;
  entry: TreeEntry | null;
}

export type FileTreeAction =
  | { type: 'openInTerminal'; cwd: string }
  | { type: 'refreshDir'; dirPath: string };

// ----------------------------------------------------------
// Styles factory
// ----------------------------------------------------------

function createMenuStyles(colors: Colors) {
  return StyleSheet.create({
    menuBackdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'flex-end' },
    menuSheet: { backgroundColor: colors.bg.overlay, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: spacing[2], paddingBottom: spacing[6], paddingHorizontal: spacing[2] },
    menuTitle: { fontSize: typography.fontSize.xs, color: colors.fg.muted, paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontFamily: typography.fontFamily.mono },
    menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing[3], paddingHorizontal: spacing[3], paddingVertical: spacing[3], borderRadius: 8 },
    menuItemPressed: { backgroundColor: colors.bg.active },
    menuItemText: { fontSize: typography.fontSize.base, color: colors.fg.secondary },
    dialogBackdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'center', alignItems: 'center', padding: spacing[6] },
    dialog: { backgroundColor: colors.bg.overlay, borderRadius: 12, padding: spacing[5], width: '100%', maxWidth: 360, gap: spacing[4] },
    dialogTitle: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    dialogInput: { backgroundColor: colors.bg.input, borderRadius: 8, paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontSize: typography.fontSize.base, fontFamily: typography.fontFamily.mono, color: colors.fg.primary },
    dialogButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2] },
    dialogBtn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: 8 },
    dialogBtnText: { fontSize: typography.fontSize.sm, color: colors.fg.secondary },
    dialogBtnPrimary: { backgroundColor: colors.accent.primary },
    dialogBtnPrimaryText: { color: colors.fg.onAccent, fontWeight: typography.fontWeight.medium },
  });
}

type MenuStyles = ReturnType<typeof createMenuStyles>;

// ----------------------------------------------------------
// ContextMenuItem helper
// ----------------------------------------------------------

export function ContextMenuItem({
  icon,
  label,
  labelColor,
  onPress,
  styles,
}: {
  icon: React.ReactNode;
  label: string;
  labelColor?: string;
  onPress: () => void;
  styles: MenuStyles;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
      onPress={onPress}
    >
      {icon}
      <Text style={[styles.menuItemText, labelColor ? { color: labelColor } : undefined]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ----------------------------------------------------------
// FileContextMenu modal
// ----------------------------------------------------------

interface FileContextMenuProps {
  ctxMenu: ContextMenuState;
  onClose: () => void;
  onAction: (action: FileTreeAction) => void;
  onStartRename: (entry: TreeEntry) => void;
  onStartNew: (parentPath: string, type: 'file' | 'directory') => void;
  onDelete: (entry: TreeEntry) => void;
}

export function FileContextMenu({
  ctxMenu,
  onClose,
  onAction,
  onStartRename,
  onStartNew,
  onDelete,
}: FileContextMenuProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createMenuStyles(colors), [colors]);

  const entry = ctxMenu.entry;
  if (!entry) return null;

  const fileName = entry.path.split('/').filter(Boolean).pop() ?? entry.path;

  const handleOpenInTerminal = () => {
    onClose();
    const cwd =
      entry.type === 'directory'
        ? entry.path
        : entry.path.split('/').slice(0, -1).join('/');
    onAction({ type: 'openInTerminal', cwd });
  };

  const handleCopyPath = () => {
    onClose();
    Alert.alert('Path copied', entry.path);
  };

  const handleRename = () => {
    onClose();
    onStartRename(entry);
  };

  const handleDelete = () => {
    onClose();
    onDelete(entry);
  };

  const handleNewFile = () => {
    onClose();
    const parentPath =
      entry.type === 'directory'
        ? entry.path
        : entry.path.split('/').slice(0, -1).join('/');
    onStartNew(parentPath, 'file');
  };

  const handleNewFolder = () => {
    onClose();
    const parentPath =
      entry.type === 'directory'
        ? entry.path
        : entry.path.split('/').slice(0, -1).join('/');
    onStartNew(parentPath, 'directory');
  };

  return (
    <Modal
      visible={ctxMenu.visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.menuBackdrop} onPress={onClose}>
        <View style={styles.menuSheet}>
          <Text style={styles.menuTitle} numberOfLines={1}>
            {fileName}
          </Text>

          {entry.type === 'directory' && (
            <>
              <ContextMenuItem
                icon={<FilePlus size={16} color={colors.fg.secondary} />}
                label="New File"
                onPress={handleNewFile}
                styles={styles}
              />
              <ContextMenuItem
                icon={<FolderPlus size={16} color={colors.fg.secondary} />}
                label="New Folder"
                onPress={handleNewFolder}
                styles={styles}
              />
              <ContextMenuItem
                icon={<Terminal size={16} color={colors.fg.secondary} />}
                label="Open in Terminal Here"
                onPress={handleOpenInTerminal}
                styles={styles}
              />
            </>
          )}
          {entry.type === 'file' && (
            <ContextMenuItem
              icon={<FilePlus size={16} color={colors.fg.secondary} />}
              label="New File Here"
              onPress={handleNewFile}
              styles={styles}
            />
          )}
          <ContextMenuItem
            icon={<Pencil size={16} color={colors.fg.secondary} />}
            label="Rename"
            onPress={handleRename}
            styles={styles}
          />
          <ContextMenuItem
            icon={<Copy size={16} color={colors.fg.secondary} />}
            label="Copy Path"
            onPress={handleCopyPath}
            styles={styles}
          />
          <ContextMenuItem
            icon={<Trash2 size={16} color={colors.semantic.error} />}
            label="Delete"
            labelColor={colors.semantic.error}
            onPress={handleDelete}
            styles={styles}
          />
        </View>
      </Pressable>
    </Modal>
  );
}

// ----------------------------------------------------------
// RenameDialog modal
// ----------------------------------------------------------

interface RenameDialogProps {
  visible: boolean;
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

export function RenameDialog({ visible, initialValue, onConfirm, onCancel }: RenameDialogProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createMenuStyles(colors), [colors]);
  const [value, setValue] = useState(initialValue);

  // Reset when dialog opens
  React.useEffect(() => {
    if (visible) setValue(initialValue);
  }, [visible, initialValue]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>Rename</Text>
          <TextInput
            style={styles.dialogInput}
            value={value}
            onChangeText={setValue}
            autoFocus
            selectTextOnFocus
            placeholderTextColor={colors.fg.muted}
            onSubmitEditing={() => onConfirm(value)}
          />
          <View style={styles.dialogButtons}>
            <Pressable style={styles.dialogBtn} onPress={onCancel}>
              <Text style={styles.dialogBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogBtn, styles.dialogBtnPrimary]}
              onPress={() => onConfirm(value)}
            >
              <Text style={[styles.dialogBtnText, styles.dialogBtnPrimaryText]}>Rename</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ----------------------------------------------------------
// NewEntryDialog modal
// ----------------------------------------------------------

interface NewEntryDialogProps {
  visible: boolean;
  type: 'file' | 'directory';
  onConfirm: (name: string) => void;
  onCancel: () => void;
}

export function NewEntryDialog({ visible, type, onConfirm, onCancel }: NewEntryDialogProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createMenuStyles(colors), [colors]);
  const [value, setValue] = useState('');

  React.useEffect(() => {
    if (visible) setValue('');
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.dialogBackdrop}>
        <View style={styles.dialog}>
          <Text style={styles.dialogTitle}>
            {type === 'directory' ? 'New Folder' : 'New File'}
          </Text>
          <TextInput
            style={styles.dialogInput}
            value={value}
            onChangeText={setValue}
            autoFocus
            placeholder={type === 'directory' ? 'folder-name' : 'filename.ts'}
            placeholderTextColor={colors.fg.muted}
            onSubmitEditing={() => onConfirm(value)}
          />
          <View style={styles.dialogButtons}>
            <Pressable style={styles.dialogBtn} onPress={onCancel}>
              <Text style={styles.dialogBtnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={[styles.dialogBtn, styles.dialogBtnPrimary]}
              onPress={() => onConfirm(value)}
            >
              <Text style={[styles.dialogBtnText, styles.dialogBtnPrimaryText]}>Create</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// Styles computed dynamically via createMenuStyles — see each component body.
