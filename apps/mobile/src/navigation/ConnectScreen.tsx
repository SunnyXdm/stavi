// ============================================================
// ConnectScreen — Server connection management
// ============================================================
// Initial screen shown on app launch. Lists saved connections,
// allows adding new servers, and connects to Stavi servers.
// Pings all saved servers on load to show online/offline status.

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Server, Plus, Wifi, WifiOff, Trash2, ChevronRight } from 'lucide-react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import { useConnectionStore, type SavedConnection } from '../stores/connection';
import { colors, typography, spacing, radii } from '../theme';
import { textStyles, surfaceStyles, layoutStyles, interactiveStyles } from '../theme/styles';
import { AddServerModal } from '../components/AddServerModal';
import { devConnectionConfig } from '../generated/dev-config';

// ----------------------------------------------------------
// Server ping helper
// ----------------------------------------------------------

type PingStatus = 'checking' | 'online' | 'offline';

async function pingServer(host: string, port: number, tls?: boolean): Promise<boolean> {
  const protocol = tls ? 'https' : 'http';
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const response = await fetch(`${protocol}://${host}:${port}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);
    return response.ok;
  } catch {
    clearTimeout(timeout);
    return false;
  }
}

// ----------------------------------------------------------
// ConnectScreen
// ----------------------------------------------------------

export function ConnectScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [showAddModal, setShowAddModal] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const connectionState = useConnectionStore((s) => s.state);
  const error = useConnectionStore((s) => s.error);
  const connect = useConnectionStore((s) => s.connect);
  const saveConnection = useConnectionStore((s) => s.saveConnection);
  const removeSavedConnection = useConnectionStore((s) => s.removeSavedConnection);

  // Server online/offline status
  const [pingStatuses, setPingStatuses] = useState<Record<string, PingStatus>>({});

  // Ping all servers on mount and when savedConnections changes
  useEffect(() => {
    if (savedConnections.length === 0) return;

    // Set all to 'checking'
    const initial: Record<string, PingStatus> = {};
    for (const conn of savedConnections) {
      initial[conn.id] = 'checking';
    }
    setPingStatuses(initial);

    // Ping all in parallel
    const promises = savedConnections.map(async (conn) => {
      const online = await pingServer(conn.host, conn.port, conn.tls);
      return { id: conn.id, status: online ? 'online' as const : 'offline' as const };
    });

    Promise.allSettled(promises).then((results) => {
      const updates: Record<string, PingStatus> = {};
      for (const result of results) {
        if (result.status === 'fulfilled') {
          updates[result.value.id] = result.value.status;
        }
      }
      setPingStatuses((prev) => ({ ...prev, ...updates }));
    });
  }, [savedConnections]);

  const generatedDevConnection = useMemo(() => {
    if (!__DEV__ || !devConnectionConfig) {
      return null;
    }

    return {
      name: devConnectionConfig.name,
      host: Platform.OS === 'android' ? devConnectionConfig.androidHost : devConnectionConfig.iosHost,
      port: devConnectionConfig.port,
      bearerToken: devConnectionConfig.bearerToken,
    };
  }, []);

  // Sort by lastConnectedAt descending, then createdAt descending
  const sortedConnections = [...savedConnections].sort((a, b) => {
    const aTime = a.lastConnectedAt ?? a.createdAt;
    const bTime = b.lastConnectedAt ?? b.createdAt;
    return bTime - aTime;
  });

  const handleConnect = useCallback(
    async (connection: SavedConnection) => {
      setConnectingId(connection.id);
      try {
        await connect(connection);
        navigation.navigate('Workspace');
      } catch (err) {
        Alert.alert(
          'Connection Failed',
          err instanceof Error ? err.message : 'Unable to connect to server',
          [{ text: 'OK' }],
        );
      } finally {
        setConnectingId(null);
      }
    },
    [connect, navigation],
  );

  const handleDelete = useCallback(
    (connection: SavedConnection) => {
      Alert.alert(
        'Remove Server',
        `Remove "${connection.name}"? You can add it back later.`,
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Remove',
            style: 'destructive',
            onPress: () => removeSavedConnection(connection.id),
          },
        ],
      );
    },
    [removeSavedConnection],
  );

  const handleAddComplete = useCallback(
    (connection: SavedConnection) => {
      setShowAddModal(false);
      // Auto-connect to the newly added server
      handleConnect(connection);
    },
    [handleConnect],
  );

  const handleConnectGenerated = useCallback(async () => {
    if (!generatedDevConnection) {
      return;
    }

    const existing = savedConnections.find(
      (connection) =>
        connection.host === generatedDevConnection.host &&
        connection.port === generatedDevConnection.port &&
        connection.bearerToken === generatedDevConnection.bearerToken,
    );

    const nextConnection = existing ?? saveConnection(generatedDevConnection);
    await handleConnect(nextConnection);
  }, [generatedDevConnection, handleConnect, saveConnection, savedConnections]);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.logoRow}>
            <View style={styles.logoDiamond}>
              <Server size={24} color={colors.accent.primary} />
            </View>
          </View>
          <Text style={styles.title}>Stavi</Text>
          <Text style={styles.subtitle}>Mobile IDE for AI Agents</Text>
        </View>

        {/* Saved connections */}
        {sortedConnections.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>SAVED SERVERS</Text>
            {sortedConnections.map((conn) => (
              <ConnectionCard
                key={conn.id}
                connection={conn}
                isConnecting={connectingId === conn.id}
                pingStatus={pingStatuses[conn.id]}
                onConnect={handleConnect}
                onDelete={handleDelete}
              />
            ))}
          </View>
        )}

        {generatedDevConnection && (
          <Pressable
            style={({ pressed }) => [
              styles.devButton,
              pressed && styles.devButtonPressed,
            ]}
            onPress={handleConnectGenerated}
          >
            <Wifi size={18} color={colors.bg.base} />
            <View style={styles.devButtonTextWrap}>
              <Text style={styles.devButtonTitle}>Connect to This Machine</Text>
              <Text style={styles.devButtonSubtitle}>
                {generatedDevConnection.host}:{generatedDevConnection.port}
              </Text>
            </View>
          </Pressable>
        )}

        {/* Add server button */}
        <Pressable
          style={({ pressed }) => [
            styles.addButton,
            pressed && styles.addButtonPressed,
          ]}
          onPress={() => setShowAddModal(true)}
        >
          <Plus size={20} color={colors.accent.primary} />
          <Text style={styles.addButtonText}>Add Server</Text>
        </Pressable>

        {/* Instructions */}
        <View style={styles.instructions}>
          <Text style={styles.instructionsTitle}>How to connect</Text>
          <View style={styles.step}>
            <Text style={styles.stepNumber}>1</Text>
            <Text style={styles.stepText}>
              Run <Text style={styles.code}>yarn dev</Text> on your machine
            </Text>
          </View>
          <View style={styles.step}>
            <Text style={styles.stepNumber}>2</Text>
            <Text style={styles.stepText}>
              Copy the address and token shown in your terminal
            </Text>
          </View>
          <View style={styles.step}>
            <Text style={styles.stepNumber}>3</Text>
            <Text style={styles.stepText}>
              Tap "Add Server" and paste them here
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* Add Server Modal */}
      <AddServerModal
        visible={showAddModal}
        onClose={() => setShowAddModal(false)}
        onComplete={handleAddComplete}
      />
    </SafeAreaView>
  );
}

// ----------------------------------------------------------
// ConnectionCard
// ----------------------------------------------------------

interface ConnectionCardProps {
  connection: SavedConnection;
  isConnecting: boolean;
  pingStatus?: PingStatus;
  onConnect: (conn: SavedConnection) => void;
  onDelete: (conn: SavedConnection) => void;
}

function ConnectionCard({
  connection,
  isConnecting,
  pingStatus,
  onConnect,
  onDelete,
}: ConnectionCardProps) {
  const lastConnected = connection.lastConnectedAt
    ? formatTimeAgo(connection.lastConnectedAt)
    : 'Never connected';

  const dotColor =
    pingStatus === 'online'
      ? colors.semantic.success
      : pingStatus === 'offline'
        ? colors.fg.muted
        : undefined;

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        pressed && !isConnecting && styles.cardPressed,
      ]}
      onPress={() => !isConnecting && onConnect(connection)}
      onLongPress={() => onDelete(connection)}
      disabled={isConnecting}
    >
      <View style={styles.cardContent}>
        <View style={styles.cardLeft}>
          <View style={styles.statusDot}>
            {isConnecting ? (
              <ActivityIndicator size="small" color={colors.accent.primary} />
            ) : pingStatus === 'checking' ? (
              <ActivityIndicator size={10} color={colors.fg.muted} />
            ) : (
              <View
                style={[
                  styles.dot,
                  { backgroundColor: dotColor ?? colors.fg.muted },
                ]}
              />
            )}
          </View>
          <View style={styles.cardText}>
            <Text style={styles.cardName} numberOfLines={1}>
              {connection.name}
            </Text>
            <Text style={styles.cardHost} numberOfLines={1}>
              {connection.host}:{connection.port} · {lastConnected}
              {pingStatus === 'online' ? ' · Online' : ''}
            </Text>
          </View>
        </View>
        <ChevronRight size={18} color={colors.fg.muted} />
      </View>
    </Pressable>
  );
}

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function formatTimeAgo(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[10],
    paddingBottom: spacing[8],
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: spacing[10],
  },
  logoRow: {
    marginBottom: spacing[4],
  },
  logoDiamond: {
    width: 56,
    height: 56,
    borderRadius: radii.lg,
    backgroundColor: colors.accent.subtle,
    alignItems: 'center',
    justifyContent: 'center',
    transform: [{ rotate: '45deg' }],
  },
  title: {
    fontSize: typography.fontSize['3xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
    letterSpacing: typography.letterSpacing.tight,
    marginBottom: spacing[1],
  },
  subtitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.tertiary,
  },

  // Section
  section: {
    marginBottom: spacing[6],
  },
  sectionLabel: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.tertiary,
    letterSpacing: typography.letterSpacing.wider,
    textTransform: 'uppercase',
    marginBottom: spacing[2],
    marginLeft: spacing[1],
  },

  // Connection card
  card: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
  },
  cardPressed: {
    backgroundColor: colors.bg.active,
  },
  cardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  statusDot: {
    width: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing[3],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  cardText: {
    flex: 1,
  },
  cardName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.primary,
    marginBottom: 2,
  },
  cardHost: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.tertiary,
    fontFamily: typography.fontFamily.mono,
  },

  // Add button
  addButton: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    marginBottom: spacing[10],
  },
  addButtonPressed: {
    backgroundColor: colors.bg.active,
  },
  devButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.lg,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[4],
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[3],
    marginBottom: spacing[3],
  },
  devButtonPressed: {
    opacity: 0.9,
  },
  devButtonTextWrap: {
    flex: 1,
  },
  devButtonTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.bg.base,
  },
  devButtonSubtitle: {
    fontSize: typography.fontSize.xs,
    color: colors.bg.base,
    opacity: 0.78,
    marginTop: 2,
    fontFamily: typography.fontFamily.mono,
  },
  addButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.medium,
    color: colors.accent.primary,
  },

  // Instructions
  instructions: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[4],
  },
  instructionsTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
    marginBottom: spacing[3],
  },
  step: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: spacing[3],
  },
  stepNumber: {
    width: 22,
    height: 22,
    borderRadius: radii.full,
    backgroundColor: colors.accent.subtle,
    color: colors.accent.primary,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.bold,
    textAlign: 'center',
    lineHeight: 22,
    marginRight: spacing[3],
    overflow: 'hidden',
  },
  stepText: {
    flex: 1,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.regular,
    color: colors.fg.secondary,
    lineHeight: typography.fontSize.sm * typography.lineHeight.normal,
  },
  code: {
    fontFamily: typography.fontFamily.mono,
    fontSize: typography.fontSize.xs,
    color: colors.accent.primary,
    backgroundColor: colors.bg.input,
  },
});
