// ============================================================
// UserInputPrompt — AskUserQuestion form
// ============================================================
// Rendered inline in the chat stream when the Claude Agent SDK invokes
// the AskUserQuestion tool.  Replaces the generic ApprovalCard for that
// specific tool.  Each question renders as:
//   - single-select radio list (multiSelect: false, options > 0)
//   - multi-select checkbox list (multiSelect: true, options > 0)
//   - free-text input (no options — edge case fallback)
// Every question has an optional "Notes" field.  Submit dispatches
// `thread.user-input.respond`.  No cancel button: the SDK tool contract
// expects an answer before the turn can continue.
//
// Edge cases / known limits (Phase E2):
//   - User navigates away before submitting: the pending request stays
//     on the server (in `pendingUserInputs`) until the turn is
//     interrupted; reopening the chat re-renders the prompt because
//     userInputs is in the orchestration state Map.
//   - Server restart mid-prompt: `pendingUserInputs` is in-memory only,
//     the Deferred is lost.  User will need to start a new turn.  A
//     stale `thread.user-input-requested` event is not replayed by the
//     server snapshot — this is a known gap, documented here and in
//     plans/13-roadmap.md Phase E2.

import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import { HelpCircle, Check } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../../theme';
import type { UserInputRequest } from '../useOrchestration';
import { AnimatedPressable } from '../../../../components/AnimatedPressable';
import { useHaptics } from '../../../../hooks/useHaptics';

interface Props {
  request: UserInputRequest;
  onSubmit: (
    threadId: string,
    requestId: string,
    answers: Array<{ question: string; selections: string[]; notes?: string }>,
  ) => Promise<void>;
}

type PerQuestionState = {
  /** Labels of selected options (single- or multi-select) */
  selections: string[];
  /** Free-text value when the question has no options */
  text: string;
  /** Optional notes attached to the answer */
  notes: string;
};

