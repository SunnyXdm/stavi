// WHAT: Sessions Home root screen — flat, chronological list of all workspaces from
//       all connected servers. Phase 8d replaces the server-sectioned accordion layout.
// WHY:  Users think in terms of "recent workspaces", not "servers then sessions".
//       The flat list mirrors Litter's HomeDashboardView pattern: recency first,
//       server context surfaced on the card rather than as a grouping axis.
// HOW:  FlatList of WorkspaceCard, backed by sessions-store.getAllWorkspaces().
//       Client-side search filters by title + folder substring. A "Servers" button
//       opens ServersSheet for all connection management. ReconnectToast preserved.
//       Pull-to-refresh calls refreshForServer on every connected server.
// SEE:  components/WorkspaceCard.tsx, components/ServersSheet.tsx,
//       stores/sessions-store.ts, stores/connection.ts

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { FolderPlus, Server, Settings } from 'lucide-react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Session } from '@stavi/shared';
import { NewSessionFlow } from '../components/NewSessionFlow';
import { ReconnectToast } from '../components/ReconnectToast';
import { ServersSheet } from '../components/ServersSheet';
import { WorkspaceCard, WORKSPACE_CARD_HEIGHT } from '../components/WorkspaceCard';
import { useConnectionStore } from '../stores/connection';
import { useSessionsStore } from '../stores/sessions-store';
import { colors, radii, spacing, typography } from '../theme';

// Gap between cards in the list.
const CARD_GAP = spacing[2];
// Total height per list slot for getItemLayout.
const ITEM_HEIGHT = WORKSPACE_CARD_HEIGHT + CARD_GAP;

export function SessionsHomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  // -- UI state --
  const [showServers, setShowServers] = useState(false);
  const [showNewSession, setShowNewSession] = useState(false);
  const [toastServerId, setToastServerId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  // -- Connection store --
  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const autoConnectSavedServers = useConnectionStore((s) => s.autoConnectSavedServers);
  const getStatusForServer = useConnectionStore((s) => s.getStatusForServer);
  const onReconnect = useConnectionStore((s) => s.onReconnect);

  // -- Sessions store --
  const getAllWorkspaces = useSessionsStore((s) => s.getAllWorkspaces);
  const refreshForServer = useSessionsStore((s) => s.refreshForServer);
  const hydrateConnectedServers = useSessionsStore((s) => s.hydrateConnectedServers);

  // -- Auto-connect and hydrate on mount --
  useEffect(() => {
    autoConnectSavedServers();
  }, [autoConnectSavedServers]);

  useEffect(() => {
    hydrateConnectedServers();
  }, [hydrateConnectedServers, savedConnections.length]);

  // -- Reconnect toast + session refresh on reconnect --
  useEffect(() => {
    return onReconnect((serverId) => {
      setToastServerId(serverId);
      void refreshForServer(serverId).catch(() => {});
    });
  }, [onReconnect, refreshForServer]);

  // -- Flat, filtered workspace list --
  const allWorkspaces = getAllWorkspaces();

  const filteredWorkspaces = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return allWorkspaces;
    return allWorkspaces.filter(
      (w) =>
        w.title.toLowerCase().includes(q) ||
        w.folder.toLowerCase().includes(q),
    );
  }, [allWorkspaces, searchQuery]);

  // -- Pull-to-refresh: refresh every connected server --
  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    const promises = savedConnections
      .filter((c) => getStatusForServer(c.id) === 'connected')
      .map((c) => refreshForServer(c.id).catch(() => {}));
    await Promise.all(promises);
    setRefreshing(false);
  }, [savedConnections, getStatusForServer, refreshForServer]);

  // -- Archive / delete handlers (called from WorkspaceCard long-press) --
  // These are no-ops for now until Phase 8e wires up the server RPCs.
  // The action sheet in WorkspaceCard is live; the server calls will be added later.
  const handleArchive = useCallback((_sessionId: string) => {
    // TODO: Phase 8e — call session.archive RPC.
  }, []);

  const handleDelete = useCallback((_sessionId: string) => {
    // TODO: Phase 8e — call session.delete RPC.
  }, []);

  // -- FlatList item layout for perf (fixed-height cards) --
  const getItemLayout = useCallback(
    (_data: ArrayLike<Session> | null | undefined, index: number) => ({
      length: ITEM_HEIGHT,
      offset: ITEM_HEIGHT * index,
      index,
    }),
    [],
  );

  // -- Render workspace card --
  const renderItem = useCallback(
    ({ item }: { item: Session }) => {
      const serverConn = savedConnections.find((c) => c.id === item.serverId);
      const serverName = serverConn?.name ?? item.serverId;
      const serverStatus = getStatusForServer(item.serverId);
      return (
        <WorkspaceCard
          session={item}
          serverName={serverName}
          serverStatus={serverStatus}
          onArchive={handleArchive}
          onDelete={handleDelete}
        />
      );
    },
    [savedConnections, getStatusForServer, handleArchive, handleDelete],
  );

  // -- Reconnect toast info --
  const toastConn = toastServerId
    ? savedConnections.find((c) => c.id === toastServerId)
    : null;

  // -- Empty state: no servers added at all --
  if (savedConnections.length === 0) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>stavi</Text>
          <View style={styles.headerActions}>
            <Pressable style={styles.iconButton} onPress={() => navigation.navigate('Settings')}>
              <Settings size={18} color={colors.fg.secondary} />
            </Pressable>
          </View>
        </View>

        <View style={styles.noServerEmpty}>
          <Server size={36} color={colors.fg.muted} />
          <Text style={styles.emptyTitle}>Add a server to get started</Text>
          <Text style={styles.emptySubtitle}>
            Connect to a local or remote Stavi daemon to see your workspaces.
          </Text>
          <Pressable style={styles.primaryButton} onPress={() => setShowServers(true)}>
            <Text style={styles.primaryButtonText}>Add Server</Text>
          </Pressable>
        </View>

        <ServersSheet visible={showServers} onClose={() => setShowServers(false)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* ReconnectToast — preserved, unchanged */}
      {toastConn ? (
        <ReconnectToast
          serverName={toastConn.name}
          onDismiss={() => setToastServerId(null)}
        />
      ) : null}

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>stavi</Text>
        <View style={styles.headerActions}>
          <Pressable
            style={styles.serversButton}
            onPress={() => setShowServers(true)}
            accessibilityLabel="Manage servers"
          >
            <Server size={14} color={colors.fg.secondary} />
            <Text style={styles.serversButtonText}>Servers</Text>
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => setShowNewSession(true)}
            accessibilityLabel="New workspace"
          >
            <FolderPlus size={18} color={colors.fg.secondary} />
          </Pressable>
          <Pressable
            style={styles.iconButton}
            onPress={() => navigation.navigate('Settings')}
            accessibilityLabel="Settings"
          >
            <Settings size={18} color={colors.fg.secondary} />
          </Pressable>
        </View>
      </View>

      {/* Search bar */}
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search workspaces…"
          placeholderTextColor={colors.fg.muted}
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
          clearButtonMode="while-editing"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel="Search workspaces"
        />
      </View>

      {/* Flat workspace list */}
      <FlatList
        data={filteredWorkspaces}
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
          allWorkspaces.length === 0 ? (
            <NoWorkspacesEmpty onNewSession={() => setShowNewSession(true)} />
          ) : (
            <NoSearchResults query={searchQuery} />
          )
        }
        keyboardShouldPersistTaps="handled"
      />

      {/* Sheets */}
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

