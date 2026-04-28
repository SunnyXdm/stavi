// WHAT: ConfigSheet — bottom sheet for model/provider selection.
// WHY:  Slide-up modal showing available providers and models. Supports effort
//       and thinking toggles for models that expose those capabilities.
// HOW:  Controlled by visible/onClose props from the AI plugin. Provider list
//       comes from the orchestration layer (providers: ProviderInfo[]).
// SEE:  plugins/workspace/ai/ModelPopover.tsx (quick-popover for effort/mode),
//       theme/provider-brands.ts (provider brand colors — NOT theme tokens)

import React, { memo, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import {
  X,
  Check,
  Sparkles,
  Zap,
  Brain,
} from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import { providerBrands } from '../../../theme/provider-brands';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface ProviderInfo {
  provider: string;
  name: string;
  installed: boolean;
  authenticated: boolean;
  models: ModelInfo[];
  error?: string;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  supportsThinking: boolean;
  maxTokens: number;
  contextWindow: number;
  isDefault?: boolean;
  capabilities: {
    reasoningEffortLevels: Array<{ value: string; label: string; isDefault?: boolean }>;
    supportsFastMode: boolean;
    supportsThinkingToggle: boolean;
    contextWindowOptions: Array<{ value: string; label: string; isDefault?: boolean }>;
    promptInjectedEffortLevels: string[];
  };
}

export interface ConfigSelection {
  provider: string;
  modelId: string;
  modelName: string;
  thinking?: boolean;
  effort?: string;
  fastMode?: boolean;
  contextWindow?: string;
}

interface ConfigSheetProps {
  visible: boolean;
  onClose: () => void;
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (selection: ConfigSelection) => void;
}

// ----------------------------------------------------------
// Effort options
// ----------------------------------------------------------

const EFFORT_OPTIONS: Array<{ value: 'low' | 'medium' | 'high' | 'max'; label: string; icon: typeof Zap }> = [
  { value: 'low', label: 'Low', icon: Zap },
  { value: 'medium', label: 'Medium', icon: Zap },
  { value: 'high', label: 'High', icon: Sparkles },
  { value: 'max', label: 'Extra High', icon: Sparkles },
];

// Provider brand color map — keyed by provider id.
// These are brand assets from provider-brands.ts, NOT theme tokens.
const PROVIDER_ACCENT: Record<string, string> = {
  claude:   providerBrands.claude.color,
  codex:    providerBrands.codex.color,
  opencode: providerBrands.opencode.color,
};

// ----------------------------------------------------------
// Main component
// ----------------------------------------------------------

export const ConfigSheet = memo(function ConfigSheet({
  visible,
  onClose,
  providers,
  selection,
  onSelect,
}: ConfigSheetProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'flex-end' },
    backdropPress: { flex: 1 },
    sheet: { backgroundColor: colors.bg.base, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '70%' },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing[4], paddingVertical: spacing[3], borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider },
    headerTitle: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    content: { paddingHorizontal: spacing[4], paddingTop: spacing[3] },
    providerSection: { marginBottom: spacing[4] },
    providerHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing[2] },
    providerNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    providerAccentDot: { width: 8, height: 8, borderRadius: 4 },
    providerName: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.fg.secondary, textTransform: 'uppercase', letterSpacing: 0.5 },
    providerNameMuted: { color: colors.fg.muted },
    comingSoonBadge: { paddingHorizontal: spacing[2], paddingVertical: 2, borderRadius: radii.sm, backgroundColor: colors.bg.active },
    comingSoonText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, letterSpacing: 0.5 },
    statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    statusText: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
    setupButton: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    setupButtonText: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.medium, color: colors.accent.primary },
    modelList: { gap: spacing[1] },
    modelRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3], paddingVertical: spacing[2], borderRadius: radii.md, backgroundColor: colors.bg.raised },
    modelRowSelected: { backgroundColor: colors.accent.subtle, borderWidth: 1, borderColor: colors.accent.primary },
    modelInfo: { flex: 1, gap: 2 },
    modelName: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.medium, color: colors.fg.primary },
    modelNameSelected: { color: colors.accent.primary },
    modelMeta: { fontSize: typography.fontSize.xs, color: colors.fg.muted },
    settingSection: { marginBottom: spacing[4] },
    settingLabel: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.semibold, color: colors.fg.secondary, marginBottom: spacing[2] },
    settingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    settingInfo: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    effortRow: { flexDirection: 'row', gap: spacing[2] },
    effortChip: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingVertical: spacing[2], borderRadius: radii.md, backgroundColor: colors.bg.raised },
    effortChipActive: { backgroundColor: colors.accent.subtle, borderWidth: 1, borderColor: colors.accent.primary },
    effortLabel: { fontSize: typography.fontSize.sm, fontWeight: typography.fontWeight.medium, color: colors.fg.muted },
    effortLabelActive: { color: colors.accent.primary },
    toggle: { width: 44, height: 24, borderRadius: 12, backgroundColor: colors.bg.active, padding: 2, justifyContent: 'center' },
    toggleActive: { backgroundColor: colors.accent.primary },
    toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: colors.fg.muted },
    toggleKnobActive: { backgroundColor: colors.fg.onAccent, alignSelf: 'flex-end' },
  }), [colors]);

  const handleModelSelect = useCallback(
    (provider: string, model: ModelInfo) => {
      onSelect({
        ...selection,
        provider,
        modelId: model.id,
        modelName: model.name,
        thinking: model.supportsThinking ? selection.thinking : false,
      });
    },
    [selection, onSelect],
  );

  const handleEffortChange = useCallback(
    (effort: 'low' | 'medium' | 'high' | 'max') => {
      onSelect({ ...selection, effort });
    },
    [selection, onSelect],
  );

  const handleThinkingToggle = useCallback(() => {
    onSelect({ ...selection, thinking: !selection.thinking });
  }, [selection, onSelect]);

  const currentModel = providers
    .flatMap((p) => p.models)
    .find((m) => m.id === selection.modelId);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.backdropPress} onPress={onClose} />

        <View style={styles.sheet}>
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Model Settings</Text>
            <Pressable onPress={onClose} hitSlop={8}>
              <X size={20} color={colors.fg.muted} />
            </Pressable>
          </View>

          <ScrollView
            style={styles.content}
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Providers & Models */}
            {providers.map((provider) => (
              <View key={provider.provider} style={styles.providerSection}>
                <View style={styles.providerHeader}>
                  <View style={styles.providerNameRow}>
                    {PROVIDER_ACCENT[provider.provider] && (
                      <View
                        style={[
                          styles.providerAccentDot,
                          { backgroundColor: PROVIDER_ACCENT[provider.provider] },
                        ]}
                      />
                    )}
                    <Text style={styles.providerName}>{provider.name}</Text>
                  </View>
                  {provider.authenticated ? (
                    <View style={styles.statusBadge}>
                      <View style={[styles.statusDot, { backgroundColor: colors.semantic.success }]} />
                      <Text style={styles.statusText}>Connected</Text>
                    </View>
                  ) : (
                    <View style={styles.statusBadge}>
                      <View style={[styles.statusDot, { backgroundColor: colors.semantic.error }]} />
                      <Text style={styles.statusText}>
                        {provider.provider === 'claude' ? 'Run: claude auth login' : 'Install CLI'}
                      </Text>
                    </View>
                  )}
                </View>

                {provider.authenticated && provider.models.length > 0 && (
                  <View style={styles.modelList}>
                    {provider.models.map((model) => {
                      const isSelected = model.id === selection.modelId;
                      return (
                        <Pressable
                          key={model.id}
                          style={[styles.modelRow, isSelected && styles.modelRowSelected]}
                          onPress={() => handleModelSelect(provider.provider, model)}
                        >
                          <View style={styles.modelInfo}>
                            <Text
                              style={[styles.modelName, isSelected && styles.modelNameSelected]}
                            >
                              {model.name}
                            </Text>
                            <Text style={styles.modelMeta}>
                              {Math.round(model.contextWindow / 1000)}K ctx
                              {model.supportsThinking ? ' · Thinking' : ''}
                            </Text>
                          </View>
                          {isSelected && (
                            <Check size={16} color={colors.accent.primary} />
                          )}
                        </Pressable>
                      );
                    })}
                  </View>
                )}
              </View>
            ))}

            {/* Coming soon providers */}
            <View style={styles.providerSection}>
              <View style={styles.providerHeader}>
                <View style={styles.providerNameRow}>
                  <View style={[styles.providerAccentDot, { backgroundColor: providerBrands.opencode.color }]} />
                  <Text style={[styles.providerName, styles.providerNameMuted]}>OpenCode</Text>
                </View>
                <View style={styles.comingSoonBadge}>
                  <Text style={styles.comingSoonText}>COMING SOON</Text>
                </View>
              </View>
            </View>

            {/* Effort slider */}
            <View style={styles.settingSection}>
              <Text style={styles.settingLabel}>Effort</Text>
              <View style={styles.effortRow}>
                {EFFORT_OPTIONS.map((opt) => {
                  const isActive = selection.effort === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      style={[styles.effortChip, isActive && styles.effortChipActive]}
                      onPress={() => handleEffortChange(opt.value)}
                    >
                      <opt.icon
                        size={12}
                        color={isActive ? colors.accent.primary : colors.fg.muted}
                      />
                      <Text
                        style={[styles.effortLabel, isActive && styles.effortLabelActive]}
                      >
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Thinking toggle (only for models that support it) */}
            {currentModel?.supportsThinking && (
              <View style={styles.settingSection}>
                <View style={styles.settingRow}>
                  <View style={styles.settingInfo}>
                    <Brain size={16} color={colors.fg.secondary} />
                    <Text style={styles.settingLabel}>Extended Thinking</Text>
                  </View>
                  <Pressable
                    style={[styles.toggle, selection.thinking && styles.toggleActive]}
                    onPress={handleThinkingToggle}
                  >
                    <View
                      style={[
                        styles.toggleKnob,
                        selection.thinking && styles.toggleKnobActive,
                      ]}
                    />
                  </Pressable>
                </View>
              </View>
            )}

            {/* Bottom padding */}
            <View style={{ height: spacing[8] }} />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
});

// Styles computed dynamically via useMemo — see component body.
