// ============================================================
// components/SpawnForm.tsx — Form to spawn a new managed process
// ============================================================

import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, Pressable, TextInput } from 'react-native';
import { colors, typography, spacing, radii } from '../../../../theme';

interface SpawnFormProps {
  onSpawn: (command: string, path: string, args: string) => void;
  onCancel: () => void;
}

export function SpawnForm({ onSpawn, onCancel }: SpawnFormProps) {
  const [command, setCommand] = useState('');
  const [path, setPath] = useState('');
  const [args, setArgs] = useState('');

  const handleSpawn = useCallback(() => {
    if (!command.trim()) return;
    onSpawn(command.trim(), path.trim(), args.trim());
    setCommand('');
    setPath('');
    setArgs('');
  }, [command, path, args, onSpawn]);

  return (
    <View style={styles.spawnForm}>
      <View style={styles.spawnField}>
        <Text style={styles.spawnIcon}>{'>'}_</Text>
        <TextInput
          style={styles.spawnInput}
          value={command}
          onChangeText={setCommand}
          placeholder="command... (e.g. node, npm, python)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
          autoFocus
        />
      </View>
      <View style={styles.spawnField}>
        <TextInput
          style={[styles.spawnInput, { paddingLeft: spacing[3] }]}
          value={path}
          onChangeText={setPath}
          placeholder="path... (optional absolute path, default current dir)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="next"
        />
      </View>
      <View style={styles.spawnField}>
        <TextInput
          style={[styles.spawnInput, { paddingLeft: spacing[3] }]}
          value={args}
          onChangeText={setArgs}
          placeholder="arguments... (e.g. run dev --port 3000)"
          placeholderTextColor={colors.fg.muted}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={handleSpawn}
        />
      </View>
      <View style={styles.spawnButtons}>
        <Pressable style={[styles.spawnBtn, styles.spawnBtnCancel]} onPress={onCancel}>
          <Text style={styles.spawnBtnCancelText}>Cancel</Text>
        </Pressable>
        <Pressable
          style={[styles.spawnBtn, styles.spawnBtnSpawn, !command.trim() && styles.spawnBtnDisabled]}
          onPress={handleSpawn}
          disabled={!command.trim()}
        >
          <Text style={styles.spawnBtnSpawnText}>Spawn</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  spawnForm: {
    backgroundColor: colors.bg.raised,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  spawnField: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
    minHeight: 48,
  },
  spawnIcon: {
    width: 40,
    textAlign: 'center',
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
  spawnInput: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    paddingRight: spacing[3],
    paddingVertical: spacing[3],
    fontFamily: typography.fontFamily.mono,
  },
  spawnButtons: {
    flexDirection: 'row',
    gap: spacing[3],
    padding: spacing[3],
  },
  spawnBtn: {
    flex: 1,
    height: 44,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  spawnBtnCancel: { backgroundColor: colors.bg.active },
  spawnBtnSpawn: { backgroundColor: colors.accent.primary },
  spawnBtnDisabled: { opacity: 0.4 },
  spawnBtnCancelText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  spawnBtnSpawnText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
