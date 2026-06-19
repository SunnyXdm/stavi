// ============================================================
// Markdown — Themed markdown renderer for AI messages
// ============================================================

import React, { memo, useState, useCallback, useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';
import RNMarkdown from 'react-native-markdown-display';
import Clipboard from '@react-native-clipboard/clipboard';
import { Copy, Check } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import type { Colors } from '../../../theme';
import { highlightSpans, scopeColor } from './utils/highlight';

// ----------------------------------------------------------
// GitHub callout preprocessing
// ----------------------------------------------------------

const CALLOUT_TYPES: Record<string, { label: string; icon: string }> = {
  NOTE:      { label: 'Note',      icon: '📌' },
  TIP:       { label: 'Tip',       icon: '💡' },
  IMPORTANT: { label: 'Important', icon: '🔔' },
  WARNING:   { label: 'Warning',   icon: '⚠️' },
  CAUTION:   { label: 'Caution',   icon: '🔴' },
};

// Converts > [!NOTE] / > [!WARNING] etc. to styled blockquotes so they
// render nicely without needing a custom AST rule.
function preprocessCallouts(md: string): string {
  return md.replace(
    /^> \[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\n/gim,
    (_, type: string) => {
      const t = type.toUpperCase();
      const { label, icon } = CALLOUT_TYPES[t] ?? { label: t, icon: '›' };
      return `> ${icon} **${label}**\n> \n`;
    },
  );
}

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const AI_READING_LINE_HEIGHT = 1.45;
const AI_READING_LETTER_SPACING = 0.12;
const BASE_FONT_SIZE = typography.fontSize.base;
const COMPACT_FONT_SIZE = typography.fontSize.sm;

// ----------------------------------------------------------
// CodeBlock with copy button
// ----------------------------------------------------------

interface CodeBlockProps {
  content: string;
  language?: string;
  compact?: boolean;
  colors: Colors;
}

const CodeBlock = memo(function CodeBlock({ content, language, compact, colors }: CodeBlockProps) {
  const codeStyles = useMemo(() => StyleSheet.create({
    codeBlock: { backgroundColor: colors.bg.elevated, borderRadius: radii.md, marginVertical: spacing[2], overflow: 'hidden' },
    codeBlockHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[3], paddingVertical: spacing[1], backgroundColor: colors.bg.overlay, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    codeBlockLang: { fontSize: typography.fontSize.xs, fontFamily: typography.fontFamily.mono, color: colors.fg.muted, textTransform: 'lowercase' },
    copyButton: { padding: 4 },
    codeBlockText: { fontFamily: typography.fontFamily.mono, color: colors.fg.secondary, paddingHorizontal: spacing[3], paddingVertical: spacing[3], lineHeight: BASE_FONT_SIZE * 1.6 },
  }), [colors]);
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    Clipboard.setString(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [content]);

  const CopyIcon = copied ? Check : Copy;
  const copyColor = copied ? colors.semantic.success : colors.fg.muted;

  // Syntax highlighting: tokenize once per content change; null → plain text.
  const spans = useMemo(() => highlightSpans(content, language), [content, language]);

  return (
    <View style={codeStyles.codeBlock}>
      {/* Header row */}
      <View style={codeStyles.codeBlockHeader}>
        {language ? (
          <Text style={codeStyles.codeBlockLang}>{language}</Text>
        ) : (
          <View />
        )}
        <Pressable onPress={handleCopy} hitSlop={8} style={codeStyles.copyButton}>
          <CopyIcon size={13} color={copyColor} />
        </Pressable>
      </View>
      {/* Code content */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text
          style={[
            codeStyles.codeBlockText,
            { fontSize: compact ? COMPACT_FONT_SIZE - 1 : BASE_FONT_SIZE - 1 },
          ]}
          selectable
        >
          {spans
            ? spans.map((span, i) =>
                span.scope ? (
                  <Text key={i} style={{ color: scopeColor(span.scope, colors) ?? colors.fg.secondary }}>
                    {span.text}
                  </Text>
                ) : (
                  span.text
                ),
              )
            : content}
        </Text>
      </ScrollView>
    </View>
  );
});

// ----------------------------------------------------------
// Custom rules
// ----------------------------------------------------------

function buildRules(compact: boolean, colors: Colors) {
  return {
    fence: (node: any) => {
      const content = node.content?.trim() ?? '';
      const lang = node.info?.trim() ?? undefined;
      return <CodeBlock key={node.key} content={content} language={lang} compact={compact} colors={colors} />;
    },
    code_block: (node: any) => {
      const content = node.content?.trim() ?? '';
      return <CodeBlock key={node.key} content={content} compact={compact} colors={colors} />;
    },
    // Wrap tables in a horizontal ScrollView so wide tables don't clip.
    table: (node: any, children: React.ReactNode) => (
      <ScrollView key={node.key} horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: spacing[2] }}>
        <View>{children}</View>
      </ScrollView>
    ),
  };
}

// ----------------------------------------------------------
// Style map
// ----------------------------------------------------------

function buildMarkdownStyles(compact: boolean, colors: Colors) {
  const fontSize = compact ? COMPACT_FONT_SIZE : BASE_FONT_SIZE;
  const headingScale = compact ? 0.9 : 1;

  return StyleSheet.create({
    // Body text — use fg.primary for crisp readability (fg.secondary is 72%
    // opacity in light mode, making long AI responses look washed-out).
    body: {
      color: colors.fg.primary,
      fontSize,
      lineHeight: fontSize * AI_READING_LINE_HEIGHT,
      letterSpacing: AI_READING_LETTER_SPACING,
      fontFamily: typography.fontFamily.sans,
    },
    paragraph: {
      marginBottom: spacing[2],
      color: colors.fg.primary,
      fontSize,
      lineHeight: fontSize * AI_READING_LINE_HEIGHT,
      letterSpacing: AI_READING_LETTER_SPACING,
    },

    // Headings
    heading1: {
      fontSize: Math.round(typography.fontSize['2xl'] * headingScale),
      fontWeight: typography.fontWeight.bold,
      color: colors.fg.primary,
      marginTop: spacing[4],
      marginBottom: spacing[2],
      lineHeight: Math.round(typography.fontSize['2xl'] * headingScale * 1.3),
    },
    heading2: {
      fontSize: Math.round(typography.fontSize.xl * headingScale),
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
      marginTop: spacing[4],
      marginBottom: spacing[2],
      lineHeight: Math.round(typography.fontSize.xl * headingScale * 1.3),
    },
    heading3: {
      fontSize: Math.round(typography.fontSize.lg * headingScale),
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
      marginTop: spacing[3],
      marginBottom: spacing[1],
      lineHeight: Math.round(typography.fontSize.lg * headingScale * 1.3),
    },
    heading4: {
      fontSize: Math.round(typography.fontSize.base * headingScale),
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
      marginTop: spacing[3],
      marginBottom: spacing[1],
    },
    heading5: {
      fontSize: Math.round(typography.fontSize.sm * headingScale),
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.secondary,
      marginTop: spacing[2],
      marginBottom: spacing[1],
    },
    heading6: {
      fontSize: Math.round(typography.fontSize.xs * headingScale),
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.tertiary,
      marginTop: spacing[2],
      marginBottom: spacing[1],
    },

    // Inline formatting
    strong: {
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    em: {
      fontStyle: 'italic',
    },
    s: {
      textDecorationLine: 'line-through',
      color: colors.fg.muted,
    },
    link: {
      color: colors.accent.primary,
      textDecorationLine: 'underline',
    },

    // Blockquote
    blockquote: {
      backgroundColor: colors.bg.raised,
      borderLeftWidth: 3,
      borderLeftColor: colors.accent.primary,
      paddingLeft: spacing[3],
      paddingVertical: spacing[2],
      marginVertical: spacing[2],
      borderRadius: radii.sm,
    },

    // Inline code
    code_inline: {
      fontFamily: typography.fontFamily.mono,
      fontSize: fontSize - 1,
      color: colors.accent.primary,
      backgroundColor: colors.bg.raised,
      paddingHorizontal: 4,
      paddingVertical: 1,
      borderRadius: radii.sm,
    },

    // Code blocks — handled by custom rule above, no fallback style needed
    fence: {},
    code_block: {},

    // Lists
    bullet_list: {
      marginBottom: spacing[2],
    },
    ordered_list: {
      marginBottom: spacing[2],
    },
    list_item: {
      marginBottom: spacing[1],
    },
    bullet_list_icon: {
      color: colors.fg.muted,
      fontSize,
      marginTop: fontSize * (AI_READING_LINE_HEIGHT - 1) * 0.5,
    },
    ordered_list_icon: {
      color: colors.fg.muted,
      fontSize,
      fontFamily: typography.fontFamily.mono,
      marginTop: fontSize * (AI_READING_LINE_HEIGHT - 1) * 0.5,
    },
    bullet_list_content: {
      flex: 1,
      color: colors.fg.primary,
      fontSize,
      lineHeight: fontSize * AI_READING_LINE_HEIGHT,
    },
    ordered_list_content: {
      flex: 1,
      color: colors.fg.primary,
      fontSize,
      lineHeight: fontSize * AI_READING_LINE_HEIGHT,
    },

    // Table
    table: {
      marginVertical: spacing[2],
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      borderRadius: radii.sm,
    },
    thead: {},
    tbody: {},
    th: {
      padding: spacing[2],
      backgroundColor: colors.bg.raised,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.secondary,
      fontSize: fontSize - 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    td: {
      padding: spacing[2],
      color: colors.fg.secondary,
      fontSize: fontSize - 1,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    tr: {},

    // Horizontal rule
    hr: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.divider,
      marginVertical: spacing[4],
    },

    // Image
    image: {
      borderRadius: radii.md,
      marginVertical: spacing[2],
    },
  });
}

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

interface MarkdownProps {
  children: string;
  compact?: boolean;
}

export const Markdown = memo(function Markdown({ children, compact = false }: MarkdownProps) {
  const { colors } = useTheme();
  const mdStyles = useMemo(() => buildMarkdownStyles(compact, colors), [compact, colors]);
  const rules = useMemo(() => buildRules(compact, colors), [compact, colors]);
  const content = useMemo(() => preprocessCallouts(children || ''), [children]);

  return (
    <RNMarkdown style={mdStyles} rules={rules}>
      {content}
    </RNMarkdown>
  );
});

// Styles live in CodeBlock via useMemo — see component body.
