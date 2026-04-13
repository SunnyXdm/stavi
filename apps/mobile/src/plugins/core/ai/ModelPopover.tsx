// ============================================================
// ModelPopover — contextual floating popover above the toolbar
// ============================================================
// Two rendering modes:
//   Quick sections (effort, mode, access): small floating box above composer
//   Selection sections (providers, models): bottom sheet

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Modal,
} from 'react-native';
import { Check, ChevronRight, ChevronLeft, Shield, ShieldCheck, ShieldOff } from 'lucide-react-native';
import { colors, typography, spacing, radii } from '../../../theme';
import type { ProviderInfo, ConfigSelection } from './ConfigSheet';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export type PopoverSection = 'providers' | 'models' | 'effort' | 'mode' | 'access';

export type InteractionMode = 'default' | 'plan';
export type AccessLevel = 'supervised' | 'auto-accept' | 'full-access';

export interface ModelPopoverProps {
  visible: boolean;
  section: PopoverSection;
  onClose: () => void;
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  mode: InteractionMode;
  onModeChange: (m: InteractionMode) => void;
  accessLevel: AccessLevel;
  onAccessChange: (a: AccessLevel) => void;
}

// ----------------------------------------------------------
// Provider metadata + icon
// ----------------------------------------------------------

const PROVIDER_META: Record<string, { color: string; initial: string }> = {
  claude: { color: '#c96442', initial: 'A' },
  codex:  { color: '#10a37f', initial: 'O' },
};

const COMING_SOON_PROVIDERS = [
  { key: 'cursor',   name: 'Cursor',   color: '#6B6B6B' },
  { key: 'opencode', name: 'OpenCode', color: '#F97316' },
  { key: 'gemini',   name: 'Gemini',   color: '#4285F4' },
];

export function ProviderIcon({ provider, size = 20 }: { provider: string; size?: number }) {
  const meta = PROVIDER_META[provider];
  const bg = meta?.color ?? colors.bg.active;
  const initial = meta?.initial ?? provider.charAt(0).toUpperCase();
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.28, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ fontSize: size * 0.58, fontWeight: '700', color: '#fff', lineHeight: size }}>
        {initial}
      </Text>
    </View>
  );
}

// ----------------------------------------------------------
// Shared row component
// ----------------------------------------------------------

