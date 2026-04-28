// ============================================================
// SettingsScreen — App and server settings
// ============================================================
// WHAT: Per-server connection management, theme picker, plugin settings, app info.
// WHY:  Phase 7a replaces the savedConnections[0] singleton with a list of all
//       servers — each with its own status, disconnect, and forget buttons.
//       Phase 10 adds theme switching (Light / Dark / System) and plugin settings.
// HOW:  Reads connectionsById from useConnectionStore; renders one section per
//       server using FlatList. Theme store drives the active palette.
// SEE:  apps/mobile/src/stores/connection.ts, apps/mobile/src/stores/theme-store.ts

import React, { useCallback, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Pressable,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from './types';
import {
  ArrowLeft,
  Server,
  Wifi,
  WifiOff,
  Trash2,
  Info,
  ChevronDown,
  ChevronRight,
  Sun,
  Moon,
  Monitor,
} from 'lucide-react-native';
import { useConnectionStore, type PerServerConnection } from '../stores/connection';
import { usePluginRegistry } from '../stores/plugin-registry';
import { useThemeStore, type ThemeMode } from '../stores/theme-store';
import { useAppPreferencesStore } from '../stores/app-preferences-store';
import { SettingsRenderer } from '../components/SettingsRenderer';
import { useTheme } from '../theme';
import { typography, spacing, radii } from '../theme';

// ----------------------------------------------------------
// Section + Row components (theme-aware)
// ----------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    container: { marginBottom: spacing[6] },
    title: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.tertiary,
      textTransform: 'uppercase',
      letterSpacing: 1,
      marginBottom: spacing[2],
      paddingHorizontal: spacing[4],
    },
    content: {
      backgroundColor: colors.bg.raised,
      borderRadius: radii.lg,
      marginHorizontal: spacing[4],
      overflow: 'hidden',
    },
  }), [colors]);

  return (
    <View style={s.container}>
      <Text style={s.title}>{title}</Text>
      <View style={s.content}>{children}</View>
    </View>
  );
}

interface RowProps {
  label: string;
  value?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  danger?: boolean;
  rightElement?: React.ReactNode;
  last?: boolean;
}

function Row({ label, value, icon, onPress, danger, rightElement, last }: RowProps) {
  const { colors } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    container: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      minHeight: 48,
      gap: spacing[3],
    },
    withBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    iconWrap: { width: 28, alignItems: 'center' },
    textWrap: { flex: 1 },
    label: {
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
      fontWeight: typography.fontWeight.regular,
    },
    dangerLabel: { color: colors.semantic.error },
    value: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.tertiary,
      marginTop: 2,
      fontFamily: typography.fontFamily.mono,
    },
  }), [colors]);

  const content = (
    <View style={[s.container, !last && s.withBorder]}>
      {icon && <View style={s.iconWrap}>{icon}</View>}
      <View style={s.textWrap}>
        <Text style={[s.label, danger && s.dangerLabel]}>{label}</Text>
        {value !== undefined && <Text style={s.value} numberOfLines={1}>{value}</Text>}
      </View>
      {rightElement}
    </View>
  );

  if (onPress) {
    return (
      <Pressable onPress={onPress} android_ripple={{ color: colors.bg.active }}>
        {content}
      </Pressable>
    );
  }
  return content;
}

// ----------------------------------------------------------
// ThemePickerSection — Light / Dark / System
// ----------------------------------------------------------

