// ============================================================
// SettingsScreen — App and server settings
// ============================================================
// Accessible from the drawer's bottom nav "Settings" button.
// Shows connection info, API key config, and app info.

import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
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
  ChevronRight,
} from 'lucide-react-native';
import { useConnectionStore } from '../stores/connection';
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
      {rightElement ?? (onPress && <ChevronRight size={16} color={colors.fg.muted} />)}
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
// Main Screen
// ----------------------------------------------------------

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const activeConnection = savedConnections[0] ?? null;
  const connectionState = activeConnection
    ? useConnectionStore.getState().getServerStatus(activeConnection.id)
    : 'disconnected';

  const isConnected = connectionState === 'connected';

  const handleBack = useCallback(() => {
    navigation.goBack();
  }, [navigation]);

  const handleDisconnect = useCallback(() => {
    Alert.alert(
      'Disconnect',
      'Disconnect from the current server?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: () => {
            if (activeConnection) {
              disconnectServer(activeConnection.id);
            }
            navigation.navigate('SessionsHome');
          },
        },
      ],
    );
  }, [activeConnection, disconnectServer, navigation]);

  const handleDeleteConnection = useCallback((id: string, name: string) => {
    Alert.alert(
      'Delete Connection',
      `Remove "${name}" from saved connections?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => forgetServer(id),
        },
      ],
    );
  }, [forgetServer]);

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

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Connection section */}
        <Section title="Current Connection">
          {activeConnection ? (
            <>
              <Row
                icon={<Server size={16} color={isConnected ? colors.accent.primary : colors.fg.muted} />}
                label={activeConnection.name}
                value={`${activeConnection.host}:${activeConnection.port}`}
                last={false}
              />
              <Row
                icon={
                  isConnected
                    ? <Wifi size={16} color={colors.semantic.success} />
                    : <WifiOff size={16} color={colors.fg.muted} />
                }
                label={isConnected ? 'Connected' : connectionState}
                last={isConnected}
              />
              {isConnected && (
                <Row
                  label="Disconnect"
                  danger
                  onPress={handleDisconnect}
                  last
                />
              )}
            </>
          ) : (
            <Row
              icon={<WifiOff size={16} color={colors.fg.muted} />}
              label="Not connected"
              value="Go to Servers to connect"
              last
            />
          )}
        </Section>

        {/* Saved connections */}
        {savedConnections.length > 0 && (
          <Section title="Saved Servers">
            {savedConnections.map((conn, idx) => (
              <Row
                key={conn.id}
                icon={<Server size={16} color={colors.fg.muted} />}
                label={conn.name}
                value={`${conn.host}:${conn.port}`}
                onPress={() => handleDeleteConnection(conn.id, conn.name)}
                rightElement={<Trash2 size={16} color={colors.semantic.error} />}
                last={idx === savedConnections.length - 1}
              />
            ))}
          </Section>
        )}

        {/* About section */}
        <Section title="About">
          <Row
            icon={<Info size={16} color={colors.fg.muted} />}
            label="Stavi"
            value="Mobile AI IDE"
            last
          />
        </Section>
      </ScrollView>
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
    paddingTop: spacing[6],
    paddingBottom: spacing[10],
  },
});
