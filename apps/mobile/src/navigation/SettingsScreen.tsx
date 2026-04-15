// ============================================================
// SettingsScreen — App and server settings
// ============================================================
// WHAT: Per-server connection management plus app info.
// WHY:  Phase 7a replaces the savedConnections[0] singleton with a list of all
//       servers — each with its own status, disconnect, and forget buttons.
// HOW:  Reads connectionsById from useConnectionStore; renders one section per
//       server using FlatList with a settings header via ListHeaderComponent.
// SEE:  apps/mobile/src/stores/connection.ts

import React, { useCallback } from 'react';
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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  ArrowLeft,
  Server,
  Wifi,
  WifiOff,
  Trash2,
  Info,
} from 'lucide-react-native';
import { useConnectionStore, type PerServerConnection } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';

// ----------------------------------------------------------
// Section + Row components
// ----------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={sectionStyles.container}>
      <Text style={sectionStyles.title}>{title}</Text>
      <View style={sectionStyles.content}>{children}</View>
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
  const content = (
    <View style={[rowStyles.container, !last && rowStyles.withBorder]}>
      {icon && <View style={rowStyles.iconWrap}>{icon}</View>}
      <View style={rowStyles.textWrap}>
        <Text style={[rowStyles.label, danger && rowStyles.dangerLabel]}>{label}</Text>
        {value !== undefined && <Text style={rowStyles.value} numberOfLines={1}>{value}</Text>}
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

const sectionStyles = StyleSheet.create({
  container: {
    marginBottom: spacing[6],
  },
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
});

const rowStyles = StyleSheet.create({
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
  iconWrap: {
    width: 28,
    alignItems: 'center',
  },
  textWrap: {
    flex: 1,
  },
  label: {
    fontSize: typography.fontSize.base,
    color: colors.fg.primary,
    fontWeight: typography.fontWeight.regular,
  },
  dangerLabel: {
    color: colors.semantic.error,
  },
  value: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.tertiary,
    marginTop: 2,
    fontFamily: typography.fontFamily.mono,
  },
});

// ----------------------------------------------------------
// ServerSection — one section per connected or saved server
// ----------------------------------------------------------

function ServerSection({ conn }: { conn: PerServerConnection }) {
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const isConnected = conn.clientState === 'connected';

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect',
      `Disconnect from "${conn.savedConnection.name}"?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => disconnectServer(conn.serverId),
        },
      ],
    );
  }, [conn.serverId, conn.savedConnection.name, disconnectServer]);

  const handleForget = useCallback(() => {
    Alert.alert(
      'Remove Server',
      `Remove "${conn.savedConnection.name}" from saved servers?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => forgetServer(conn.serverId),
        },
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
        <Row
          label="Disconnect"
          danger
          onPress={handleDisconnect}
          last={false}
        />
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
// Main Screen
// ----------------------------------------------------------

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const connectionsById = useConnectionStore((s) => s.connectionsById);
  const connections = Object.values(connectionsById);

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const ListHeader = (
    <View style={styles.headerPad} />
  );

  const ListFooter = (
    <Section title="About">
      <Row
        icon={<Info size={16} color={colors.fg.muted} />}
        label="Stavi"
        value="Mobile AI IDE"
        last
      />
    </Section>
  );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable style={styles.backButton} onPress={handleBack} hitSlop={8}>
          <ArrowLeft size={22} color={colors.fg.primary} />
        </Pressable>
        <Text style={styles.headerTitle}>Settings</Text>
        <View style={styles.backButton} />
      </View>

      <FlatList
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
        data={connections}
        keyExtractor={(item) => item.serverId}
        renderItem={({ item }) => <ServerSection conn={item} />}
        ListHeaderComponent={ListHeader}
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

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[2],
    paddingVertical: spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  backButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    textAlign: 'center',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: spacing[10],
  },
  headerPad: {
    height: spacing[6],
  },
});