const THEME_OPTIONS: Array<{ value: ThemeMode; label: string; Icon: React.ComponentType<{ size?: number; color?: string }> }> = [
  { value: 'light',  label: 'Light',  Icon: Sun },
  { value: 'dark',   label: 'Dark',   Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
];

function ThemePickerSection() {
  const { colors } = useTheme();
  const currentMode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  const s = useMemo(() => StyleSheet.create({
    option: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      minHeight: 48,
      gap: spacing[3],
    },
    withBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    label: {
      flex: 1,
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
    },
    labelActive: { color: colors.accent.primary, fontWeight: typography.fontWeight.semibold },
    dot: {
      width: 18, height: 18, borderRadius: 9,
      borderWidth: 2, borderColor: colors.fg.muted,
      alignItems: 'center', justifyContent: 'center',
    },
    dotFill: {
      width: 9, height: 9, borderRadius: 4.5,
      backgroundColor: colors.accent.primary,
    },
  }), [colors]);

  return (
    <Section title="Appearance">
      {THEME_OPTIONS.map(({ value, label, Icon }, i) => {
        const isSelected = currentMode === value;
        const isLast = i === THEME_OPTIONS.length - 1;
        return (
          <Pressable
            key={value}
            style={[s.option, !isLast && s.withBorder]}
            onPress={() => setMode(value)}
            android_ripple={{ color: colors.bg.active }}
          >
            <Icon size={16} color={isSelected ? colors.accent.primary : colors.fg.muted} />
            <Text style={[s.label, isSelected && s.labelActive]}>{label}</Text>
            <View style={s.dot}>
              {isSelected && <View style={s.dotFill} />}
            </View>
          </Pressable>
        );
      })}
    </Section>
  );
}

// ----------------------------------------------------------
// HapticsSection — toggle app-wide haptic feedback
// ----------------------------------------------------------

function HapticsSection() {
  const { colors } = useTheme();
  const enabled = useAppPreferencesStore((s) => s.haptics);
  const setEnabled = useAppPreferencesStore((s) => s.setHaptics);

  const s = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      minHeight: 48,
    },
    label: {
      flex: 1,
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
    },
    toggle: {
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[1],
      borderRadius: radii.full,
      backgroundColor: enabled ? colors.accent.primary : colors.bg.input,
    },
    toggleText: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: enabled ? colors.fg.onAccent : colors.fg.secondary,
    },
  }), [colors, enabled]);

  return (
    <Section title="Feedback">
      <Pressable style={s.row} onPress={() => setEnabled(!enabled)} accessibilityRole="switch" accessibilityState={{ checked: enabled }}>
        <Text style={s.label}>Haptic feedback</Text>
        <View style={s.toggle}>
          <Text style={s.toggleText}>{enabled ? 'On' : 'Off'}</Text>
        </View>
      </Pressable>
    </Section>
  );
}

// ----------------------------------------------------------
// ServerSection — one section per connected or saved server
// ----------------------------------------------------------

