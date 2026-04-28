// WHAT: Sessions Home — redesigned with server rail + filtered session list.
// WHY:  New layout: horizontal server cards (hostname + IP, status dot) + vertical
//       session list filtered to the selected server.
// HOW:  selectedServerId state (defaults to first saved connection).
//       Server cards: horizontal ScrollView, tap to select.
//       Sessions: FlatList filtered by selectedServerId, backed by sessions-store.
// SEE:  components/WorkspaceCard.tsx, components/ServersSheet.tsx,
//       stores/sessions-store.ts, stores/connection.ts

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Settings, Server } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from './types';
import type { Session } from '@stavi/shared';
import { useShallow } from 'zustand/react/shallow';
import { NewSessionFlow } from '../components/NewSessionFlow';
import { ReconnectToast } from '../components/ReconnectToast';
import { ServersSheet } from '../components/ServersSheet';
import { WorkspaceCard, WORKSPACE_CARD_HEIGHT } from '../components/WorkspaceCard';
import { useConnectionStore } from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { useTheme } from '../theme';
import { spacing } from '../theme';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { useHaptics } from '../hooks/useHaptics';

const CARD_GAP = spacing[2];
const ITEM_HEIGHT = WORKSPACE_CARD_HEIGHT + CARD_GAP;

