// ============================================================
// Composer — Chat input bar with model/mode/access toolbar
// ============================================================
// Bottom-anchored input with:
// - Auto-growing TextInput
// - Model chip (taps to open ConfigSheet)
// - Mode toggle (Chat / Plan)
// - Access chip (Supervised / Auto / Full)
// - Send/Stop button

import React, { memo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  StyleSheet,
  Pressable,
  ScrollView,
} from 'react-native';
import {
  Send,
  StopCircle,
  ChevronDown,
  Shield,
  ShieldOff,
  ShieldCheck,
  MessageSquare,
  ClipboardList,
  Zap,
  Sparkles,
} from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type InteractionMode = 'default' | 'plan';
export type AccessLevel = 'supervised' | 'auto-accept' | 'full-access';
export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface ModelChipInfo {
  provider: string;
  modelName: string;
  modelId: string;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  onOpenConfig?: () => void;
  isWorking?: boolean;
  placeholder?: string;
  // Model/mode/access state
  selectedModel?: ModelChipInfo | null;
  mode?: InteractionMode;
  onModeChange?: (mode: InteractionMode) => void;
  accessLevel?: AccessLevel;
  onAccessChange?: (level: AccessLevel) => void;
  effort?: EffortLevel;
  onEffortChange?: (effort: EffortLevel) => void;
}

// ----------------------------------------------------------
// Sub-components
// ----------------------------------------------------------

/** Small chip for the toolbar */
function ToolbarChip({
  label,
  icon,
  iconColor,
  onPress,
  active,
}: {
  label: string;
  icon: React.ReactNode;
  iconColor?: string;
  onPress?: () => void;
  active?: boolean;
}) {
  return (
    <Pressable
      style={[chipStyles.chip, active && chipStyles.chipActive]}
      onPress={onPress}
      hitSlop={4}
    >
      {icon}
      <Text style={[chipStyles.chipLabel, active && chipStyles.chipLabelActive]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const chipStyles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.input,
  },
  chipActive: {
    backgroundColor: colors.accent.subtle,
  },
  chipLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
    maxWidth: 80,
  },
  chipLabelActive: {
    color: colors.accent.primary,
  },
});

// ----------------------------------------------------------
// Access level helpers
// ----------------------------------------------------------

const ACCESS_LEVELS: AccessLevel[] = ['supervised', 'auto-accept', 'full-access'];
const ACCESS_LABELS: Record<AccessLevel, string> = {
  'supervised': 'Supervised',
  'auto-accept': 'Auto',
  'full-access': 'Full',
};

const EFFORT_LEVELS: EffortLevel[] = ['low', 'medium', 'high', 'max'];
const EFFORT_LABELS: Record<EffortLevel, string> = {
  'low': 'Low',
  'medium': 'Med',
  'high': 'High',
  'max': 'Max',
};

function getAccessIcon(level: AccessLevel) {
  switch (level) {
    case 'supervised':
      return <Shield size={12} color={colors.semantic.success} />;
    case 'auto-accept':
      return <ShieldCheck size={12} color={colors.semantic.warning} />;
    case 'full-access':
      return <ShieldOff size={12} color={colors.semantic.error} />;
  }
}

function getEffortIcon(effort: EffortLevel) {
  if (effort === 'high' || effort === 'max') {
    return <Sparkles size={12} color={colors.accent.primary} />;
  }
  return <Zap size={12} color={colors.fg.tertiary} />;
}