function MenuRow({
  label,
  sublabel,
  icon,
  selected,
  onPress,
}: {
  label: string;
  sublabel?: string;
  icon?: React.ReactNode;
  selected?: boolean;
  onPress?: () => void;
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

const EFFORT_OPTIONS: Array<{ value: ConfigSelection['effort']; label: string }> = [
  { value: 'max',    label: 'Extra High' },
  { value: 'high',   label: 'High (default)' },
  { value: 'medium', label: 'Medium' },
  { value: 'low',    label: 'Low' },
];

function EffortContent({ selection, onSelect, onClose }: {
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onClose: () => void;
}) {
  return (
    <>
      <Text style={s.sectionHeader}>Effort</Text>
      {EFFORT_OPTIONS.map((opt) => (
        <MenuRow
          key={opt.value}
          label={opt.label}
          selected={selection.effort === opt.value}
          onPress={() => { onSelect({ ...selection, effort: opt.value }); onClose(); }}
        />
      ))}
      <View style={s.divider} />
      <Text style={s.sectionHeader}>Fast Mode</Text>
      {([false, true] as const).map((val) => (
        <MenuRow
          key={String(val)}
          label={val ? 'on' : 'off'}
          selected={val === false ? !selection.thinking : selection.thinking}
          onPress={() => { onSelect({ ...selection, thinking: val }); onClose(); }}
        />
      ))}
    </>
  );
}

// ----------------------------------------------------------
// Mode section content
// ----------------------------------------------------------

function ModeContent({ mode, onModeChange, onClose }: {
  mode: InteractionMode;
  onModeChange: (m: InteractionMode) => void;
  onClose: () => void;
}) {
  return (
    <>
      <Text style={s.sectionHeader}>Mode</Text>
      <MenuRow label="Chat" selected={mode === 'default'} onPress={() => { onModeChange('default'); onClose(); }} />
      <MenuRow label="Plan" selected={mode === 'plan'} onPress={() => { onModeChange('plan'); onClose(); }} />
    </>
  );
}

// ----------------------------------------------------------
// Access section content
// ----------------------------------------------------------

const ACCESS_OPTIONS: Array<{ value: AccessLevel; label: string; sublabel: string; icon: React.ReactNode }> = [
  {
    value: 'supervised',
    label: 'Supervised',
    sublabel: 'Ask before commands and file changes.',
    icon: <Shield size={16} color={colors.fg.secondary} />,
  },
  {
    value: 'auto-accept',
    label: 'Auto-accept edits',
    sublabel: 'Auto-approve edits, ask before other actions.',
    icon: <ShieldCheck size={16} color={colors.fg.secondary} />,
  },
  {
    value: 'full-access',
    label: 'Full access',
    sublabel: 'Allow commands and edits without prompts.',
    icon: <ShieldOff size={16} color={colors.fg.secondary} />,
  },
];

function AccessContent({ accessLevel, onAccessChange, onClose }: {
  accessLevel: AccessLevel;
  onAccessChange: (a: AccessLevel) => void;
  onClose: () => void;
}) {
  return (
    <>
      {ACCESS_OPTIONS.map((opt) => (
        <MenuRow
          key={opt.value}
          label={opt.label}
          sublabel={opt.sublabel}
          icon={opt.icon}
          selected={accessLevel === opt.value}
          onPress={() => { onAccessChange(opt.value); onClose(); }}
        />
      ))}
    </>
  );
}

// ----------------------------------------------------------
// Providers list content
// ----------------------------------------------------------

function ProvidersContent({ providers, selection, onSelect, onShowModels }: {
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onShowModels: () => void;
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
              if (def) onSelect({ ...selection, provider: p.provider, modelId: def.id, modelName: def.name, thinking: def.supportsThinking ?? selection.thinking });
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
            <Text style={{ fontSize: 11, fontWeight: '700', color: '#fff' }}>{p.name[0]}</Text>
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

function ModelsContent({ providers, selection, onSelect, onBack }: {
  providers: ProviderInfo[];
  selection: ConfigSelection;
  onSelect: (s: ConfigSelection) => void;
  onBack: () => void;
}) {
  const provider = providers.find((p) => p.provider === selection.provider);
  return (
    <>
      <Pressable style={s.backRow} onPress={onBack}>
        <ChevronLeft size={15} color={colors.fg.secondary} />
        {provider && <ProviderIcon provider={provider.provider} size={18} />}
        <Text style={s.backLabel}>{provider?.name ?? 'Provider'}</Text>
      </Pressable>
      <View style={s.divider} />
      {(provider?.models ?? []).map((model) => (
        <MenuRow
          key={model.id}
          label={model.name}
          selected={model.id === selection.modelId}
          onPress={() => onSelect({ ...selection, modelId: model.id, modelName: model.name, thinking: model.supportsThinking ?? selection.thinking })}
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
  mode,
  onModeChange,
  accessLevel,
  onAccessChange,
}: ModelPopoverProps) {
  const [view, setView] = useState<'providers' | 'models'>('providers');

  useEffect(() => {
    if (visible) {
      setView(section === 'models' ? 'models' : 'providers');
    }
  }, [visible, section]);

  if (!visible) return null;

  // Quick sections (effort/mode/access): small floating box above composer
  const isQuick = section === 'effort' || section === 'mode' || section === 'access';

  return (
    <Modal visible transparent animationType="none" onRequestClose={onClose}>
      <View style={isQuick ? s.quickOverlay : s.sheetOverlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />

        <View style={isQuick ? s.quickBox : s.sheetBox}>
          <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
            {section === 'effort' && (
              <EffortContent selection={selection} onSelect={onSelect} onClose={onClose} />
            )}
            {section === 'mode' && (
              <ModeContent mode={mode} onModeChange={onModeChange} onClose={onClose} />
            )}
            {section === 'access' && (
              <AccessContent accessLevel={accessLevel} onAccessChange={onAccessChange} onClose={onClose} />
            )}
            {(section === 'providers' || section === 'models') && (
              view === 'providers' ? (
                <ProvidersContent
                  providers={providers}
                  selection={selection}
                  onSelect={onSelect}
                  onShowModels={() => setView('models')}
                />
              ) : (
                <ModelsContent
                  providers={providers}
                  selection={selection}
                  onSelect={onSelect}
                  onBack={() => setView('providers')}
                />
              )
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const s = StyleSheet.create({
  // Quick popover (effort/mode/access) — floats above the toolbar
  quickOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
    paddingBottom: 90, // above the composer toolbar
    paddingHorizontal: spacing[3],
  },
  quickBox: {
    backgroundColor: colors.bg.overlay,
    borderRadius: radii.lg,
    maxHeight: 380,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 24,
  },

  // Bottom sheet (providers/models)
  sheetOverlay: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheetBox: {
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: '65%',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 20,
  },

  // Row
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[3],
    paddingVertical: 10,
    gap: spacing[2],
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  rowCheck: {
    width: 18,
    alignItems: 'center',
  },
  rowIcon: {
    width: 22,
    alignItems: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowLabel: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    fontWeight: typography.fontWeight.medium,
  },
  rowLabelSelected: {
    color: colors.fg.primary,
  },
  rowLabelMuted: {
    color: colors.fg.muted,
  },
  rowSublabel: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    lineHeight: 16,
  },

  // Section header
  sectionHeader: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: spacing[3],
    paddingTop: spacing[2],
    paddingBottom: 4,
  },

  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },

  // Back row (models view)
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingHorizontal: spacing[3],
    paddingVertical: 12,
  },
  backLabel: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },

  // Provider list
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent.primary,
  },
  comingSoon: {
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.muted,
    letterSpacing: 0.3,
  },
});
