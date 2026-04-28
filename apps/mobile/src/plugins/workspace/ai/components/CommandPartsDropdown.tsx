// ============================================================
// CommandPartsDropdown — groups tool/reasoning/step parts in a collapsible
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).

import React, { useState, useCallback, memo, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { ChevronDown, ChevronRight, Layers } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../../theme';
import type { AIPart } from '../types';
import { buildToolGroupLabel } from '../streaming';

export const CommandPartsDropdown = memo(function CommandPartsDropdown({
  parts,
}: {
  parts: AIPart[];
}) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { marginHorizontal: spacing[4], marginLeft: spacing[4] + 24 + spacing[2], marginVertical: spacing[1], backgroundColor: colors.bg.raised, borderRadius: radii.md, overflow: 'hidden' },
    header: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: spacing[2] },
    label: { flex: 1, fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.fg.tertiary },
    body: { paddingHorizontal: spacing[3], paddingBottom: spacing[2], gap: spacing[1] },
    item: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingVertical: 2 },
    dot: { width: 6, height: 6, borderRadius: 3 },
    itemText: { fontSize: typography.fontSize.sm, color: colors.fg.secondary, fontFamily: typography.fontFamily.mono, flex: 1 },
  }), [colors]);
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);

  const label = buildToolGroupLabel(parts);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={styles.container}>
      <Pressable style={styles.header} onPress={toggle}>
        <Layers size={14} color={colors.fg.muted} />
        <Text style={styles.label}>{label}</Text>
        <Chevron size={14} color={colors.fg.muted} />
      </Pressable>
      {expanded && (
        <View style={styles.body}>
          {parts.map((part, i) => {
            const name =
              (part as any).toolName ??
              (part as any).name ??
              part.type;
            const isError = (part as any).state === 'error';
            const isDone = (part as any).state === 'completed';
            const dotColor = isError
              ? colors.semantic.error
              : isDone
                ? colors.semantic.success
                : colors.accent.primary;

            return (
              <View key={i} style={styles.item}>
                <View style={[styles.dot, { backgroundColor: dotColor }]} />
                <Text style={styles.itemText} numberOfLines={1}>
                  {name}
                </Text>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
});

// Styles live in CommandPartsDropdown via useMemo — see component body.
