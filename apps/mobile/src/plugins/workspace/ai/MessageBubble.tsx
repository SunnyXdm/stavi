// ============================================================
// MessageBubble — AIPart-based message rendering
// ============================================================
// User messages: right-aligned bubbles (bg.raised)
// Assistant messages: left-aligned, full-width with part rendering.
// Text parts render through Markdown. Tool parts render inline.
// Reasoning parts show as collapsible "Thinking" blocks.

import React, { memo, useState, useCallback, useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Sparkles, Brain, ChevronDown, ChevronRight } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import type { Colors } from '../../../theme';
import { Markdown } from './Markdown';
import type { AIMessage, AIPart, TextPart, ReasoningPart, ToolCallPart, ToolResultPart } from './types';

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface MessageBubbleProps {
  message: AIMessage;
}

// ----------------------------------------------------------
// Style factory
// ----------------------------------------------------------

function createStyles(colors: Colors) {
  return StyleSheet.create({
    // User message — right aligned
    userRow: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[1],
    },
    userBubble: {
      maxWidth: '80%',
      backgroundColor: colors.bg.raised,
      borderRadius: radii.lg,
      borderBottomRightRadius: radii.sm,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
    },
    userText: {
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.regular,
      color: colors.fg.primary,
      lineHeight: typography.fontSize.base * 1.45,
    },

    // Assistant message — left aligned, full width
    assistantRow: {
      flexDirection: 'row',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[1],
      gap: spacing[2],
    },
    assistantIcon: {
      width: 24,
      height: 24,
      borderRadius: radii.full,
      backgroundColor: colors.accent.subtle,
      alignItems: 'center',
      justifyContent: 'center',
      marginTop: 2,
    },
    assistantContent: {
      flex: 1,
    },

    // Streaming cursor
    streamingCursor: {
      flexDirection: 'row',
      marginTop: 4,
    },
    cursor: {
      width: 2,
      height: 16,
      backgroundColor: colors.accent.primary,
      borderRadius: 1,
      opacity: 0.7,
    },

    // Reasoning
    reasoningContainer: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.md,
      marginVertical: spacing[1],
      overflow: 'hidden',
    },
    reasoningHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
    },
    reasoningLabel: {
      flex: 1,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.muted,
      fontStyle: 'italic',
    },
    reasoningBody: {
      paddingHorizontal: spacing[3],
      paddingBottom: spacing[3],
    },
    reasoningText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.tertiary,
      lineHeight: typography.fontSize.sm * 1.5,
      fontStyle: 'italic',
    },

    // Tool call pill
    toolPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      backgroundColor: colors.bg.raised,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      marginVertical: 2,
    },
    toolPillDot: {
      width: 6,
      height: 6,
      borderRadius: 3,
    },
    toolPillName: {
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
    toolPillCommand: {
      flex: 1,
      fontSize: typography.fontSize.xs,
      color: colors.fg.tertiary,
      fontFamily: typography.fontFamily.mono,
    },

    // Tool result
    toolResult: {
      backgroundColor: colors.bg.input,
      borderRadius: radii.sm,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      marginVertical: 2,
    },
    toolResultText: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.tertiary,
      fontFamily: typography.fontFamily.mono,
      lineHeight: typography.fontSize.xs * 1.5,
    },
    toolResultError: {
      backgroundColor: colors.semantic.errorSubtle,
      borderRadius: radii.sm,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      marginVertical: 2,
    },
    toolResultErrorText: {
      fontSize: typography.fontSize.xs,
      color: colors.semantic.error,
      fontFamily: typography.fontFamily.mono,
      lineHeight: typography.fontSize.xs * 1.5,
    },

    // Step
    stepLabel: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
      marginVertical: 2,
    },
    stepFinish: {
      flexDirection: 'row',
      gap: spacing[2],
      marginVertical: 2,
    },
    stepChip: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
      backgroundColor: colors.bg.raised,
      borderRadius: radii.sm,
      paddingHorizontal: spacing[2],
      paddingVertical: 2,
    },

    // File change
    fileChangePill: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.md,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[2],
      marginVertical: 2,
      borderLeftWidth: 2,
      borderLeftColor: colors.semantic.info,
    },
    fileChangeText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
  });
}

type BubbleStyles = ReturnType<typeof createStyles>;

// ----------------------------------------------------------
// Part renderers
// ----------------------------------------------------------

/** Render a text part — user gets plain text, assistant gets Markdown */
function TextPartView({ part, isUser, styles }: { part: TextPart; isUser: boolean; styles: BubbleStyles }) {
  if (isUser) {
    return <Text style={styles.userText}>{part.text}</Text>;
  }
  return <Markdown>{part.text}</Markdown>;
}

/** Collapsible reasoning/thinking block */
const ReasoningPartView = memo(function ReasoningPartView({ part, styles, colors }: { part: ReasoningPart; styles: BubbleStyles; colors: Colors }) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((v) => !v), []);
  const Chevron = expanded ? ChevronDown : ChevronRight;

  return (
    <View style={styles.reasoningContainer}>
      <Pressable style={styles.reasoningHeader} onPress={toggle}>
        <Brain size={14} color={colors.fg.muted} />
        <Text style={styles.reasoningLabel}>Thinking</Text>
        <Chevron size={14} color={colors.fg.muted} />
      </Pressable>
      {expanded && (
        <View style={styles.reasoningBody}>
          <Text style={styles.reasoningText}>{part.text}</Text>
        </View>
      )}
    </View>
  );
});

