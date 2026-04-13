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
  Zap,
  Sparkles,
} from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';
import { ProviderIcon } from './ProviderIcon';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type InteractionMode = 'default' | 'plan';
export type AccessLevel = 'supervised' | 'auto-accept' | 'full-access';
export type EffortLevel = string;

export interface ModelChipInfo {
  provider: string;
  modelName: string;
  modelId: string;
}

interface ComposerProps {
  onSend: (text: string) => void;
  onInterrupt?: () => void;
  onProviderPress?: () => void;
  onModelPress?: () => void;
  onEffortPress?: () => void;
  onThinkingPress?: () => void;
  onFastModePress?: () => void;
  onContextWindowPress?: () => void;
  onModePress?: () => void;
  onAccessPress?: () => void;
  isWorking?: boolean;
  placeholder?: string;
  selectedModel?: ModelChipInfo | null;
  mode?: InteractionMode;
  accessLevel?: AccessLevel;
  effort?: EffortLevel;
  thinkingEnabled?: boolean;
  showThinkingToggle?: boolean;
  fastMode?: boolean;
  showFastModeToggle?: boolean;
  contextWindowLabel?: string | null;
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

const ACCESS_LABELS: Record<AccessLevel, string> = {
  'supervised': 'Supervised',
  'auto-accept': 'Auto',
  'full-access': 'Full access',
};

const EFFORT_LABELS: Record<EffortLevel, string> = {
  'low': 'Low',
  'medium': 'Med',
  'high': 'High',
  'max': 'Extra High',
  'ultrathink': 'Ultrathink',
  'xhigh': 'Extra High',
};

function getEffortIcon(effort: EffortLevel) {
  if (effort === 'high' || effort === 'max') {
    return <Sparkles size={12} color={colors.accent.primary} />;
  }
  return <Zap size={12} color={colors.fg.tertiary} />;
}

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const Composer = memo(function Composer({
  onSend,
  onInterrupt,
  onProviderPress,
  onModelPress,
  onEffortPress,
  onThinkingPress,
  onFastModePress,
  onContextWindowPress,
  onModePress,
  onAccessPress,
  isWorking = false,
  placeholder = 'Ask anything...',
  selectedModel,
  mode = 'default',
  accessLevel = 'supervised',
  effort = 'high',
  thinkingEnabled,
  showThinkingToggle = false,
  fastMode = false,
  showFastModeToggle = false,
  contextWindowLabel,
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

  const hasText = text.trim().length > 0;
  const modelLabel = selectedModel?.modelName || 'Choose model';

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

      {/* Toolbar row */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.toolbar}
        bounces={false}
      >
        {/* Provider chip — icon + name, opens provider list or model list */}
        <Pressable style={styles.providerChip} onPress={onProviderPress} hitSlop={4}>
          {selectedModel?.provider && (
            <ProviderIcon provider={selectedModel.provider} size={16} />
          )}
          <Text style={styles.providerChipLabel} numberOfLines={1}>
            {selectedModel?.provider === 'claude'
              ? 'Claude'
              : selectedModel?.provider === 'codex'
                ? 'Codex'
                : 'Provider'}
          </Text>
          <ChevronDown size={10} color={colors.fg.muted} />
        </Pressable>

        {/* Model name chip — opens settings */}
        <Pressable style={styles.modelChip} onPress={onModelPress} hitSlop={4}>
          <Text style={styles.modelLabel} numberOfLines={1}>
            {modelLabel}
          </Text>
          <ChevronDown size={10} color={colors.fg.muted} />
        </Pressable>

        {/* Effort chip */}
        {showThinkingToggle ? (
          <ToolbarChip
            label={thinkingEnabled === false ? 'Think Off' : 'Think On'}
            icon={<Sparkles size={12} color={thinkingEnabled === false ? colors.fg.tertiary : colors.accent.primary} />}
            onPress={onThinkingPress}
            active={thinkingEnabled !== false}
          />
        ) : onEffortPress ? (
          <ToolbarChip
            label={EFFORT_LABELS[effort] ?? effort}
            icon={getEffortIcon(effort)}
            onPress={onEffortPress}
            active={effort === 'high' || effort === 'max' || effort === 'xhigh' || effort === 'ultrathink'}
          />
        ) : null}

        {showFastModeToggle ? (
          <ToolbarChip
            label={fastMode ? 'Fast On' : 'Fast Off'}
            icon={<Zap size={12} color={fastMode ? colors.accent.primary : colors.fg.tertiary} />}
            onPress={onFastModePress}
            active={fastMode}
          />
        ) : null}

        {contextWindowLabel ? (
          <ToolbarChip
            label={contextWindowLabel}
            icon={<ChevronDown size={12} color={colors.fg.tertiary} />}
            onPress={onContextWindowPress}
          />
        ) : null}

        {/* Mode chip */}
        <ToolbarChip
          label={mode === 'default' ? 'Chat' : 'Plan'}
          icon={<Sparkles size={12} color={mode === 'plan' ? colors.accent.primary : colors.fg.tertiary} />}
          onPress={onModePress}
          active={mode === 'plan'}
        />

        {/* Access chip */}
        <ToolbarChip
          label={ACCESS_LABELS[accessLevel]}
          icon={null}
          onPress={onAccessPress}
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
  providerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: spacing[2],
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.input,
  },
  providerChipLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
  },
  modelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing[2],
    paddingVertical: 5,
    borderRadius: radii.sm,
    backgroundColor: colors.bg.input,
  },
  modelLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
    maxWidth: 110,
  },
  toolbarSpacer: {
    flex: 1,
  },
});