function ServerSection({ conn }: { conn: PerServerConnection }) {
  const { colors } = useTheme();
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const isConnected = conn.clientState === 'connected';

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect',
      `Disconnect from "${conn.savedConnection.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Disconnect', style: 'destructive', onPress: () => disconnectServer(conn.serverId) },
      ],
    );
  }, [conn.serverId, conn.savedConnection.name, disconnectServer]);

  const handleForget = useCallback(() => {
    Alert.alert(
      'Remove Server',
      `Remove "${conn.savedConnection.name}" from saved servers?`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => forgetServer(conn.serverId) },
      ],
    );
  }, [conn.serverId, conn.savedConnection.name, forgetServer]);

  return (
    <Section title={conn.savedConnection.name}>
      <Row
        icon={<Server size={16} color={isConnected ? colors.accent.primary : colors.fg.muted} />}
        label={`${conn.savedConnection.host}:${conn.savedConnection.port}`}
        value={conn.clientState}
        last={false}
      />
      <Row
        icon={
          isConnected
            ? <Wifi size={16} color={colors.semantic.success} />
            : <WifiOff size={16} color={colors.fg.muted} />
        }
        label={isConnected ? 'Connected' : conn.error ?? conn.clientState}
        last={!isConnected}
      />
      {isConnected && (
        <Row label="Disconnect" danger onPress={handleDisconnect} last={false} />
      )}
      <Row
        label="Remove Server"
        danger
        onPress={handleForget}
        rightElement={<Trash2 size={16} color={colors.semantic.error} />}
        last
      />
    </Section>
  );
}

// ----------------------------------------------------------
// PluginSettingsBlock — auto-generated plugin settings
// ----------------------------------------------------------

function PluginSettingsBlock() {
  const { colors } = useTheme();
  const definitions = usePluginRegistry((s) => s.definitions);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const rowBase = useMemo(() => StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      minHeight: 48,
      gap: spacing[3],
    },
    withBorder: {
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    label: {
      flex: 1,
      fontSize: typography.fontSize.base,
      color: colors.fg.primary,
    },
    rendererWrap: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.divider,
    },
  }), [colors]);

  const pluginsWithSettings = Object.values(definitions).filter(
    (d) => d.settings && d.settings.sections.length > 0,
  );

  if (pluginsWithSettings.length === 0) return null;

  return (
    <Section title="Plugin Settings">
      {pluginsWithSettings.map((plugin, i) => {
        const isExpanded = expanded[plugin.id] ?? false;
        const isLast = i === pluginsWithSettings.length - 1;
        return (
          <View key={plugin.id}>
            <Pressable
              onPress={() => setExpanded((prev) => ({ ...prev, [plugin.id]: !prev[plugin.id] }))}
              android_ripple={{ color: colors.bg.active }}
            >
              <View style={[rowBase.row, !isLast && !isExpanded && rowBase.withBorder]}>
                <Text style={rowBase.label}>{plugin.name}</Text>
                {isExpanded
                  ? <ChevronDown size={16} color={colors.fg.muted} />
                  : <ChevronRight size={16} color={colors.fg.muted} />
                }
              </View>
            </Pressable>
            {isExpanded && (
              <View style={rowBase.rendererWrap}>
                <SettingsRenderer pluginId={plugin.id} schema={plugin.settings!} />
              </View>
            )}
          </View>
        );
      })}
    </Section>
  );
}

// ----------------------------------------------------------
// Main Screen
// ----------------------------------------------------------

export function SettingsScreen() {
  const { colors } = useTheme();
  const navigation = useNavigation<AppNavigation>();
  const connectionsById = useConnectionStore((s) => s.connectionsById);
  const connections = Object.values(connectionsById);

  const s = useMemo(() => StyleSheet.create({
    root: { flex: 1, backgroundColor: colors.bg.base },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[2],
      paddingVertical: spacing[3],
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    backButton: {
      width: 40, height: 40,
      alignItems: 'center', justifyContent: 'center',
      borderRadius: radii.md,
    },
    headerTitle: {
      flex: 1,
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
      textAlign: 'center',
    },
    scroll: { flex: 1 },
    scrollContent: { paddingBottom: spacing[10] },
    headerPad: { height: spacing[6] },
  }), [colors]);

  const handleBack = useCallback(() => navigation.goBack(), [navigation]);

  const ListFooter = (
    <>
      <ThemePickerSection />
      <HapticsSection />
      <PluginSettingsBlock />
      <Section title="About">
        <Row
          icon={<Info size={16} color={colors.fg.muted} />}
          label="Stavi"
          value="Mobile AI IDE"
          last
        />
      </Section>
    </>
  );

  return (
    <SafeAreaView style={s.root} edges={['top', 'bottom']}>
      <View style={s.header}>
        <Pressable style={s.backButton} onPress={handleBack} hitSlop={8}>
          <ArrowLeft size={22} color={colors.fg.primary} />
        </Pressable>
        <Text style={s.headerTitle}>Settings</Text>
        <View style={s.backButton} />
      </View>

      <FlatList
        style={s.scroll}
        contentContainerStyle={s.scrollContent}
        showsVerticalScrollIndicator={false}
        data={connections}
        keyExtractor={(item) => item.serverId}
        renderItem={({ item }) => <ServerSection conn={item} />}
        ListHeaderComponent={<View style={s.headerPad} />}
        ListEmptyComponent={
          <Section title="Servers">
            <Row
              icon={<WifiOff size={16} color={colors.fg.muted} />}
              label="No servers added"
              value="Go to Home to add a server"
              last
            />
          </Section>
        }
        ListFooterComponent={ListFooter}
      />
    </SafeAreaView>
  );
}
