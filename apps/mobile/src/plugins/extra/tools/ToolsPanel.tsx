// WHAT: Tools panel — on-device text transforms (format, encode, string ops).
// WHY:  Developers frequently need quick text transforms (JSON format, base64, URL encode)
//       that don't require a server connection. This keeps the tool offline-capable.
// HOW:  Category tabs → tool selector → TextInput → Convert → output. All transforms
//       are pure fns from transforms.ts. Clipboard from react-native core (no extra deps).
// SEE:  transforms.ts, apps/mobile/src/plugins/extra/tools/index.tsx

import React, { useCallback, useMemo, useState } from 'react';
import {
  Clipboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { X } from 'lucide-react-native';
import type { WorkspacePluginPanelProps } from '@stavi/shared';
import { useTheme } from '../../../theme';
import { radii, spacing, typography } from '../../../theme';
import {
  CATEGORIES,
  CATEGORY_LABELS,
  TRANSFORMS,
  type Category,
} from './transforms';

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function ToolsPanel({ bottomBarHeight }: WorkspacePluginPanelProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    scroll: { flex: 1, backgroundColor: colors.bg.base },
    container: { padding: spacing[4], gap: spacing[3] },

    tabsRow: { gap: spacing[2], paddingRight: spacing[4] },
    categoryPill: {
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radii.full,
      backgroundColor: colors.bg.raised,
    },
    categoryPillActive: { backgroundColor: colors.accent.primary },
    categoryText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.primary,
      fontWeight: typography.fontWeight.semibold,
    },
    categoryTextActive: { color: colors.fg.onAccent },

    toolsRow: { gap: spacing[2], paddingRight: spacing[4] },
    toolPill: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radii.full,
      backgroundColor: colors.bg.base,
      borderWidth: 1,
      borderColor: colors.divider,
    },
    toolPillActive: { backgroundColor: colors.bg.raised, borderColor: colors.accent.primary },
    toolText: { fontSize: typography.fontSize.xs, color: colors.fg.secondary },
    toolTextActive: { color: colors.fg.primary },

    inputWrapper: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.divider,
      height: 120,
      position: 'relative' as const,
      padding: spacing[2],
    },
    textArea: {
      flex: 1,
      color: colors.fg.primary,
      fontSize: typography.fontSize.sm,
      fontFamily: typography.fontFamily.mono,
      height: 90,
    },
    clearBtn: {
      position: 'absolute' as const,
      top: spacing[2],
      right: spacing[2],
      padding: spacing[1],
    },
    charCount: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      textAlign: 'right' as const,
    },

    convertButton: {
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      paddingVertical: spacing[3],
      alignItems: 'center' as const,
    },
    convertText: {
      color: colors.fg.onAccent,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
    },

    outputWrapper: {
      backgroundColor: colors.bg.base,
      borderRadius: radii.md,
      borderWidth: 1,
      borderColor: colors.divider,
      height: 120,
      position: 'relative' as const,
      overflow: 'hidden' as const,
    },
    outputScroll: { flex: 1, padding: spacing[2] },
    outputText: {
      color: colors.fg.primary,
      fontSize: typography.fontSize.sm,
      fontFamily: typography.fontFamily.mono,
    },
    errorText: {
      color: colors.semantic.error,
      fontSize: typography.fontSize.sm,
    },
    copyBtn: {
      position: 'absolute' as const,
      top: spacing[2],
      right: spacing[2],
      backgroundColor: colors.bg.overlay,
      borderRadius: radii.sm,
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[1],
    },
    copyText: {
      color: colors.fg.secondary,
      fontSize: typography.fontSize.xs,
    },
  }), [colors]);

  const [category, setCategory] = useState<Category>('format');
  const [selectedToolId, setSelectedToolId] = useState<string>('json-format');
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const categoryTools = TRANSFORMS.filter((t) => t.category === category);

  const handleSelectCategory = (cat: Category) => {
    setCategory(cat);
    const first = TRANSFORMS.find((t) => t.category === cat);
    if (first) setSelectedToolId(first.id);
    setOutput('');
    setError(null);
  };

  const handleConvert = useCallback(async () => {
    const tool = TRANSFORMS.find((t) => t.id === selectedToolId);
    if (!tool || !input) return;
    try {
      const result = await tool.execute(input);
      setOutput(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transform failed');
      setOutput('');
    }
  }, [selectedToolId, input]);

  const handleCopy = useCallback(() => {
    if (output) Clipboard.setString(output);
  }, [output]);

  return (
    <ScrollView
      style={styles.scroll}
      contentContainerStyle={[
        styles.container,
        { paddingBottom: (bottomBarHeight ?? 0) + spacing[4] },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* Category tabs */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabsRow}>
        {CATEGORIES.map((cat) => {
          const active = cat === category;
          return (
            <Pressable
              key={cat}
              style={[styles.categoryPill, active && styles.categoryPillActive]}
              onPress={() => handleSelectCategory(cat)}
            >
              <Text style={[styles.categoryText, active && styles.categoryTextActive]}>
                {CATEGORY_LABELS[cat]}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Tool selector */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolsRow}>
        {categoryTools.map((t) => {
          const active = t.id === selectedToolId;
          return (
            <Pressable
              key={t.id}
              style={[styles.toolPill, active && styles.toolPillActive]}
              onPress={() => {
                setSelectedToolId(t.id);
                setOutput('');
                setError(null);
              }}
            >
              <Text style={[styles.toolText, active && styles.toolTextActive]}>{t.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputWrapper}>
        <TextInput
          style={styles.textArea}
          value={input}
          onChangeText={setInput}
          placeholder="Paste input here…"
          placeholderTextColor={colors.fg.muted}
          multiline
          textAlignVertical="top"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {input.length > 0 && (
          <Pressable style={styles.clearBtn} onPress={() => { setInput(''); setOutput(''); setError(null); }}>
            <X size={14} color={colors.fg.muted} />
          </Pressable>
        )}
        <Text style={styles.charCount}>{input.length} chars</Text>
      </View>

      {/* Convert button */}
      <Pressable style={styles.convertButton} onPress={() => void handleConvert()}>
        <Text style={styles.convertText}>Convert</Text>
      </Pressable>

      {/* Output */}
      <View style={styles.outputWrapper}>
        <ScrollView style={styles.outputScroll}>
          {error ? (
            <Text style={styles.errorText}>{error}</Text>
          ) : (
            <Text selectable style={styles.outputText}>{output || ' '}</Text>
          )}
        </ScrollView>
        {output.length > 0 && !error && (
          <Pressable style={styles.copyBtn} onPress={handleCopy}>
            <Text style={styles.copyText}>Copy</Text>
          </Pressable>
        )}
      </View>
    </ScrollView>
  );
}

// Styles computed dynamically via useMemo — see component body.
