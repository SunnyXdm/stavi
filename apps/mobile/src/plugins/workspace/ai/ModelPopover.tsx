// WHAT: ModelPopover — contextual floating popover above the toolbar.
// WHY:  Effort, mode, access sections use a quick popover box above the composer.
//       Provider/model selection uses a bottom sheet for more visual space.
// HOW:  Two rendering modes gated by isQuick. Section content components are
//       pure functions so the modal logic stays simple.
// SEE:  plugins/workspace/ai/Composer.tsx (chip presses that open this),
//       plugins/workspace/ai/ConfigSheet.tsx (alternative full-sheet selector),
//       theme/provider-brands.ts (brand colors — NOT theme tokens)

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { Check, ChevronRight, ChevronLeft, Shield, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { useTheme, typography, spacing, radii } from '../../../theme';
import type { Colors } from '../../../theme';
import { providerBrands } from '../../../theme/provider-brands';
import type { ProviderInfo, ConfigSelection } from './ConfigSheet';
import { ProviderIcon } from './ProviderIcon';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type PopoverSection = 'providers' | 'models' | 'effort' | 'thinking' | 'fastMode' | 'contextWindow' | 'mode' | 'access';

export type InteractionMode = 'default' | 'plan';
export type AccessLevel = 'supervised' | 'auto-accept' | 'full-access';

export interface ModelPopoverProps {
  visible: boolean;
  section: PopoverSection;
  onClose: () => void;
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  providerLocked?: boolean;
  mode: InteractionMode;
  onModeChange: (m: InteractionMode) => void;
  accessLevel: AccessLevel;
  onAccessChange: (a: AccessLevel) => void;
}

// ----------------------------------------------------------
// Provider metadata
// ----------------------------------------------------------

// Coming-soon provider entries rendered in the providers list.
// Colors come from provider-brands.ts — these are brand assets, not theme tokens.
const COMING_SOON_PROVIDERS = [
  { key: 'cursor'   as const, name: providerBrands.cursor.label,   color: providerBrands.cursor.color },
  { key: 'opencode' as const, name: providerBrands.opencode.label, color: providerBrands.opencode.color },
  { key: 'gemini'   as const, name: providerBrands.gemini.label,   color: providerBrands.gemini.color },
];

function getCurrentModel(providers: ProviderInfo[], selection: ConfigSelection) {
  return providers
    .find((provider) => provider.provider === selection.provider)
    ?.models.find((model) => model.id === selection.modelId);
}

function normalizeSelectionForModel(selection: ConfigSelection, model?: ProviderInfo['models'][number]) {
  if (!model) return selection;
  return {
    ...selection,
    modelId: model.id,
    modelName: model.name,
    thinking: model.capabilities.supportsThinkingToggle
      ? (selection.thinking ?? true)
      : undefined,
    effort:
      model.capabilities.reasoningEffortLevels.find((level) => level.value === selection.effort)?.value ??
      model.capabilities.reasoningEffortLevels.find((level) => level.isDefault)?.value,
    fastMode: model.capabilities.supportsFastMode ? (selection.fastMode ?? false) : undefined,
    contextWindow:
      model.capabilities.contextWindowOptions.find((option) => option.value === selection.contextWindow)?.value ??
      model.capabilities.contextWindowOptions.find((option) => option.isDefault)?.value,
  } satisfies ConfigSelection;
}

// ----------------------------------------------------------
// Styles factory
// ----------------------------------------------------------

function createPopoverStyles(colors: Colors) {
  return StyleSheet.create({
    // Quick popover (effort/mode/access) — floats above the toolbar
    quickOverlay: { flex: 1, justifyContent: 'flex-end', paddingBottom: 90, paddingHorizontal: spacing[3] },
    quickBox: { backgroundColor: colors.bg.overlay, borderRadius: radii.lg, maxHeight: 380, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, elevation: 24 },
    // Bottom sheet (providers/models)
    sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
    sheetBox: { backgroundColor: colors.bg.overlay, borderTopLeftRadius: radii.xl, borderTopRightRadius: radii.xl, maxHeight: '65%', borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.divider, elevation: 20 },
    // Row
    row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing[3], paddingVertical: spacing[3], gap: spacing[2] },
    rowPressed: { backgroundColor: colors.bg.active },
    rowCheck: { width: 18, alignItems: 'center' },
    rowIcon: { width: 22, alignItems: 'center' },
    rowText: { flex: 1, gap: 2 },
    rowLabel: { fontSize: typography.fontSize.sm, color: colors.fg.secondary, fontWeight: typography.fontWeight.medium },
    rowLabelSelected: { color: colors.fg.primary },
    rowLabelMuted: { color: colors.fg.muted },
    rowSublabel: { fontSize: typography.fontSize.xs, color: colors.fg.muted, lineHeight: 16 },
    // Section header
    sectionHeader: { fontSize: typography.fontSize.xs, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: spacing[3], paddingTop: spacing[2], paddingBottom: 4 },
    divider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.divider, marginVertical: 4 },
    // Back row (models view)
    backRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[3], paddingVertical: 12 },
    backLabel: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    lockedBadge: { marginLeft: 'auto', fontSize: 10, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, letterSpacing: 0.5 },
    // Provider list
    activeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
    comingSoon: { fontSize: 10, fontWeight: typography.fontWeight.semibold, color: colors.fg.muted, letterSpacing: 0.3 },
  });
}