/** Inline tool call pill — compact summary */
function ToolCallPartView({ part, styles, colors }: { part: ToolCallPart; styles: BubbleStyles; colors: Colors }) {
  const name = part.toolName || part.name || 'tool';
  const isCommand = name === 'Bash' || name === 'bash' || name === 'command';
  const command = isCommand && part.input ? String((part.input as any).command ?? '') : '';

  const stateColor =
    part.state === 'error'
      ? colors.semantic.error
      : part.state === 'completed'
        ? colors.semantic.success
        : colors.accent.primary;

  return (
    <View style={styles.toolPill}>
      <View style={[styles.toolPillDot, { backgroundColor: stateColor }]} />
      <Text style={styles.toolPillName} numberOfLines={1}>
        {name}
      </Text>
      {command ? (
        <Text style={styles.toolPillCommand} numberOfLines={1}>
          {command}
        </Text>
      ) : null}
    </View>
  );
}

/** Tool result — compact output preview */
function ToolResultPartView({ part, styles }: { part: ToolResultPart; styles: BubbleStyles }) {
  if (part.error) {
    return (
      <View style={styles.toolResultError}>
        <Text style={styles.toolResultErrorText} numberOfLines={3}>
          {String(part.error)}
        </Text>
      </View>
    );
  }
  // Don't render empty results
  if (!part.output) return null;
  const output = typeof part.output === 'string' ? part.output : JSON.stringify(part.output);
  if (output.length < 10) return null; // trivial output

  return (
    <View style={styles.toolResult}>
      <Text style={styles.toolResultText} numberOfLines={4}>
        {output.slice(0, 500)}
      </Text>
    </View>
  );
}

/** Step parts — just a subtle label */
function StepView({ part, styles }: { part: AIPart; styles: BubbleStyles }) {
  if (part.type === 'step-start') {
    const title = (part as any).title;
    return title ? (
      <Text style={styles.stepLabel}>{title}</Text>
    ) : null;
  }
  if (part.type === 'step-finish') {
    const tokens = (part as any).tokens;
    if (!tokens) return null;
    return (
      <View style={styles.stepFinish}>
        {tokens.input != null && (
          <Text style={styles.stepChip}>In: {tokens.input}</Text>
        )}
        {tokens.output != null && (
          <Text style={styles.stepChip}>Out: {tokens.output}</Text>
        )}
      </View>
    );
  }
  return null;
}

/** Dispatch a part to its renderer */
function MessagePartView({ part, isUser, styles, colors }: { part: AIPart; isUser: boolean; styles: BubbleStyles; colors: Colors }) {
  switch (part.type) {
    case 'text':
      return <TextPartView part={part} isUser={isUser} styles={styles} />;
    case 'reasoning':
      return <ReasoningPartView part={part} styles={styles} colors={colors} />;
    case 'tool-call':
      return <ToolCallPartView part={part} styles={styles} colors={colors} />;
    case 'tool-result':
      return <ToolResultPartView part={part} styles={styles} />;
    case 'tool':
      // Legacy tool part — render as tool call pill
      return (
        <ToolCallPartView
          part={{
            type: 'tool-call',
            toolName: (part as any).toolName ?? (part as any).name ?? 'tool',
            state: (part as any).state,
            input: (part as any).input,
          }}
          styles={styles}
          colors={colors}
        />
      );
    case 'step-start':
    case 'step-finish':
      return <StepView part={part} styles={styles} />;
    case 'file-change':
      return (
        <View style={styles.fileChangePill}>
          <Text style={styles.fileChangeText} numberOfLines={1}>
            {(part as any).action ?? 'edit'}: {(part as any).path ?? 'file'}
          </Text>
        </View>
      );
    default:
      return null;
  }
}

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const MessageBubble = memo(function MessageBubble({ message }: MessageBubbleProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const isUser = message.role === 'user';
  const parts = message.parts;

  // Fallback for empty parts (shouldn't happen, but safety)
  if (!parts || parts.length === 0) {
    return null;
  }

  if (isUser) {
    // User messages — right-aligned bubble, render text parts only
    const textContent = parts
      .filter((p): p is TextPart => p.type === 'text')
      .map((p) => p.text)
      .join('\n');

    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{textContent}</Text>
        </View>
      </View>
    );
  }

  // Assistant message — left-aligned, full width, render all parts
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantIcon}>
        <Sparkles size={14} color={colors.accent.primary} />
      </View>
      <View style={styles.assistantContent}>
        {parts.map((part, i) => (
          <MessagePartView key={`${part.type}-${(part as any).id ?? i}`} part={part} isUser={false} styles={styles} colors={colors} />
        ))}
        {message.streaming && (
          <View style={styles.streamingCursor}>
            <View style={styles.cursor} />
          </View>
        )}
      </View>
    </View>
  );
});

// Styles live in createStyles(colors) factory — see above.
