// ============================================================
// TerminalToolbar — common-key row above the keyboard
// ============================================================
// Shows frequently-used terminal keys so the terminal is
// usable without a hardware keyboard on mobile.
// Matches lunel's pattern.

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';

interface TerminalToolbarProps {
  onKey: (data: string) => void;
}

interface KeyDef {
  label: string;
  data: string;
  wide?: boolean;
}

const KEYS: KeyDef[] = [
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Esc', data: '\x1b' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '`', data: '`' },
  { label: '-', data: '-' },
  { label: '/', data: '/' },
  { label: '\\', data: '\\' },
];

export const TerminalToolbar = memo(function TerminalToolbar({ onKey }: TerminalToolbarProps) {
  const { colors } = useTheme();
  const handlePress = useCallback((data: string) => {
    onKey(data);
  }, [onKey]);

  const styles = useMemo(() => StyleSheet.create({
    container: {
      backgroundColor: colors.bg.raised,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
      height: 40,
    },
    scroll: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[2],
      gap: spacing[1],
    },
    key: {
      height: 28,
      minWidth: 36,
      paddingHorizontal: spacing[2],
      backgroundColor: colors.bg.overlay,
      borderRadius: radii.sm,
      alignItems: 'center',
      justifyContent: 'center',
    },
    keyPressed: {
      backgroundColor: colors.bg.active,
    },
    keyLabel: {
      fontSize: typography.fontSize.xs,
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
        {KEYS.map((key) => (
          <Pressable
            key={key.label}
            style={({ pressed }) => [styles.key, pressed && styles.keyPressed]}
            onPress={() => handlePress(key.data)}
          >
            <Text style={styles.keyLabel}>{key.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
});
