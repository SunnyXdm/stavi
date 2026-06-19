// WHAT: Quick-insert symbols bar shown above the keyboard while editing.
// WHY:  Mobile keyboards bury the characters code needs most (Tab, braces,
//       arrows); lunel ships the same pattern for its terminal. A Save key
//       sits first so saving never requires reaching the top toolbar.
// HOW:  Horizontal scroll of 38px keys (keyboardShouldPersistTaps so taps
//       don't dismiss the IME). Inserts route through the CodeMirror bridge's
//       insertText message; Save triggers the regular save action.
// SEE:  apps/mobile/assets/editor/src/bridge.ts (insertText handler),
//       apps/mobile/src/plugins/workspace/editor/index.tsx

import React, { memo, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { Save } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../../theme';

interface EditorSymbolsBarProps {
  onInsert: (text: string) => void;
  onSave: () => void;
  isDirty: boolean;
}

const SYMBOLS: Array<{ label: string; insert: string }> = [
  { label: 'Tab', insert: '  ' },
  { label: '{ }', insert: '{}' },
  { label: '( )', insert: '()' },
  { label: '[ ]', insert: '[]' },
  { label: '< >', insert: '<>' },
  { label: '"', insert: '"' },
  { label: "'", insert: "'" },
  { label: '`', insert: '`' },
  { label: ';', insert: ';' },
  { label: '=>', insert: '=>' },
  { label: '=', insert: '=' },
  { label: '|', insert: '|' },
  { label: '&', insert: '&' },
  { label: '!', insert: '!' },
  { label: '$', insert: '$' },
  { label: '_', insert: '_' },
];

export const EditorSymbolsBar = memo(function EditorSymbolsBar({
  onInsert,
  onSave,
  isDirty,
}: EditorSymbolsBarProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.bg.raised,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      height: 52,
    },
    scroll: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[2],
      gap: spacing[2],
    },
    key: {
      height: 38,
      minWidth: 44,
      paddingHorizontal: spacing[3],
      backgroundColor: colors.bg.overlay,
      borderRadius: radii.md,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyPressed: { backgroundColor: colors.bg.active },
    saveKey: { backgroundColor: colors.accent.subtle },
    keyLabel: {
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
  }), [colors]);

  return (
    <View style={styles.container}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroll}
        bounces={false}
        keyboardShouldPersistTaps="always"
      >
        <Pressable
          style={({ pressed }) => [styles.key, isDirty && styles.saveKey, pressed && styles.keyPressed]}
          onPress={onSave}
          accessibilityLabel="Save file"
        >
          <Save size={16} color={isDirty ? colors.accent.primary : colors.fg.muted} />
        </Pressable>
        {SYMBOLS.map((sym) => (
          <Pressable
            key={sym.label}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => onInsert(sym.insert)}
          >
            <Text style={styles.keyLabel}>{sym.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});