function getProviderDotColor(provider?: string) {
  if (provider === 'claude') return '#e8654a'; // Anthropic red-orange
  if (provider === 'codex') return '#74aa9c'; // OpenAI green
  return colors.fg.muted;
}

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const Composer = memo(function Composer({
  onSend,
  onInterrupt,
  onOpenConfig,
  isWorking = false,
  placeholder = 'Ask anything...',
  selectedModel,
  mode = 'default',
  onModeChange,
  accessLevel = 'supervised',
  onAccessChange,
  effort = 'high',
  onEffortChange,
}: ComposerProps) {
  const [text, setText] = useState('');
  const inputRef = useRef<TextInput>(null);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText('');
  }, [text, onSend]);

  const handleInterrupt = useCallback(() => {
    onInterrupt?.();
  }, [onInterrupt]);

  const toggleMode = useCallback(() => {
    const next = mode === 'default' ? 'plan' : 'default';
    onModeChange?.(next);
  }, [mode, onModeChange]);

  const cycleAccess = useCallback(() => {
    const idx = ACCESS_LEVELS.indexOf(accessLevel);
    const next = ACCESS_LEVELS[(idx + 1) % ACCESS_LEVELS.length];
    onAccessChange?.(next);
  }, [accessLevel, onAccessChange]);

  const cycleEffort = useCallback(() => {
    const idx = EFFORT_LEVELS.indexOf(effort);
    const next = EFFORT_LEVELS[(idx + 1) % EFFORT_LEVELS.length];
    onEffortChange?.(next);
  }, [effort, onEffortChange]);

  const hasText = text.trim().length > 0;
  const modelLabel = selectedModel?.modelName ?? 'No model';

  return (
    <View style={styles.container}>
      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          ref={inputRef}
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          placeholderTextColor={colors.fg.muted}
          multiline
          maxLength={100000}
          returnKeyType="default"
          blurOnSubmit={false}
          autoCapitalize="sentences"
        />

        {isWorking ? (
          <Pressable
            style={styles.actionButton}
            onPress={handleInterrupt}
            hitSlop={8}
          >
            <StopCircle size={22} color={colors.semantic.error} />
          </Pressable>
        ) : (
          <Pressable
            style={[
              styles.actionButton,
              hasText && styles.sendButtonActive,
            ]}
            onPress={handleSend}
            disabled={!hasText}
            hitSlop={8}
          >
            <Send
              size={18}
              color={hasText ? colors.fg.onAccent : colors.fg.muted}
            />
          </Pressable>
        )}
      </View>

      {/* Toolbar row — scrollable for narrow screens */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        bounces={false}
      >
        {/* Model chip with provider dot */}
        <Pressable style={styles.modelChip} onPress={onOpenConfig} hitSlop={4}>
          <View style={[styles.providerDot, { backgroundColor: getProviderDotColor(selectedModel?.provider) }]} />
          <Text style={styles.modelLabel} numberOfLines={1}>
            {modelLabel}
          </Text>
          <ChevronDown size={10} color={colors.fg.muted} />
        </Pressable>

        {/* Effort chip */}
        <ToolbarChip
          label={EFFORT_LABELS[effort]}
          icon={getEffortIcon(effort)}
          onPress={cycleEffort}
          active={effort === 'high' || effort === 'max'}
        />

        <View style={styles.toolbarSpacer} />

        {/* Mode chip */}
        <ToolbarChip
          label={mode === 'default' ? 'Chat' : 'Plan'}
          icon={
            mode === 'default'
              ? <MessageSquare size={12} color={colors.fg.tertiary} />
              : <ClipboardList size={12} color={colors.accent.primary} />
          }
          onPress={toggleMode}
          active={mode === 'plan'}
        />

        {/* Access chip */}
        <ToolbarChip
          label={ACCESS_LABELS[accessLevel]}
          icon={getAccessIcon(accessLevel)}
          onPress={cycleAccess}
        />
      </ScrollView>
    </View>
  );
});

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    backgroundColor: colors.bg.raised,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: spacing[2],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing[2],
  },
  input: {
    flex: 1,
    backgroundColor: colors.bg.input,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    fontSize: typography.fontSize.base,
    color: colors.fg.primary,
    maxHeight: 160,
    minHeight: 40,
  },
  actionButton: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonActive: {
    backgroundColor: colors.accent.primary,
  },

  // Toolbar
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    marginTop: spacing[2],
    paddingHorizontal: spacing[1],
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 4,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.input,
  },
  providerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  modelLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
    maxWidth: 120,
  },
  toolbarSpacer: {
    flex: 1,
  },
});