type PopoverStyles = ReturnType<typeof createPopoverStyles>;

// ----------------------------------------------------------
// Shared row component
// ----------------------------------------------------------

function MenuRow({
  label,
  sublabel,
  icon,
  selected,
  onPress,
  s,
  colors,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <Pressable
      style={({ pressed }) => [s.row, pressed && s.rowPressed]}
      onPress={onPress}
    >
      <View style={s.rowCheck}>
        {selected && <Check size={13} color={colors.fg.primary} />}
      </View>
      {icon && <View style={s.rowIcon}>{icon}</View>}
      <View style={s.rowText}>
        <Text style={[s.rowLabel, selected && s.rowLabelSelected]}>{label}</Text>
        {sublabel ? <Text style={s.rowSublabel}>{sublabel}</Text> : null}
      </View>
    </Pressable>
  );
}

// ----------------------------------------------------------
// Effort section content
// ----------------------------------------------------------

function EffortContent({ selection, providers, onSelect, onClose, s, colors }: {
  selection: ConfigSelection;
  providers: ProviderInfo[];
  onSelect: (s: ConfigSelection) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  const model = getCurrentModel(providers, selection);
  const options = model?.capabilities.reasoningEffortLevels ?? [];
  return (
    <>
      <Text style={s.sectionHeader}>Effort</Text>
      {options.map((opt) => (
        <MenuRow
          key={opt.value}
          label={opt.label}
          selected={selection.effort === opt.value}
          onPress={() => { onSelect({ ...selection, effort: opt.value }); onClose(); }}
          s={s}
          colors={colors}
        />
      ))}
    </>
  );
}

function ThinkingContent({ selection, onSelect, onClose, s, colors }: {
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <>
      <Text style={s.sectionHeader}>Thinking</Text>
      {([true, false] as const).map((val) => (
        <MenuRow
          key={String(val)}
          label={val ? 'On' : 'Off'}
          selected={selection.thinking === val}
          onPress={() => { onSelect({ ...selection, thinking: val }); onClose(); }}
          s={s}
          colors={colors}
        />
      ))}
    </>
  );
}

function FastModeContent({ selection, onSelect, onClose, s, colors }: {
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <>
      <Text style={s.sectionHeader}>Fast Mode</Text>
      {([false, true] as const).map((val) => (
        <MenuRow
          key={String(val)}
          label={val ? 'On' : 'Off'}
          selected={Boolean(selection.fastMode) === val}
          onPress={() => { onSelect({ ...selection, fastMode: val }); onClose(); }}
          s={s}
          colors={colors}
        />
      ))}
    </>
  );
}

function ContextWindowContent({ selection, providers, onSelect, onClose, s, colors }: {
  selection: ConfigSelection;
  providers: ProviderInfo[];
  onSelect: (s: ConfigSelection) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  const model = getCurrentModel(providers, selection);
  const options = model?.capabilities.contextWindowOptions ?? [];
  return (
    <>
      <Text style={s.sectionHeader}>Context Window</Text>
      {options.map((opt) => (
        <MenuRow
          key={opt.value}
          label={opt.label}
          selected={selection.contextWindow === opt.value}
          onPress={() => { onSelect({ ...selection, contextWindow: opt.value }); onClose(); }}
          s={s}
          colors={colors}
        />
      ))}
    </>
  );
}

// ----------------------------------------------------------
// Mode section content
// ----------------------------------------------------------

function ModeContent({ mode, onModeChange, onClose, s, colors }: {
  mode: InteractionMode;
  onModeChange: (m: InteractionMode) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <>
      <Text style={s.sectionHeader}>Mode</Text>
      <MenuRow label="Chat" selected={mode === 'default'} onPress={() => { onModeChange('default'); onClose(); }} s={s} colors={colors} />
      <MenuRow label="Plan" selected={mode === 'plan'} onPress={() => { onModeChange('plan'); onClose(); }} s={s} colors={colors} />
    </>
  );
}

// ----------------------------------------------------------
// Access section content
// ----------------------------------------------------------

const ACCESS_OPTIONS: Array<{ value: AccessLevel; label: string; sublabel: string; icon: (colors: Colors) => React.ReactNode }> = [
  {
    value: 'supervised',
    label: 'Supervised',
    sublabel: 'Ask before commands and file changes.',
    icon: (colors) => <Shield size={16} color={colors.fg.secondary} />,
  },
  {
    value: 'auto-accept',
    label: 'Auto-accept edits',
    sublabel: 'Auto-approve edits, ask before other actions.',
    icon: (colors) => <ShieldCheck size={16} color={colors.fg.secondary} />,
  },
  {
    value: 'full-access',
    label: 'Full access',
    sublabel: 'Allow commands and edits without prompts.',
    icon: (colors) => <ShieldOff size={16} color={colors.fg.secondary} />,
  },
];

function AccessContent({ accessLevel, onAccessChange, onClose, s, colors }: {
  accessLevel: AccessLevel;
  onAccessChange: (a: AccessLevel) => void;
  onClose: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <>
      {ACCESS_OPTIONS.map((opt) => (
        <MenuRow
          key={opt.value}
          label={opt.label}
          sublabel={opt.sublabel}
          icon={opt.icon(colors)}
          selected={accessLevel === opt.value}
          onPress={() => { onAccessChange(opt.value); onClose(); }}
          s={s}
          colors={colors}
        />
      ))}
    </>
  );
}

// ----------------------------------------------------------
// Providers list content
// ----------------------------------------------------------

function ProvidersContent({ providers, selection, onSelect, onShowModels, s, colors }: {
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onShowModels: () => void;
  s: PopoverStyles;
  colors: Colors;
}) {
  return (
    <>
      {providers.filter((p) => p.installed).map((p) => {
        const isSelected = p.provider === selection.provider;
        return (
          <Pressable
            key={p.provider}
            style={({ pressed }) => [s.row, pressed && s.rowPressed]}
            onPress={() => {
              if (!p.authenticated) return;
              const def = p.models.find((m) => m.isDefault) ?? p.models[0];
              if (def) onSelect(normalizeSelectionForModel({ ...selection, provider: p.provider }, def));
              onShowModels();
            }}
          >
            <ProviderIcon provider={p.provider} size={20} />
            <Text style={[s.rowLabel, isSelected && s.rowLabelSelected, { flex: 1 }]}>{p.name}</Text>
            {isSelected && <View style={s.activeDot} />}
            <ChevronRight size={14} color={colors.fg.muted} />
          </Pressable>
        );
      })}
      {providers.filter((p) => !p.installed).map((p) => (
        <View key={p.provider} style={s.row}>
          <ProviderIcon provider={p.provider} size={20} />
          <Text style={[s.rowLabel, s.rowLabelMuted, { flex: 1 }]}>{p.name}</Text>
          <Text style={s.comingSoon}>COMING SOON</Text>
        </View>
      ))}
      {COMING_SOON_PROVIDERS.map((p) => (
        <View key={p.key} style={s.row}>
          <View style={{ width: 20, height: 20, borderRadius: 6, backgroundColor: p.color, opacity: 0.35, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ fontSize: 11, fontWeight: '700', color: colors.fg.onAccent }}>{p.name[0]}</Text>
            </View>
          <Text style={[s.rowLabel, s.rowLabelMuted, { flex: 1 }]}>{p.name}</Text>
          <Text style={s.comingSoon}>COMING SOON</Text>
        </View>
      ))}
    </>
  );
}

// ----------------------------------------------------------
// Models list content
// ----------------------------------------------------------

function ModelsContent({ providers, selection, onSelect, onBack, providerLocked, s, colors }: {
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onBack: () => void;
  providerLocked?: boolean;
  s: PopoverStyles;
  colors: Colors;
}) {
  const provider = providers.find((p) => p.provider === selection.provider);
  return (
    <>
      {providerLocked ? (
        <View style={s.backRow}>
          {provider && <ProviderIcon provider={provider.provider} size={18} />}
          <Text style={s.backLabel}>{provider?.name ?? 'Provider'}</Text>
          <Text style={s.lockedBadge}>LOCKED</Text>
        </View>
      ) : (
        <Pressable style={s.backRow} onPress={onBack}>
          <ChevronLeft size={15} color={colors.fg.secondary} />
          {provider && <ProviderIcon provider={provider.provider} size={18} />}
          <Text style={s.backLabel}>{provider?.name ?? 'Provider'}</Text>
        </Pressable>
      )}
      <View style={s.divider} />
      {(provider?.models ?? []).map((model) => (
        <MenuRow
          key={model.id}
          label={model.name}
          selected={model.id === selection.modelId}
          onPress={() => onSelect(normalizeSelectionForModel(selection, model))}
          s={s}
          colors={colors}
        />
      ))}
      <View style={{ height: spacing[2] }} />
    </>
  );
}

// ----------------------------------------------------------
// ModelPopover root
// ----------------------------------------------------------

export function ModelPopover({
  visible,
  section,
  onClose,
  providers,
  selection,
  onSelect,
  providerLocked = false,
  mode,
  onModeChange,
  accessLevel,
  onAccessChange,
}: ModelPopoverProps) {
  const { colors } = useTheme();
  const s = useMemo(() => createPopoverStyles(colors), [colors]);
  const [view, setView] = useState<'providers' | 'models'>('providers');

  useEffect(() => {
    if (visible) {
      setView(section === 'models' ? 'models' : 'providers');
    }
  }, [visible, section]);

  if (!visible) return null;

  const isQuick =
    section === 'effort' ||
    section === 'thinking' ||
    section === 'fastMode' ||
    section === 'contextWindow' ||
    section === 'mode' ||
    section === 'access';

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={isQuick ? s.quickOverlay : s.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={isQuick ? s.quickBox : s.sheetBox}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {section === 'effort' && (
              <EffortContent selection={selection} providers={providers} onSelect={onSelect} onClose={onClose} s={s} colors={colors} />
            )}
            {section === 'thinking' && (
              <ThinkingContent selection={selection} onSelect={onSelect} onClose={onClose} s={s} colors={colors} />
            )}
            {section === 'fastMode' && (
              <FastModeContent selection={selection} onSelect={onSelect} onClose={onClose} s={s} colors={colors} />
            )}
            {section === 'contextWindow' && (
              <ContextWindowContent selection={selection} providers={providers} onSelect={onSelect} onClose={onClose} s={s} colors={colors} />
            )}
            {section === 'mode' && (
              <ModeContent mode={mode} onModeChange={onModeChange} onClose={onClose} s={s} colors={colors} />
            )}
            {section === 'access' && (
              <AccessContent accessLevel={accessLevel} onAccessChange={onAccessChange} onClose={onClose} s={s} colors={colors} />
            )}
            {(section === 'providers' || section === 'models') && (
              view === 'providers' ? (
                <ProvidersContent
                  providers={providers}
                  selection={selection}
                  onSelect={onSelect}
                  onShowModels={() => setView('models')}
                  s={s}
                  colors={colors}
                />
              ) : (
                <ModelsContent
                  providers={providers}
                  selection={selection}
                  onSelect={onSelect}
                  providerLocked={providerLocked}
                  onBack={() => setView('providers')}
                  s={s}
                  colors={colors}
                />
              )
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// Styles computed dynamically via createPopoverStyles — see factory above.
