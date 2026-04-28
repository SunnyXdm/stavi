// WHAT: Horizontal tab bar for open files in the Editor plugin.
// WHY:  Gives the user a VS Code / Acode-style tab switcher across open files.
//       Each tab shows the filename, a dirty-dot if unsaved, and a close button.
// HOW:  Reads openFilesBySession and activeFileBySession from EditorStore.
//       Renders inside a horizontal ScrollView. Long-press shows a context menu
//       with Close, Close Others, Close All, Close to the Right.
// SEE:  apps/mobile/src/plugins/workspace/editor/store.ts,
//       apps/mobile/src/plugins/workspace/editor/index.tsx

import React, { useCallback, useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Modal,
} from 'react-native';
import { Code2, X } from 'lucide-react-native';
import { useTheme, typography, spacing } from '../../../../theme';
import { useEditorStore } from '../store';

// Sentinel — frozen empty array reused by selectors to avoid new-array-per-snapshot.
const EMPTY_OPEN_FILES: never[] = Object.freeze([]) as never[];

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

interface TabContextMenu {
  visible: boolean;
  path: string;
}

// ----------------------------------------------------------
// EditorTabs Component
// ----------------------------------------------------------

interface EditorTabsProps {
  sessionId: string;
}

export const EditorTabs = React.memo(function EditorTabs({ sessionId }: EditorTabsProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    tabBar: { backgroundColor: colors.bg.raised, height: 36, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    tabScroll: { flexDirection: 'row', alignItems: 'stretch' },
    tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3], height: 36, maxWidth: 180, gap: spacing[1], borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: colors.divider },
    tabActive: { backgroundColor: colors.bg.base, borderBottomWidth: 2, borderBottomColor: colors.accent.primary },
    tabIcon: { flexShrink: 0 },
    tabText: { flex: 1, fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono },
    tabTextActive: { color: colors.fg.primary },
    dirtyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.semantic.warning, flexShrink: 0 },
    dirtyDotActive: { backgroundColor: colors.accent.primary },
    tabClose: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
    menuBackdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'flex-end' },
    menuSheet: { backgroundColor: colors.bg.overlay, borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: spacing[2], paddingBottom: spacing[6], paddingHorizontal: spacing[2] },
    menuTitle: { fontSize: typography.fontSize.xs, color: colors.fg.muted, paddingHorizontal: spacing[3], paddingVertical: spacing[2], fontFamily: typography.fontFamily.mono },
    menuItem: { paddingHorizontal: spacing[3], paddingVertical: spacing[3], borderRadius: 8 },
    menuItemPressed: { backgroundColor: colors.bg.active },
    menuItemText: { fontSize: typography.fontSize.base, color: colors.fg.secondary },
    menuItemDanger: { color: colors.semantic.error },
  }), [colors]);

  const openFiles = useEditorStore(
    (s) => s.openFilesBySession[sessionId] ?? EMPTY_OPEN_FILES,
  );
  const activeFilePath = useEditorStore(
    (s) => s.activeFileBySession[sessionId] ?? null,
  );
  const { closeFile, setActiveFile } = useEditorStore.getState();

  const [ctxMenu, setCtxMenu] = useState<TabContextMenu>({ visible: false, path: '' });

  const hideMenu = useCallback(() => setCtxMenu({ visible: false, path: '' }), []);

  const handleLongPress = useCallback((path: string) => {
    setCtxMenu({ visible: true, path });
  }, []);

  const handleCloseOthers = useCallback(
    (keepPath: string) => {
      hideMenu();
      const toClose = openFiles.filter((f) => f.path !== keepPath).map((f) => f.path);
      for (const p of toClose) {
        closeFile(sessionId, p);
      }
    },
    [openFiles, closeFile, sessionId, hideMenu],
  );

  const handleCloseAll = useCallback(() => {
    hideMenu();
    for (const f of openFiles) {
      closeFile(sessionId, f.path);
    }
  }, [openFiles, closeFile, sessionId, hideMenu]);

  const handleCloseToRight = useCallback(
    (targetPath: string) => {
      hideMenu();
      const idx = openFiles.findIndex((f) => f.path === targetPath);
      if (idx === -1) return;
      const toClose = openFiles.slice(idx + 1).map((f) => f.path);
      for (const p of toClose) {
        closeFile(sessionId, p);
      }
    },
    [openFiles, closeFile, sessionId, hideMenu],
  );

  if (openFiles.length === 0) return null;

  return (
    <>
      <View style={styles.tabBar}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabScroll}
        >
          {openFiles.map((file) => {
            const isActive = file.path === activeFilePath;
            const fileName = file.path.split('/').pop() ?? file.path;

            return (
              <Pressable
                key={file.path}
                style={[styles.tab, isActive && styles.tabActive]}
                onPress={() => setActiveFile(sessionId, file.path)}
                onLongPress={() => handleLongPress(file.path)}
              >
                <Code2
                  size={12}
                  color={isActive ? colors.accent.primary : colors.fg.muted}
                  style={styles.tabIcon}
                />
                <Text
                  style={[styles.tabText, isActive && styles.tabTextActive]}
                  numberOfLines={1}
                >
                  {fileName}
                </Text>
                {/* Dirty indicator */}
                {file.dirty && (
                  <View
                    style={[
                      styles.dirtyDot,
                      isActive && styles.dirtyDotActive,
                    ]}
                  />
                )}
                {/* Close button */}
                <Pressable
                  style={styles.tabClose}
                  onPress={() => closeFile(sessionId, file.path)}
                  hitSlop={8}
                >
                  <X size={10} color={colors.fg.muted} />
                </Pressable>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* Long-press context menu */}
      <Modal
        visible={ctxMenu.visible}
        transparent
        animationType="fade"
        onRequestClose={hideMenu}
      >
        <Pressable style={styles.menuBackdrop} onPress={hideMenu}>
          <View style={styles.menuSheet}>
            <Text style={styles.menuTitle} numberOfLines={1}>
              {ctxMenu.path.split('/').pop()}
            </Text>

            <TabMenuItem
              label="Close"
              onPress={() => {
                hideMenu();
                closeFile(sessionId, ctxMenu.path);
              }}
              styles={styles}
            />
            <TabMenuItem
              label="Close Others"
              onPress={() => handleCloseOthers(ctxMenu.path)}
              styles={styles}
            />
            <TabMenuItem
              label="Close to the Right"
              onPress={() => handleCloseToRight(ctxMenu.path)}
              styles={styles}
            />
            <TabMenuItem
              label="Close All"
              onPress={handleCloseAll}
              danger
              styles={styles}
            />
          </View>
        </Pressable>
      </Modal>
    </>
  );
});

type TabStyles = ReturnType<typeof StyleSheet.create>;

function TabMenuItem({
  label,
  onPress,
  danger,
  styles,
}: {
  label: string;
  onPress: () => void;
  danger?: boolean;
  styles: TabStyles;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
      onPress={onPress}
    >
      <Text style={[styles.menuItemText, danger && styles.menuItemDanger]}>{label}</Text>
    </Pressable>
  );
}

// Styles computed dynamically via useMemo — see component body.
