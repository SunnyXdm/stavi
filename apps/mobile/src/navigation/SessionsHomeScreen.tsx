// WHAT: Sessions Home root screen listing sessions grouped by server.
// WHY:  Phase 2 replaces Connect-as-root with a multi-server sessions landing page.
// HOW:  Reads per-server connection + sessions stores, auto-connects saved servers, and
//       opens server-scoped tools via ServerToolsSheet.
// SEE:  apps/mobile/src/stores/connection.ts, apps/mobile/src/stores/sessions-store.ts

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FlashList } from '@shopify/flash-list';
import { FolderPlus, Plus, Server, Settings, Wrench } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AddServerSheet } from '../components/AddServerSheet';
import { NewSessionFlow } from '../components/NewSessionFlow';
import { ServerToolsSheet } from '../components/ServerToolsSheet';
import { useConnectionStore, type ConnectionState } from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { colors, radii, spacing, typography } from '../theme';

const STATUS_COLORS: Record<ConnectionState, string> = {
  idle: colors.fg.muted,
  authenticating: colors.semantic.warning,
  connecting: colors.semantic.warning,
  connected: colors.semantic.success,
  reconnecting: colors.semantic.warning,
  error: colors.semantic.error,
  disconnected: colors.fg.muted,
};

export function SessionsHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const [showAddServer, setShowAddServer] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [toolsServerId, setToolsServerId] = useState<string | null>(null);

  const savedConnections = useConnectionStore((state) => state.savedConnections);
  const connectServer = useConnectionStore((state) => state.connectServer);
  const autoConnectSavedServers = useConnectionStore((state) => state.autoConnectSavedServers);
  const getStatusForServer = useConnectionStore((state) => state.getStatusForServer);

  const getSessionsForServer = useSessionsStore((state) => state.getSessionsForServer);
  const refreshForServer = useSessionsStore((state) => state.refreshForServer);
  const hydrateConnectedServers = useSessionsStore((state) => state.hydrateConnectedServers);
  const errorByServer = useSessionsStore((state) => state.errorByServer);
  const isLoadingByServer = useSessionsStore((state) => state.isLoadingByServer);

  useEffect(() => {
    autoConnectSavedServers();
  }, [autoConnectSavedServers]);

  useEffect(() => {
    hydrateConnectedServers();
  }, [hydrateConnectedServers, savedConnections.length]);

  const sections = useMemo(
    () =>
      savedConnections.map((savedConnection) => {
        const status = getStatusForServer(savedConnection.id);
        return {
          savedConnection,
          status,
          sessions: getSessionsForServer(savedConnection.id),
          error: errorByServer[savedConnection.id],
          loading: isLoadingByServer[savedConnection.id] ?? false,
        };
      }),
    [errorByServer, getSessionsForServer, getStatusForServer, isLoadingByServer, savedConnections],
  );

  const connected = sections.filter((section) => section.status !== 'disconnected');
  const disconnected = sections.filter((section) => section.status === 'disconnected');

  const handleRefresh = useCallback(async () => {
    await Promise.all(connected.map((section) => refreshForServer(section.savedConnection.id)));
  }, [connected, refreshForServer]);

  return (
    <SafeAreaView style={styles.container}>
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
            <RefreshControl
              refreshing={false}
              onRefresh={handleRefresh}
              tintColor={colors.accent.primary}
            />
          }
        >
          {connected.map(({ savedConnection, status, sessions, error, loading }) => (
            <View key={savedConnection.id} style={styles.serverCard}>
              <View style={styles.serverHeader}>
                <View style={styles.serverHeaderLeft}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] }]} />
                  <View>
                    <Text style={styles.serverName}>{savedConnection.name}</Text>
                    <Text style={styles.serverMeta}>
                      {savedConnection.host}:{savedConnection.port} · {status}
                    </Text>
                  </View>
                </View>
                <Pressable
                  style={styles.toolsButton}
                  onPress={() => setToolsServerId(savedConnection.id)}
                >
                  <Wrench size={16} color={colors.fg.secondary} />
                </Pressable>
              </View>

              {error ? <Text style={styles.errorText}>{error}</Text> : null}
              {loading && sessions.length === 0 ? (
                <Text style={styles.metaText}>Loading sessions...</Text>
              ) : null}

              {sessions.length === 0 && !loading ? (
                <Text style={styles.metaText}>No sessions yet.</Text>
              ) : (
                <View style={styles.listWrap}>
                  <FlashList
                    data={sessions}
                    keyExtractor={(session) => session.id}
                    scrollEnabled={false}
                    renderItem={({ item: session }) => (
                      <Pressable
                        style={styles.sessionRow}
                        onPress={() => navigation.navigate('Workspace', { sessionId: session.id })}
                      >
                        <View style={styles.sessionTextWrap}>
                          <Text style={styles.sessionTitle} numberOfLines={1}>
                            {session.title}
                          </Text>
                          <Text style={styles.sessionMeta} numberOfLines={1}>
                            {session.folder}
                          </Text>
                        </View>
                        <Text style={styles.sessionStatus}>{session.status}</Text>
                      </Pressable>
                    )}
                  />
                </View>
              )}
            </View>
          ))}

          {disconnected.length > 0 ? (
            <View style={styles.savedSection}>
              <Text style={styles.savedHeading}>Saved servers</Text>
              {disconnected.map(({ savedConnection }) => (
                <View key={savedConnection.id} style={styles.savedRow}>
                  <View>
                    <Text style={styles.serverName}>{savedConnection.name}</Text>
                    <Text style={styles.serverMeta}>Disconnected</Text>
                  </View>
                  <Pressable
                    style={styles.connectButton}
                    onPress={() => {
                      void connectServer(savedConnection.id).catch(() => {});
                    }}
                  >
                    <Text style={styles.connectButtonText}>Connect</Text>
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      )}

      <AddServerSheet
        visible={showAddServer}
        onClose={() => setShowAddServer(false)}
        onComplete={() => setShowAddServer(false)}
      />

      <NewSessionFlow
        visible={showNewSession}
        onClose={() => setShowNewSession(false)}
        onCreated={(session) => {
          setShowNewSession(false);
          navigation.navigate('Workspace', { sessionId: session.id });
        }}
      />

      {toolsServerId ? (
        <ServerToolsSheet
          visible={toolsServerId != null}
          serverId={toolsServerId}
          onClose={() => setToolsServerId(null)}
        />
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
  scrollContent: { padding: spacing[4], gap: spacing[4] },
  serverCard: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[3],
  },
  serverHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  serverHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    flex: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
  },
  serverName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  serverMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.tertiary,
    marginTop: 2,
  },
  toolsButton: {
    width: 32,
    height: 32,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.input,
  },
  listWrap: {
    minHeight: 12,
  },
  metaText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
  },
  errorText: {
    fontSize: typography.fontSize.sm,
    color: colors.semantic.error,
  },
  sessionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: colors.bg.input,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    marginBottom: spacing[2],
  },
  sessionTextWrap: { flex: 1, marginRight: spacing[2] },
  sessionTitle: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.primary,
  },
  sessionMeta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.tertiary,
    marginTop: 2,
  },
  sessionStatus: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.secondary,
  },
  savedSection: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[4],
    gap: spacing[3],
  },
  savedHeading: {
    color: colors.fg.secondary,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    textTransform: 'uppercase',
  },
  savedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  connectButton: {
    backgroundColor: colors.accent.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
  },
  connectButtonText: {
    color: colors.fg.onAccent,
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.semibold,
  },
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
  emptySubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.tertiary,
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
});