export const UserInputPrompt = memo(function UserInputPrompt({ request, onSubmit }: Props) {
  const { colors } = useTheme();
  const haptics = useHaptics();
  const [submitting, setSubmitting] = useState(false);
  const [state, setState] = useState<PerQuestionState[]>(() =>
    request.questions.map(() => ({ selections: [], text: '', notes: '' })),
  );

  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          marginHorizontal: spacing[4],
          marginVertical: spacing[2],
          backgroundColor: colors.bg.raised,
          borderRadius: radii.lg,
          borderLeftWidth: 3,
          borderLeftColor: colors.accent.primary,
          overflow: 'hidden',
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[2],
          paddingHorizontal: spacing[4],
          paddingTop: spacing[3],
          paddingBottom: spacing[1],
        },
        headerText: {
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          color: colors.accent.primary,
          textTransform: 'uppercase',
          letterSpacing: typography.letterSpacing.wide,
        },
        questionBlock: {
          paddingHorizontal: spacing[4],
          paddingVertical: spacing[3],
          borderTopWidth: StyleSheet.hairlineWidth,
          borderTopColor: colors.dividerSubtle,
        },
        questionBlockFirst: {
          borderTopWidth: 0,
        },
        headerChipRow: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: spacing[2],
          marginBottom: spacing[1],
        },
        headerChip: {
          backgroundColor: colors.bg.overlay,
          paddingHorizontal: spacing[2],
          paddingVertical: 2,
          borderRadius: radii.sm,
        },
        headerChipText: {
          fontSize: typography.fontSize.xs,
          fontWeight: typography.fontWeight.semibold,
          color: colors.fg.secondary,
          textTransform: 'uppercase',
          letterSpacing: typography.letterSpacing.wide,
        },
        questionText: {
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.medium,
          color: colors.fg.primary,
          marginBottom: spacing[2],
          lineHeight: typography.fontSize.sm * typography.lineHeight.normal,
        },
        optionRow: {
          flexDirection: 'row',
          alignItems: 'flex-start',
          gap: spacing[2],
          paddingVertical: spacing[2],
          paddingHorizontal: spacing[3],
          borderRadius: radii.md,
          marginBottom: spacing[1],
          backgroundColor: colors.bg.input,
        },
        optionRowSelected: {
          backgroundColor: colors.bg.overlay,
          borderWidth: 1,
          borderColor: colors.accent.primary,
        },
        selector: {
          width: 18,
          height: 18,
          borderRadius: 9,
          borderWidth: 1.5,
          borderColor: colors.divider,
          alignItems: 'center',
          justifyContent: 'center',
          marginTop: 2,
        },
        selectorCheckbox: {
          borderRadius: radii.sm,
        },
        selectorSelected: {
          backgroundColor: colors.accent.primary,
          borderColor: colors.accent.primary,
        },
        optionTextCol: { flex: 1 },
        optionLabel: {
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.medium,
          color: colors.fg.primary,
        },
        optionDesc: {
          fontSize: typography.fontSize.xs,
          color: colors.fg.tertiary,
          marginTop: 2,
          lineHeight: typography.fontSize.xs * typography.lineHeight.normal,
        },
        textInput: {
          borderWidth: 1,
          borderColor: colors.divider,
          borderRadius: radii.md,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          color: colors.fg.primary,
          backgroundColor: colors.bg.input,
          fontSize: typography.fontSize.sm,
          minHeight: 40,
        },
        notesInput: {
          marginTop: spacing[2],
          borderWidth: 1,
          borderColor: colors.dividerSubtle,
          borderRadius: radii.sm,
          paddingHorizontal: spacing[3],
          paddingVertical: spacing[2],
          color: colors.fg.secondary,
          backgroundColor: colors.bg.input,
          fontSize: typography.fontSize.xs,
          minHeight: 36,
        },
        notesLabel: {
          fontSize: typography.fontSize.xs,
          color: colors.fg.tertiary,
          marginTop: spacing[2],
          marginBottom: 2,
        },
        actions: {
          flexDirection: 'row',
          paddingHorizontal: spacing[4],
          paddingBottom: spacing[3],
          paddingTop: spacing[2],
        },
        submitButton: {
          flex: 1,
          borderRadius: radii.md,
          paddingVertical: spacing[3],
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: colors.accent.primary,
          minHeight: 40,
        },
        submitButtonDisabled: {
          opacity: 0.5,
        },
        submitText: {
          fontSize: typography.fontSize.sm,
          fontWeight: typography.fontWeight.semibold,
          color: colors.fg.onAccent,
        },
      }),
    [colors],
  );

  const toggleSelection = useCallback(
    (qIdx: number, label: string, multiSelect: boolean) => {
      haptics.selection();
      setState((prev) => {
        const next = [...prev];
        const cur = next[qIdx];
        if (multiSelect) {
          const has = cur.selections.includes(label);
          next[qIdx] = {
            ...cur,
            selections: has ? cur.selections.filter((s) => s !== label) : [...cur.selections, label],
          };
        } else {
          next[qIdx] = { ...cur, selections: [label] };
        }
        return next;
      });
    },
    [haptics],
  );

  const setText = useCallback((qIdx: number, value: string) => {
    setState((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], text: value };
      return next;
    });
  }, []);

  const setNotes = useCallback((qIdx: number, value: string) => {
    setState((prev) => {
      const next = [...prev];
      next[qIdx] = { ...next[qIdx], notes: value };
      return next;
    });
  }, []);

  // Enable submit only when every question has been answered in some form.
  const canSubmit = useMemo(() => {
    return request.questions.every((q, i) => {
      const s = state[i];
      if (!q.options || q.options.length === 0) return s.text.trim().length > 0;
      return s.selections.length > 0;
    });
  }, [request.questions, state]);

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || submitting) return;
    haptics.medium();
    setSubmitting(true);
    try {
      const answers = request.questions.map((q, i) => {
        const s = state[i];
        const hasOptions = q.options && q.options.length > 0;
        const selections = hasOptions ? s.selections : s.text.trim() ? [s.text.trim()] : [];
        return {
          question: q.question,
          selections,
          notes: s.notes.trim() ? s.notes.trim() : undefined,
        };
      });
      await onSubmit(request.threadId, request.requestId, answers);
    } catch (err) {
      console.error('[UserInputPrompt] Submit error:', err);
      setSubmitting(false);
    }
  }, [canSubmit, submitting, request, state, haptics, onSubmit]);

  if (!request.pending) return null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <HelpCircle size={16} color={colors.accent.primary} />
        <Text style={styles.headerText}>Claude needs your input</Text>
      </View>

      {request.questions.map((q, qIdx) => {
        const s = state[qIdx];
        const hasOptions = q.options && q.options.length > 0;
        return (
          <View
            key={`${qIdx}-${q.question}`}
            style={[styles.questionBlock, qIdx === 0 ? styles.questionBlockFirst : null]}
          >
            <View style={styles.headerChipRow}>
              {q.header ? (
                <View style={styles.headerChip}>
                  <Text style={styles.headerChipText}>{q.header}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.questionText}>{q.question}</Text>

            {hasOptions ? (
              q.options.map((opt) => {
                const selected = s.selections.includes(opt.label);
                return (
                  <AnimatedPressable
                    key={opt.label}
                    style={[styles.optionRow, selected ? styles.optionRowSelected : null]}
                    onPress={() => toggleSelection(qIdx, opt.label, q.multiSelect)}
                    disabled={submitting}
                  >
                    <View
                      style={[
                        styles.selector,
                        q.multiSelect ? styles.selectorCheckbox : null,
                        selected ? styles.selectorSelected : null,
                      ]}
                    >
                      {selected ? <Check size={12} color={colors.fg.onAccent} /> : null}
                    </View>
                    <View style={styles.optionTextCol}>
                      <Text style={styles.optionLabel}>{opt.label}</Text>
                      {opt.description ? (
                        <Text style={styles.optionDesc}>{opt.description}</Text>
                      ) : null}
                    </View>
                  </AnimatedPressable>
                );
              })
            ) : (
              <TextInput
                style={styles.textInput}
                value={s.text}
                onChangeText={(v) => setText(qIdx, v)}
                placeholder="Type your answer…"
                placeholderTextColor={colors.fg.tertiary}
                editable={!submitting}
                multiline
              />
            )}

            <Text style={styles.notesLabel}>Notes (optional)</Text>
            <TextInput
              style={styles.notesInput}
              value={s.notes}
              onChangeText={(v) => setNotes(qIdx, v)}
              placeholder="Add context…"
              placeholderTextColor={colors.fg.tertiary}
              editable={!submitting}
              multiline
            />
          </View>
        );
      })}

      <View style={styles.actions}>
        <AnimatedPressable
          style={[styles.submitButton, (!canSubmit || submitting) && styles.submitButtonDisabled]}
          onPress={handleSubmit}
          disabled={!canSubmit || submitting}
        >
          {submitting ? (
            <ActivityIndicator size={14} color={colors.fg.onAccent} />
          ) : (
            <Text style={styles.submitText}>Submit</Text>
          )}
        </AnimatedPressable>
      </View>
    </View>
  );
});
