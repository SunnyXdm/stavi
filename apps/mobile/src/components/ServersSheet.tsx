// WHAT: ServersSheet — bottom sheet listing all saved servers with status, connect/disconnect,
//       forget, and an "Add Server" button. The canonical home for all server management.
// WHY:  Phase 8d moves server management out of the home screen's main scroll area into a
//       dedicated sheet so the primary list can be a flat, chronological workspace list.
// HOW:  Modal overlay with slide-up sheet. FlatList of server rows, each showing name,
//       host:port, relay icon, status dot, and a connect/disconnect action button plus a
//       "···" menu for forget. "Add Server" button at the bottom opens AddServerSheet.
//       All visual values use theme tokens.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx,
//       apps/mobile/src/components/AddServerSheet.tsx,
//       apps/mobile/src/stores/connection.ts

import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Modal,
  Platform,
  ActionSheetIOS,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Plus, Wifi, X } from 'lucide-react-native';
import { AddServerSheet } from './AddServerSheet';
import {
  useConnectionStore,
  type ConnectionState,
  type SavedConnection,
} from '../stores/connection';
import { colors, radii, spacing, typography, zIndex } from '../theme';

// ----------------------------------------------------------
// Status helpers
// ----------------------------------------------------------

const STATUS_COLOR: Record<ConnectionState, string> = {
  idle: colors.fg.muted,
  authenticating: colors.semantic.warning,
  connecting: colors.semantic.warning,
  connected: colors.semantic.success,
  reconnecting: colors.semantic.warning,
  error: colors.semantic.error,
  disconnected: colors.fg.muted,
};

const STATUS_LABEL: Record<ConnectionState, string> = {
  idle: 'idle',
  authenticating: 'authenticating…',
  connecting: 'connecting…',
  connected: 'connected',
  reconnecting: 'reconnecting…',
  error: 'error',
  disconnected: 'offline',
};

// ----------------------------------------------------------
// Server row
// ----------------------------------------------------------

interface ServerRowProps {
  conn: SavedConnection;
  status: ConnectionState;
  onConnect: () => void;
  onDisconnect: () => void;
  onForget: () => void;
}

function ServerRow({ conn, status, onConnect, onDisconnect, onForget }: ServerRowProps) {
  const isConnected = status === 'connected';
  const isBusy =
    status === 'connecting' || status === 'authenticating' || status === 'reconnecting';

  const openMenu = useCallback(() => {
    const options = ['Forget Server', 'Cancel'];
    const handle = (label: string) => {
      if (label === 'Forget Server') {
        Alert.alert('Forget server?', `Remove "${conn.name}"?`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Forget', style: 'destructive', onPress: onForget },
        ]);
      }
    };
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: 0, cancelButtonIndex: 1, title: conn.name },
        (i) => handle(options[i] ?? ''),
      );
    } else {
      Alert.alert(conn.name, undefined, [
        { text: 'Forget Server', style: 'destructive', onPress: () => handle('Forget Server') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [conn.name, onForget]);

  return (
    <View style={rowStyles.row}>
      {/* Left: status dot + name/meta */}
      <View style={rowStyles.dotWrap}>
        <View style={[rowStyles.dot, { backgroundColor: STATUS_COLOR[status] }]} />
      </View>
      <View style={rowStyles.nameWrap}>
        <View style={rowStyles.nameRow}>
          <Text style={rowStyles.name} numberOfLines={1}>
            {conn.name}
          </Text>
          {conn.relayUrl ? (
            <Wifi size={11} color={colors.fg.muted} />
          ) : null}
        </View>
        <Text style={rowStyles.meta} numberOfLines={1}>
          {conn.host}:{conn.port}
          {'  ·  '}
          {STATUS_LABEL[status]}
        </Text>
      </View>

      {/* Right: action button + menu */}
      <View style={rowStyles.actions}>
        {isConnected ? (
          <Pressable
            style={rowStyles.actionBtn}
            onPress={onDisconnect}
            accessibilityLabel={`Disconnect from ${conn.name}`}
          >
            <Text style={[rowStyles.actionBtnText, rowStyles.actionBtnTextDestructive]}>
              Disconnect
            </Text>
          </Pressable>
        ) : isBusy ? null : (
          <Pressable
            style={rowStyles.actionBtn}
            onPress={onConnect}
            accessibilityLabel={`Connect to ${conn.name}`}
          >
            <Text style={rowStyles.actionBtnText}>Connect</Text>
          </Pressable>
        )}
        <Pressable style={rowStyles.menuBtn} onPress={openMenu} hitSlop={8}>
          <Text style={rowStyles.menuDots}>···</Text>
        </Pressable>
      </View>
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[4],
    gap: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerSubtle,
  },
  dotWrap: {
    width: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radii.full,
  },
  nameWrap: { flex: 1 },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  name: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  meta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    marginTop: 2,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[1],
  },
  actionBtn: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.divider,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[1],
  },
  actionBtnText: {
    fontSize: typography.fontSize.xs,
    fontWeight: typography.fontWeight.medium,
    color: colors.fg.secondary,
  },
  actionBtnTextDestructive: {
    color: colors.semantic.error,
  },
  menuBtn: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuDots: {
    fontSize: typography.fontSize.base,
    color: colors.fg.muted,
    letterSpacing: 1,
  },
});

