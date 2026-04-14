// WHAT: Sessions Home root screen — lists sessions grouped by server.
// WHY:  Phase 2 entry point. Phase 5 adds collapse toggle, connection menu,
//       reconnect toast, and serverId-based ordering (insertion order).
// HOW:  Reads connection + sessions stores. Server sections extracted to
//       SessionsHomeServerSection for line-count compliance.
// SEE:  components/SessionsHomeServerSection.tsx, stores/connection.ts

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FolderPlus, Plus, Server, Settings } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AddServerSheet } from '../components/AddServerSheet';
import { NewSessionFlow } from '../components/NewSessionFlow';
import { ReconnectToast } from '../components/ReconnectToast';
import { ServerToolsSheet } from '../components/ServerToolsSheet';
import { ServerSection as SessionsHomeServerSection } from '../components/SessionsHomeServerSection';
import {
  useConnectionStore,
  type ConnectionState,
  type SavedConnection,
} from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { colors, radii, spacing, typography } from '../theme';

export function SessionsHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [showAddServer, setShowAddServer] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [toolsServerId, setToolsServerId] = useState<string | null>(null);
  const [collapsedIds, setCollapsedIds] = useState<Record<string, boolean>>({});
  const [toastServerId, setToastServerId] = useState<string | null>(null);

  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const connectServer = useConnectionStore((s) => s.connectServer);
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const autoConnectSavedServers = useConnectionStore((s) => s.autoConnectSavedServers);
  const getStatusForServer = useConnectionStore((s) => s.getStatusForServer);
  const onReconnect = useConnectionStore((s) => s.onReconnect);

  const getSessionsForServer = useSessionsStore((s) => s.getSessionsForServer);
  const refreshForServer = useSessionsStore((s) => s.refreshForServer);
  const hydrateConnectedServers = useSessionsStore((s) => s.hydrateConnectedServers);
  const errorByServer = useSessionsStore((s) => s.errorByServer);
  const isLoadingByServer = useSessionsStore((s) => s.isLoadingByServer);

  useEffect(() => { autoConnectSavedServers(); }, [autoConnectSavedServers]);
  useEffect(() => {
    hydrateConnectedServers();
  }, [hydrateConnectedServers, savedConnections.length]);

  // Reconnect toast + re-subscribe sessions on reconnect.
  useEffect(() => {
    return onReconnect((serverId) => {
      setToastServerId(serverId);
      void refreshForServer(serverId).catch(() => {});
      const t = setTimeout(() => setToastServerId(null), 3500);
      return () => clearTimeout(t);
    });
  }, [onReconnect, refreshForServer]);

  const sections = useMemo(
    () =>
      savedConnections.map((conn) => ({
        savedConnection: conn,
        status: getStatusForServer(conn.id),
        sessions: getSessionsForServer(conn.id),
        error: errorByServer[conn.id],
        loading: isLoadingByServer[conn.id] ?? false,
      })),
    [errorByServer, getSessionsForServer, getStatusForServer, isLoadingByServer, savedConnections],
  );

  const handleRefresh = useCallback(async () => {
    const connected = sections.filter((s) => s.status === 'connected');
    await Promise.all(connected.map((s) => refreshForServer(s.savedConnection.id)));
  }, [sections, refreshForServer]);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => ({ ...prev, [id]: !prev[id] }));
  }, []);

  const openConnectionMenu = useCallback(
    (conn: SavedConnection, status: ConnectionState) => {
      const isConnected = status === 'connected';
      const actionLabel = isConnected ? 'Disconnect' : 'Connect';
      const options = [actionLabel, 'Forget Server', 'Cancel'];

      const handle = (label: string) => {
        if (label === 'Disconnect') disconnectServer(conn.id);
        if (label === 'Connect') void connectServer(conn.id).catch(() => {});
        if (label === 'Forget Server')
          Alert.alert('Forget server?', `Remove "${conn.name}"?`, [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Forget', style: 'destructive', onPress: () => forgetServer(conn.id) },
          ]);
      };

      if (Platform.OS === 'ios') {
        ActionSheetIOS.showActionSheetWithOptions(
          { options, destructiveButtonIndex: 1, cancelButtonIndex: 2, title: conn.name },
          (i) => handle(options[i] ?? ''),
        );
      } else {
        Alert.alert(conn.name, undefined, [
          { text: actionLabel, onPress: () => handle(actionLabel) },
          { text: 'Forget Server', style: 'destructive', onPress: () => handle('Forget Server') },
          { text: 'Cancel', style: 'cancel' },
        ]);
      }
    },
    [connectServer, disconnectServer, forgetServer],
  );

  const toastConn = toastServerId ? savedConnections.find((c) => c.id === toastServerId) : null;

  return (
    <SafeAreaView style={styles.container}>
      {toastConn ? <ReconnectToast serverName={toastConn.name} /> : null}

      <View style={styles.header}>
        <Text style={styles.title}>stavi</Text>
        <View style={styles.headerActions}>
          <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
            <Settings size={18} color={colors.fg.secondary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => setShowNewSession(true)}>
            <FolderPlus size={18} color={colors.fg.secondary} />
          </Pressable>
          <Pressable style={styles.iconButton} onPress={() => setShowAddServer(true)}>
            <Plus size={18} color={colors.fg.secondary} />
          </Pressable>
        </View>
      </View>

      {savedConnections.length === 0 ? (
        <View style={styles.emptyState}>
          <Server size={32} color={colors.fg.muted} />
          <Text style={styles.emptyTitle}>Add your first server</Text>
          <Text style={styles.emptySubtitle}>Create a connection to start new sessions.</Text>
          <Pressable style={styles.primaryButton} onPress={() => setShowAddServer(true)}>
            <Text style={styles.primaryButtonText}>Add Server</Text>
          </Pressable>
        </View>
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl refreshing={false} onRefresh={handleRefresh} tintColor={colors.accent.primary} />
          }
        >
          {sections.map(({ savedConnection, status, sessions, error, loading }) => (
            <SessionsHomeServerSection
              key={savedConnection.id}
              savedConnection={savedConnection}
              status={status}
              sessions={sessions}
              error={error}
              loading={loading}
              isCollapsed={collapsedIds[savedConnection.id] ?? false}
              onToggleCollapse={() => toggleCollapse(savedConnection.id)}
              onOpenTools={() => setToolsServerId(savedConnection.id)}
              onOpenMenu={() => openConnectionMenu(savedConnection, status)}
              onNewSession={() => setShowNewSession(true)}
            />
          ))}
        </ScrollView>
      )}

      <AddServerSheet visible={showAddServer} onClose={() => setShowAddServer(false)} onComplete={() => setShowAddServer(false)} />
      <NewSessionFlow
        visible={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreated={(session) => { setShowNewSession(false); navigation.navigate('Workspace', { sessionId: session.id }); }}
      />
      {toolsServerId ? (
        <ServerToolsSheet visible serverId={toolsServerId} onClose={() => setToolsServerId(null)} />
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
  },
  title: {
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
    color: colors.fg.primary,
  },
  headerActions: { flexDirection: 'row', gap: spacing[2] },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  scroll: { flex: 1 },
  scrollContent: { padding: spacing[4], gap: spacing[3] },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[3],
  },
  emptyTitle: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  emptySubtitle: { fontSize: typography.fontSize.sm, color: colors.fg.tertiary, textAlign: 'center' },
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
});
