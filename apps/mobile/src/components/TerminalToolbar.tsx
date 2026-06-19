// ============================================================
// TerminalToolbar — common-key row above the keyboard
// ============================================================
// Shows frequently-used terminal keys so the terminal is usable without a
// hardware keyboard. The leading "Ctrl" key is a STICKY MODIFIER: tap it to
// arm (it highlights), then the next character you type — from the soft
// keyboard OR a key here — is sent as a control char (char & 0x1f). This is
// how a real mobile terminal sends Ctrl+A / Ctrl+U / Ctrl+Z / Ctrl+L etc.
// without a physical Ctrl key. Tapping Ctrl again disarms it.

import React, { memo, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';

interface TerminalToolbarProps {
  onKey: (data: string) => void;
  /** True when the sticky Ctrl modifier is armed. */
  ctrlArmed: boolean;
  onToggleCtrl: () => void;
}

interface KeyDef {
  label: string;
  data: string;
}

// Non-modifier keys. Ctrl+C / Ctrl+D stay as one-tap shortcuts (muscle memory);
// everything else Ctrl-able is reachable via the sticky Ctrl modifier.
const KEYS: KeyDef[] = [
  { label: 'Esc', data: '\x1b' },
  { label: 'Tab', data: '\t' },
  { label: 'Ctrl+C', data: '\x03' },
  { label: 'Ctrl+D', data: '\x04' },
  { label: '↑', data: '\x1b[A' },
  { label: '↓', data: '\x1b[B' },
  { label: '←', data: '\x1b[D' },
  { label: '→', data: '\x1b[C' },
  { label: 'Home', data: '\x1b[H' },
  { label: 'End', data: '\x1b[F' },
  { label: 'PgUp', data: '\x1b[5~' },
  { label: 'PgDn', data: '\x1b[6~' },
  { label: '|', data: '|' },
  { label: '~', data: '~' },
  { label: '`', data: '`' },
  { label: '/', data: '/' },
  { label: '\\', data: '\\' },
  { label: '-', data: '-' },
];

export const TerminalToolbar = memo(function TerminalToolbar({
  onKey,
  ctrlArmed,
  onToggleCtrl,
}: TerminalToolbarProps) {
  const { colors } = useTheme();
  const handlePress = useCallback((data: string) => {
    onKey(data);
  }, [onKey]);

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
    keyPressed: {
      backgroundColor: colors.bg.active,
    },
    ctrlArmed: {
      backgroundColor: colors.accent.primary,
    },
    keyLabel: {
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
    ctrlArmedLabel: {
      color: colors.fg.onAccent,
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
        {/* Sticky Ctrl modifier */}
        <Pressable
          style={({ pressed }) => [
            styles.key,
            pressed && styles.keyPressed,
            ctrlArmed && styles.ctrlArmed,
          ]}
          onPress={onToggleCtrl}
          accessibilityLabel="Control modifier"
          accessibilityState={{ selected: ctrlArmed }}
        >
          <Text style={[styles.keyLabel, ctrlArmed && styles.ctrlArmedLabel]}>Ctrl</Text>
        </Pressable>

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

/**
 * Apply an armed Ctrl modifier to a chunk of terminal input. Only single
 * printable characters are transformed (A→\x01 … Z→\x1a, and the usual
 * symbol controls); multi-byte sequences (arrows, paste, IME) pass through.
 * Returns the bytes to send. Callers disarm Ctrl after a transform.
 */
export function applyCtrl(data: string): string {
  if (data.length !== 1) return data;
  const code = data.charCodeAt(0);
  // Map to control range. 'a'/'A' (0x61/0x41) → 0x01, etc.
  return String.fromCharCode(code & 0x1f);
}