// ----------------------------------------------------------
// ServersSheet
// ----------------------------------------------------------

interface ServersSheetProps {
  visible: boolean;
  onClose: () => void;
}

export function ServersSheet({ visible, onClose }: ServersSheetProps) {
  const [showAddServer, setShowAddServer] = useState(false);

  const savedConnections = useConnectionStore((s) => s.savedConnections);
  const connectServer = useConnectionStore((s) => s.connectServer);
  const disconnectServer = useConnectionStore((s) => s.disconnectServer);
  const forgetServer = useConnectionStore((s) => s.forgetServer);
  const getStatusForServer = useConnectionStore((s) => s.getStatusForServer);

  const handleConnect = useCallback(
    (id: string) => {
      void connectServer(id).catch(() => {});
    },
    [connectServer],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={onClose} />
      <SafeAreaView style={styles.sheetWrap} edges={['bottom']}>
        <View style={styles.sheet}>
          {/* Handle bar */}
          <View style={styles.handle} />

          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.headerTitle}>Servers</Text>
            <Pressable style={styles.closeBtn} onPress={onClose} hitSlop={8}>
              <X size={18} color={colors.fg.secondary} />
            </Pressable>
          </View>

          {/* Server list */}
          {savedConnections.length === 0 ? (
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>No servers added</Text>
              <Text style={styles.emptySubtitle}>
                Add a server to connect your workspaces.
              </Text>
            </View>
          ) : (
            <FlatList
              data={savedConnections}
              keyExtractor={(c) => c.id}
              renderItem={({ item: conn }) => (
                <ServerRow
                  conn={conn}
                  status={getStatusForServer(conn.id)}
                  onConnect={() => handleConnect(conn.id)}
                  onDisconnect={() => disconnectServer(conn.id)}
                  onForget={() => forgetServer(conn.id)}
                />
              )}
              style={styles.list}
              contentContainerStyle={styles.listContent}
            />
          )}

          {/* Add Server button */}
          <Pressable
            style={({ pressed }) => [styles.addButton, pressed && styles.addButtonPressed]}
            onPress={() => setShowAddServer(true)}
          >
            <Plus size={16} color={colors.accent.primary} />
            <Text style={styles.addButtonText}>Add Server</Text>
          </Pressable>
        </View>
      </SafeAreaView>

      <AddServerSheet
        visible={showAddServer}
        onClose={() => setShowAddServer(false)}
        onComplete={() => setShowAddServer(false)}
      />
    </Modal>
  );
}

// ----------------------------------------------------------
// Styles — all values from theme tokens
// ----------------------------------------------------------

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.bg.scrim,
    zIndex: zIndex.modal,
  },
  sheetWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: zIndex.modal + 1,
  },
  sheet: {
    backgroundColor: colors.bg.overlay,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    maxHeight: 480,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: radii.full,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginTop: spacing[2],
    marginBottom: spacing[1],
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    borderBottomWidth: 1,
    borderBottomColor: colors.dividerSubtle,
  },
  headerTitle: {
    flex: 1,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.md,
    backgroundColor: colors.bg.raised,
  },
  list: {
    maxHeight: 300,
  },
  listContent: {
    paddingBottom: spacing[2],
  },
  emptyState: {
    padding: spacing[6],
    alignItems: 'center',
    gap: spacing[2],
  },
  emptyTitle: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.secondary,
  },
  emptySubtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  addButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[2],
    margin: spacing[4],
    marginTop: spacing[3],
    paddingVertical: spacing[3],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.accent.subtle,
    backgroundColor: colors.accent.subtle,
  },
  addButtonPressed: {
    backgroundColor: colors.accent.glow,
  },
  addButtonText: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.accent.primary,
  },
});
