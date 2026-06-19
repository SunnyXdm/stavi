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
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
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
import { AddServerSheet } from '../components/AddServerSheet';
import { WorkspaceCard, WORKSPACE_CARD_HEIGHT } from '../components/WorkspaceCard';
import { useConnectionStore } from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { useTheme } from '../theme';
import { spacing } from '../theme';
import { AnimatedPressable } from '../components/AnimatedPressable';
import { showActionMenu, showAlert, showConfirm } from '../components/sheets/AppSheets';
import { classifyConnectError } from '../utils/connect-errors';
import { useHaptics } from '../hooks/useHaptics';

const CARD_GAP = spacing[2];
const ITEM_HEIGHT = WORKSPACE_CARD_HEIGHT + CARD_GAP;

export function SessionsHomeScreen() {
  const navigation = useNavigation<AppNavigation>();
  const { colors, typography, radii } = useTheme();
  const haptics = useHaptics();

  const [showAddServer, setShowAddServer] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [toastServerId, setToastServerId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);

  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const autoConnectSavedServers = useConnectionStore((s) => s.autoConnectSavedServers);
  const connectionsById = useConnectionStore(useShallow((s) => s.connectionsById));
  const onReconnect = useConnectionStore((s) => s.onReconnect);
  const hasHydrated = useConnectionStore((s) => s.hasHydrated);
  const connectServer = useConnectionStore((s) => s.connectServer);
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const updateSavedConnection = useConnectionStore((s) => s.updateSavedConnection);

  const statusFor = useCallback(
    (serverId: string) => connectionsById[serverId]?.clientState ?? 'idle',
    [connectionsById],
  );

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
      .filter((c) => statusFor(c.id) === 'connected')
      .map((c) => refreshForServer(c.id).catch(() => {}));
    await Promise.all(promises);
    setRefreshing(false);
  }, [savedConnections, statusFor, refreshForServer, haptics]);

  // Long-press a server card → manage it (connect/disconnect, rename, remove)
  // via an in-app bottom sheet (consistent on iOS + Android).
  const handleServerLongPress = useCallback(async (serverId: string) => {
    const conn = savedConnections.find((c) => c.id === serverId);
    if (!conn) return;
    haptics.medium();
    const connected = statusFor(serverId) === 'connected';
    const choice = await showActionMenu({
      title: conn.name,
      options: [
        { key: 'toggle', label: connected ? 'Disconnect' : 'Reconnect' },
        { key: 'rename', label: 'Rename' },
        { key: 'remove', label: 'Remove', destructive: true },
      ],
    });
    if (choice === 'toggle') {
      if (connected) disconnectServer(serverId);
      else void connectServer(serverId).catch((err) => {
        const friendly = classifyConnectError(err, { host: conn.host, port: conn.port });
        void showAlert({ title: friendly.title, message: friendly.message });
      });
    } else if (choice === 'rename') {
      setRenameTarget({ id: serverId, name: conn.name });
    } else if (choice === 'remove') {
      const confirmed = await showConfirm({
        title: 'Remove server?',
        message: `"${conn.name}" will be removed from this app.`,
        confirmLabel: 'Remove',
        destructive: true,
      });
      if (confirmed) forgetServer(serverId);
    }
  }, [savedConnections, statusFor, haptics, connectServer, disconnectServer, forgetServer]);

  const handleSessionAction = useCallback(
    async (sessionId: string, method: 'session.archive' | 'session.delete') => {
      const owner = Object.entries(sessionsByServer).find(([, list]) =>
        list.some((s) => s.id === sessionId),
      );
      if (!owner) return;
      const [serverId] = owner;
      // Call-time read is correct here (event handler, not render).
      const client = useConnectionStore.getState().getClientForServer(serverId);
      if (!client) return;
      try {
        await client.request(method, { sessionId });
        await refreshForServer(serverId);
      } catch (err) {
        console.warn(`[sessions] ${method} failed:`, err);
      }
    },
    [sessionsByServer, refreshForServer],
  );

  const handleArchive = useCallback(
    (sessionId: string) => { void handleSessionAction(sessionId, 'session.archive'); },
    [handleSessionAction],
  );
  const handleDelete = useCallback(
    (sessionId: string) => { void handleSessionAction(sessionId, 'session.delete'); },
    [handleSessionAction],
  );

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
      const serverStatus = statusFor(item.serverId);
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
    [savedConnections, statusFor, handleArchive, handleDelete],
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
    serverRailContainer: { flexGrow: 0 },
    serverRail: {
      paddingHorizontal: spacing[4],
      paddingBottom: spacing[1],
      gap: spacing[2],
    },
    serverCard: {
      minWidth: 150,
      maxWidth: 230,
      paddingHorizontal: spacing[3],
      paddingVertical: spacing[3],
      borderRadius: radii.card,
      borderWidth: 1,
      gap: spacing[1],
    },
    serverCardRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    serverDot: { width: 8, height: 8, borderRadius: radii.full },
    serverName: {
      flexShrink: 1,
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
    },
    serverMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: spacing[2],
      marginLeft: spacing[2] + 8, // align under name past dot+gap
    },
    serverIp: {
      flexShrink: 1,
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
      fontFamily: typography.fontFamily.mono,
    },
    serverSessionCount: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.tertiary,
    },
    addServerCard: {
      alignSelf: 'stretch',
      justifyContent: 'center',
      alignItems: 'center',
      flexDirection: 'row',
      gap: spacing[1],
      paddingHorizontal: spacing[4],
      borderRadius: radii.card,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.divider,
    },
    addServerText: {
      fontSize: typography.fontSize.sm,
      fontWeight: typography.fontWeight.medium,
      color: colors.fg.tertiary,
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

  // -- Hydrating: don't flash the empty state before AsyncStorage loads --
  if (!hasHydrated) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Stavi</Text>
        </View>
        <View style={styles.noServerEmpty}>
          <ActivityIndicator color={colors.accent.primary} />
        </View>
      </SafeAreaView>
    );
  }

  // -- Empty: no servers at all --
  if (savedConnections.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Stavi</Text>
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
          <AnimatedPressable style={styles.primaryButton} onPress={() => setShowAddServer(true)} haptic="medium">
            <Text style={styles.primaryButtonText}>Add Server</Text>
          </AnimatedPressable>
        </View>
        <AddServerSheet visible={showAddServer} onClose={() => setShowAddServer(false)} onComplete={() => setShowAddServer(false)} />
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
        <Text style={styles.title}>Stavi</Text>
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
        // ScrollView defaults to flexGrow:1 — without this it splits leftover
        // vertical space with the sessions list, stretching the server cards.
        style={styles.serverRailContainer}
        contentContainerStyle={styles.serverRail}
      >
        {savedConnections.map((conn) => {
          const status = statusFor(conn.id);
          const isSelected = conn.id === effectiveServerId;
          const isOnline = status === 'connected' || status === 'connecting' || status === 'authenticating' || status === 'reconnecting';
          const isError = status === 'error';
          const dotColor = status === 'connected'
            ? colors.semantic.success
            : status === 'connecting' || status === 'authenticating' || status === 'reconnecting'
            ? colors.semantic.warning
            : isError
            ? colors.semantic.error
            : colors.fg.muted;
          // Prefer the user-editable name (defaults to hostname at add time);
          // fall back to the raw mDNS hostname. ".local" is noise on a card.
          const displayName = (conn.name || conn.hostname || conn.host).replace(/\.local$/, '');
          const sessionCount = (sessionsByServer[conn.id] ?? []).length;

          return (
            <Pressable
              key={conn.id}
              style={[
                styles.serverCard,
                {
                  backgroundColor: isSelected
                    ? (colors.accent.subtle ?? colors.bg.raised)
                    : colors.bg.raised,
                  borderColor: isSelected ? colors.accent.primary : colors.divider,
                  opacity: isOnline ? 1 : 0.6,
                },
              ]}
              onPress={() => {
                haptics.selection();
                setSelectedServerId(conn.id);
                // Offline/errored card: tapping is the natural "try again" —
                // the only reconnect affordance used to be an undiscoverable
                // long-press menu.
                if (!isOnline) {
                  void connectServer(conn.id).catch((err) => {
                    const friendly = classifyConnectError(err, { host: conn.host, port: conn.port });
                    void showAlert({ title: friendly.title, message: friendly.message });
                  });
                }
              }}
              onLongPress={() => handleServerLongPress(conn.id)}
              delayLongPress={350}
            >
              <View style={styles.serverCardRow}>
                <View style={[styles.serverDot, { backgroundColor: dotColor }]} />
                <Text style={styles.serverName} numberOfLines={1}>
                  {displayName}
                </Text>
              </View>
              <View style={styles.serverMetaRow}>
                <Text style={styles.serverIp} numberOfLines={1}>
                  {isOnline ? `${conn.host}:${conn.port}` : isError ? 'error — tap to retry' : 'offline — tap to connect'}
                </Text>
                {sessionCount > 0 ? (
                  <Text style={styles.serverSessionCount}>
                    · {sessionCount} {sessionCount === 1 ? 'session' : 'sessions'}
                  </Text>
                ) : null}
              </View>
            </Pressable>
          );
        })}

        {/* Add-server tile — without this, ServersSheet is unreachable once
            a first server exists. */}
        <Pressable
          style={styles.addServerCard}
          onPress={() => { haptics.light(); setShowAddServer(true); }}
          accessibilityLabel="Add server"
        >
          <Plus size={16} color={colors.fg.tertiary} strokeWidth={2} />
          <Text style={styles.addServerText}>Add server</Text>
        </Pressable>
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
            serverConnected={statusFor(effectiveServerId ?? '') === 'connected'}
            onNewSession={() => setShowNewSession(true)}
            onReconnect={effectiveServerId ? () => {
              const conn = savedConnections.find((c) => c.id === effectiveServerId);
              void connectServer(effectiveServerId).catch((err) => {
                const friendly = classifyConnectError(err, { host: conn?.host, port: conn?.port });
                void showAlert({ title: friendly.title, message: friendly.message });
              });
            } : undefined}
          />
        }
        keyboardShouldPersistTaps="handled"
      />

      <AddServerSheet visible={showAddServer} onClose={() => setShowAddServer(false)} onComplete={() => setShowAddServer(false)} />
      <NewSessionFlow
        visible={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreated={(session) => {
          setShowNewSession(false);
          navigation.navigate('Workspace', { sessionId: session.id });
        }}
      />

      <RenameServerModal
        target={renameTarget}
        onClose={() => setRenameTarget(null)}
        onSave={(id, name) => {
          updateSavedConnection(id, { name });
          setRenameTarget(null);
        }}
      />
    </SafeAreaView>
  );
}