export function SessionsHomeScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { colors, typography, radii } = useTheme();
  const haptics = useHaptics();

  const [showServers, setShowServers] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [toastServerId, setToastServerId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const autoConnectSavedServers = useConnectionStore((s) => s.autoConnectSavedServers);
  const getStatusForServer = useConnectionStore((s) => s.getStatusForServer);
  const onReconnect = useConnectionStore((s) => s.onReconnect);

  const sessionsByServer = useSessionsStore(useShallow((s) => s.sessionsByServer));
  const refreshForServer = useSessionsStore((s) => s.refreshForServer);
  const hydrateConnectedServers = useSessionsStore((s) => s.hydrateConnectedServers);

  // Selected server — defaults to first saved connection
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const effectiveServerId = useMemo(() => {
    if (selectedServerId && savedConnections.some((c) => c.id === selectedServerId)) {
      return selectedServerId;
    }
    return savedConnections[0]?.id ?? null;
  }, [selectedServerId, savedConnections]);

  useEffect(() => { autoConnectSavedServers(); }, [autoConnectSavedServers]);
  useEffect(() => { hydrateConnectedServers(); }, [hydrateConnectedServers, savedConnections.length]);

  useEffect(() => {
    return onReconnect((serverId) => {
      setToastServerId(serverId);
      void refreshForServer(serverId).catch(() => {});
    });
  }, [onReconnect, refreshForServer]);

  // Sessions for the selected server, sorted by recency
  const selectedSessions = useMemo(() => {
    if (!effectiveServerId) return [];
    const sessions = sessionsByServer[effectiveServerId] ?? [];
    return [...sessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt);
  }, [sessionsByServer, effectiveServerId]);

  const handleRefresh = useCallback(async () => {
    haptics.light();
    setRefreshing(true);
    const promises = savedConnections
      .filter((c) => getStatusForServer(c.id) === 'connected')
      .map((c) => refreshForServer(c.id).catch(() => {}));
    await Promise.all(promises);
    setRefreshing(false);
  }, [savedConnections, getStatusForServer, refreshForServer, haptics]);

  const handleArchive = useCallback((_sessionId: string) => {}, []);
  const handleDelete = useCallback((_sessionId: string) => {}, []);

  const getItemLayout = useCallback(
    (_data: ArrayLike<Session> | null | undefined, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: Session }) => {
      const serverStatus = getStatusForServer(item.serverId);
      const serverConn = savedConnections.find((c) => c.id === item.serverId);
      return (
        <WorkspaceCard
          session={item}
          serverName={serverConn?.hostname ?? serverConn?.name ?? item.serverId}
          serverStatus={serverStatus}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      );
    },
    [savedConnections, getStatusForServer, handleArchive, handleDelete],
  );

  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.bg.base },

    // Header
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingTop: spacing[2],
      paddingBottom: spacing[1],
    },
    title: {
      flex: 1,
      fontSize: typography.fontSize['2xl'],
      fontWeight: typography.fontWeight.bold,
      color: colors.fg.primary,
      letterSpacing: -0.5,
    },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    iconButton: {
      width: 36, height: 36,
      borderRadius: radii.md,
      alignItems: 'center', justifyContent: 'center',
    },

    // Connections rail
    sectionLabel: {
      fontSize: typography.fontSize.xs,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.muted,
      letterSpacing: 1.2,
      paddingHorizontal: spacing[4],
      paddingTop: spacing[4],
      paddingBottom: spacing[2],
    },
    serverRail: {
      paddingHorizontal: spacing[4],
      paddingBottom: spacing[1],
      gap: spacing[3],
    },
    serverCard: {
      width: 180,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      borderRadius: radii.card,
      borderWidth: 1.5,
      gap: spacing[1],
    },
    serverCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    serverDot: { width: 8, height: 8, borderRadius: radii.full },
    serverName: {
      flex: 1,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    serverIp: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
      marginLeft: spacing[2] + 8, // align under name past dot+gap
    },
    serverStatus: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
    },

    // Sessions list
    listContent: {
      paddingHorizontal: spacing[4],
      paddingTop: spacing[1],
      paddingBottom: spacing[8],
      flexGrow: 1,
    },
    emptyContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingTop: spacing[16],
      gap: spacing[3],
    },
    emptyTitle: {
      fontSize: typography.fontSize.lg,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.secondary,
      textAlign: 'center',
    },
    emptySubtitle: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.muted,
      textAlign: 'center',
    },
    primaryButton: {
      marginTop: spacing[2],
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[3],
    },
    primaryButtonText: {
      color: colors.fg.onAccent,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
    },

    // No-server empty state
    noServerEmpty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      padding: spacing[6],
      gap: spacing[3],
    },
  }), [colors, typography, radii]);

  const toastConn = toastServerId
    ? savedConnections.find((c) => c.id === toastServerId)
    : null;

  // -- Empty: no servers at all --
  if (savedConnections.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Workspaces</Text>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
            <Settings size={18} color={colors.fg.secondary} />
          </Pressable>
        </View>
        <View style={styles.noServerEmpty}>
          <Server size={36} color={colors.fg.muted} />
          <Text style={[styles.emptyTitle, { fontSize: typography.fontSize.lg }]}>Add a server to get started</Text>
          <Text style={styles.emptySubtitle}>
            Connect to a local or remote Stavi daemon to see your workspaces.
          </Text>
          <AnimatedPressable style={styles.primaryButton} onPress={() => setShowServers(true)} haptic="medium">
            <Text style={styles.primaryButtonText}>Add Server</Text>
          </AnimatedPressable>
        </View>
        <ServersSheet visible={showServers} onClose={() => setShowServers(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {toastConn ? (
        <ReconnectToast serverName={toastConn.name} onDismiss={() => setToastServerId(null)} />
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Workspaces</Text>
        <View style={styles.headerActions}>
          <AnimatedPressable
            style={styles.iconButton}
            onPress={() => { haptics.light(); setShowNewSession(true); }}
            haptic="light"
            accessibilityLabel="New workspace"
          >
            <Plus size={22} color={colors.fg.primary} strokeWidth={2} />
          </AnimatedPressable>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
            <Settings size={20} color={colors.fg.secondary} />
          </Pressable>
        </View>
      </View>

      {/* Connections rail */}
      <Text style={styles.sectionLabel}>CONNECTIONS</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.serverRail}
      >
        {savedConnections.map((conn) => {
          const status = getStatusForServer(conn.id);
          const isSelected = conn.id === effectiveServerId;
          const isOnline = status === 'connected' || status === 'connecting' || status === 'authenticating' || status === 'reconnecting';
          const dotColor = status === 'connected'
            ? colors.semantic.success
            : status === 'connecting' || status === 'authenticating' || status === 'reconnecting'
            ? colors.semantic.warning
            : colors.fg.muted;

          return (
            <Pressable
              key={conn.id}
              style={[
                styles.serverCard,
                {
                  backgroundColor: isSelected ? colors.bg.raised : colors.bg.base,
                  borderColor: isSelected ? colors.accent.primary : colors.divider,
                },
              ]}
              onPress={() => {
                haptics.selection();
                setSelectedServerId(conn.id);
              }}
            >
              <View style={styles.serverCardRow}>
                <View style={[styles.serverDot, { backgroundColor: dotColor }]} />
                <Text style={styles.serverName} numberOfLines={1}>
                  {conn.hostname ?? conn.name}
                </Text>
              </View>
              <Text style={styles.serverIp} numberOfLines={1}>
                {isOnline ? conn.host : 'Offline'}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {/* Recent Sessions */}
      <Text style={styles.sectionLabel}>RECENT SESSIONS</Text>
      <FlatList
        data={selectedSessions}
        keyExtractor={(item) => item.id}
        renderItem={renderItem}
        getItemLayout={getItemLayout}
        contentContainerStyle={styles.listContent}
        ItemSeparatorComponent={ItemSeparator}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={colors.accent.primary}
          />
        }
        ListEmptyComponent={
          <NoSessionsEmpty
            serverConnected={getStatusForServer(effectiveServerId ?? '') === 'connected'}
            onNewSession={() => setShowNewSession(true)}
          />
        }
        keyboardShouldPersistTaps="handled"
      />

      <ServersSheet visible={showServers} onClose={() => setShowServers(false)} />
      <NewSessionFlow
        visible={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreated={(session) => {
          setShowNewSession(false);
          navigation.navigate('Workspace', { sessionId: session.id });
        }}
      />
    </SafeAreaView>
  );
}

function ItemSeparator() {
  return <View style={{ height: CARD_GAP }} />;
}

function NoSessionsEmpty({
  serverConnected,
  onNewSession,
}: {
  serverConnected: boolean;
  onNewSession: () => void;
}) {
  const { colors, typography, radii } = useTheme();
  const s = useMemo(() => StyleSheet.create({
    container: { flex: 1, alignItems: 'center', paddingTop: spacing[12], gap: spacing[3] },
    title: {
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.secondary,
      textAlign: 'center',
    },
    subtitle: { fontSize: typography.fontSize.sm, color: colors.fg.muted, textAlign: 'center', paddingHorizontal: spacing[8] },
    button: {
      marginTop: spacing[2],
      backgroundColor: colors.accent.primary,
      borderRadius: radii.md,
      paddingHorizontal: spacing[5],
      paddingVertical: spacing[3],
    },
    buttonText: {
      color: colors.fg.onAccent,
      fontSize: typography.fontSize.base,
      fontWeight: typography.fontWeight.semibold,
    },
  }), [colors, typography, radii]);

  if (!serverConnected) {
    return (
      <View style={s.container}>
        <Text style={s.title}>Server offline</Text>
        <Text style={s.subtitle}>Reconnect to see your workspaces.</Text>
      </View>
    );
  }

  return (
    <View style={s.container}>
      <Text style={s.title}>No workspaces yet</Text>
      <Text style={s.subtitle}>Tap + to create one and connect to your code.</Text>
      <AnimatedPressable style={s.button} onPress={onNewSession} haptic="medium">
        <Text style={s.buttonText}>New Workspace</Text>
      </AnimatedPressable>
    </View>
  );
}