// ----------------------------------------------------------
// Sub-components
// ----------------------------------------------------------

function ItemSeparator() {
  return <View style={{ height: CARD_GAP }} />;
}

function NoWorkspacesEmpty({ onNewSession }: { onNewSession: () => void }) {
  return (
    <View style={emptyStyles.container}>
      <Text style={emptyStyles.title}>No workspaces yet</Text>
      <Text style={emptyStyles.subtitle}>Create one to get started.</Text>
      <Pressable style={emptyStyles.button} onPress={onNewSession}>
        <Text style={emptyStyles.buttonText}>New Workspace</Text>
      </Pressable>
    </View>
  );
}

function NoSearchResults({ query }: { query: string }) {
  return (
    <View style={emptyStyles.container}>
      <Text style={emptyStyles.title}>No results for "{query}"</Text>
      <Text style={emptyStyles.subtitle}>Try a different title or folder path.</Text>
    </View>
  );
}

// ----------------------------------------------------------
// Styles — all values from theme tokens
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
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
    letterSpacing: typography.letterSpacing.tight,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  serversButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
    height: 36,
    paddingHorizontal: spacing[3],
    borderRadius: radii.md,
    backgroundColor: colors.bg.raised,
  },
  serversButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  iconButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.raised,
  },
  searchWrap: {
    paddingHorizontal: spacing[4],
    paddingBottom: spacing[2],
  },
  searchInput: {
    height: 40,
    backgroundColor: colors.bg.raised,
    borderRadius: radii.md,
    paddingHorizontal: spacing[3],
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
    borderWidth: 1,
    borderColor: colors.divider,
  },
  listContent: {
    paddingHorizontal: spacing[4],
    paddingTop: spacing[1],
    paddingBottom: spacing[8],
    flexGrow: 1,
  },
  // No-server empty state (standalone screen variant)
  noServerEmpty: {
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
    textAlign: 'center',
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

const emptyStyles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: spacing[16],
    gap: spacing[3],
  },
  title: {
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
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
});