function RenameServerModal({
  target,
  onClose,
  onSave,
}: {
  target: { id: string; name: string } | null;
  onClose: () => void;
  onSave: (id: string, name: string) => void;
}) {
  const { colors, typography, radii } = useTheme();
  const [value, setValue] = useState('');
  useEffect(() => { setValue(target?.name ?? ''); }, [target]);

  const s = useMemo(() => StyleSheet.create({
    backdrop: { flex: 1, backgroundColor: colors.bg.scrim, justifyContent: 'center', padding: spacing[6] },
    card: { backgroundColor: colors.bg.overlay, borderRadius: radii.lg, padding: spacing[4], gap: spacing[3] },
    title: { fontSize: typography.fontSize.lg, fontWeight: typography.fontWeight.semibold, color: colors.fg.primary },
    input: { backgroundColor: colors.bg.input, borderRadius: radii.md, paddingHorizontal: spacing[3], paddingVertical: spacing[3], color: colors.fg.primary, fontSize: typography.fontSize.base },
    row: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing[2] },
    btn: { paddingHorizontal: spacing[4], paddingVertical: spacing[2], borderRadius: radii.md },
    btnText: { fontSize: typography.fontSize.base, fontWeight: typography.fontWeight.medium, color: colors.fg.secondary },
    saveText: { color: colors.accent.primary, fontWeight: typography.fontWeight.semibold },
  }), [colors, typography, radii]);

  return (
    <Modal visible={!!target} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.card} onPress={(e) => e.stopPropagation()}>
          <Text style={s.title}>Rename server</Text>
          <TextInput
            style={s.input}
            value={value}
            onChangeText={setValue}
            placeholder="Server name"
            placeholderTextColor={colors.fg.muted}
            autoFocus
            selectTextOnFocus
          />
          <View style={s.row}>
            <Pressable style={s.btn} onPress={onClose}>
              <Text style={s.btnText}>Cancel</Text>
            </Pressable>
            <Pressable
              style={s.btn}
              onPress={() => { const v = value.trim(); if (target && v) onSave(target.id, v); }}
            >
              <Text style={[s.btnText, s.saveText]}>Save</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ItemSeparator() {
  return <View style={{ height: CARD_GAP }} />;
}

function NoSessionsEmpty({
  serverConnected,
  onNewSession,
  onReconnect,
}: {
  serverConnected: boolean;
  onNewSession: () => void;
  onReconnect?: () => void;
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
        {onReconnect && (
          <AnimatedPressable style={s.button} onPress={onReconnect} haptic="medium">
            <Text style={s.buttonText}>Reconnect</Text>
          </AnimatedPressable>
        )}
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
