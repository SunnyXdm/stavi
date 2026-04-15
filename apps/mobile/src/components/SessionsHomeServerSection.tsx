// WHAT: ServerSection — renders one server card with header + session list.
// WHY:  Extracted from SessionsHomeScreen to keep screen file ≤400 lines.
// HOW:  Stateless render component. Collapse, menu, tools actions passed via callbacks.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx

import React from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  ChevronDown,
  ChevronRight,
  MoreHorizontal,
  Plus,
  Wrench,
  Wifi,
} from 'lucide-react-native';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Session } from '@stavi/shared';
import type { ConnectionState, SavedConnection } from '../stores/connection';
import { colors, radii, spacing, typography } from '../theme';

export const STATUS_COLORS: Record<ConnectionState, string> = {
  idle: colors.fg.muted,
  authenticating: colors.semantic.warning,
  connecting: colors.semantic.warning,
  connected: colors.semantic.success,
  reconnecting: colors.semantic.warning,
  error: colors.semantic.error,
  disconnected: colors.fg.muted,
};

export const INACTIVE_STATES: ConnectionState[] = ['disconnected', 'error', 'idle'];

interface ServerSectionProps {
  savedConnection: SavedConnection;
  status: ConnectionState;
  sessions: Session[];
  error: string | null | undefined;
  loading: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onOpenTools: () => void;
  onOpenMenu: () => void;
  onNewSession: () => void;
}

export function ServerSection({
  savedConnection,
  status,
  sessions,
  error,
  loading,
  isCollapsed,
  onToggleCollapse,
  onOpenTools,
  onOpenMenu,
  onNewSession,
}: ServerSectionProps) {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();
  const isInactive = INACTIVE_STATES.includes(status);

  return (
    <View style={[styles.serverCard, isInactive && styles.serverCardInactive]}>
      {/* Header */}
      <View style={styles.serverHeader}>
        <Pressable style={styles.collapseToggle} onPress={onToggleCollapse} hitSlop={8}>
          {isCollapsed ? (
            <ChevronRight size={14} color={colors.fg.muted} />
          ) : (
            <ChevronDown size={14} color={colors.fg.muted} />
          )}
        </Pressable>
        <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[status] }]} />
        <View style={styles.serverNameWrap}>
          <View style={styles.serverNameRow}>
            <Text style={[styles.serverName, isInactive && styles.serverNameInactive]}>
              {savedConnection.name}
            </Text>
            {savedConnection.relayUrl ? (
              <Wifi size={12} color={colors.fg.secondary} style={styles.tunnelIcon} />
            ) : null}
          </View>
          <Text style={styles.serverMeta}>
            {savedConnection.host}:{savedConnection.port} · {status}
          </Text>
        </View>
        {status === 'connected' ? (
          <Pressable style={styles.toolsButton} onPress={onOpenTools}>
            <Wrench size={15} color={colors.fg.secondary} />
          </Pressable>
        ) : null}
        <Pressable style={styles.menuButton} onPress={onOpenMenu} hitSlop={8}>
          <MoreHorizontal size={18} color={colors.fg.muted} />
        </Pressable>
      </View>

      {/* Body */}
      {!isCollapsed ? (
        <>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
          {loading && sessions.length === 0 ? (
            <Text style={styles.metaText}>Loading workspaces…</Text>
          ) : null}
          {sessions.length === 0 && !loading && !error ? (
            <Pressable
              style={styles.newSessionRow}
              onPress={onNewSession}
              disabled={status !== 'connected'}
            >
              <Plus size={14} color={colors.fg.muted} />
              <Text style={styles.newSessionText}>Start a new workspace</Text>
            </Pressable>
          ) : (
            <View style={styles.listWrap}>
              <FlashList
                data={sessions}
                keyExtractor={(s) => s.id}
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
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  serverCard: {
    backgroundColor: colors.bg.raised,
    borderRadius: radii.lg,
    padding: spacing[3],
    gap: spacing[2],
  },
  serverCardInactive: { opacity: 0.55 },
  serverHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
  collapseToggle: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 7, height: 7, borderRadius: 999 },
  serverNameWrap: { flex: 1 },
  serverNameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[1] },
  tunnelIcon: { marginTop: 1 },
  serverName: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
  },
  serverNameInactive: { color: colors.fg.secondary },
  serverMeta: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary, marginTop: 1 },
  toolsButton: {
    width: 30,
    height: 30,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg.input,
  },
  menuButton: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center' },
  listWrap: { minHeight: 12 },
  metaText: { fontSize: typography.fontSize.sm, color: colors.fg.muted },
  errorText: { fontSize: typography.fontSize.sm, color: colors.semantic.error },
  newSessionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    paddingVertical: spacing[2],
    paddingHorizontal: spacing[1],
  },
  newSessionText: { fontSize: typography.fontSize.sm, color: colors.fg.muted },
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
  sessionMeta: { fontSize: typography.fontSize.xs, color: colors.fg.tertiary, marginTop: 2 },
  sessionStatus: { fontSize: typography.fontSize.xs, color: colors.fg.secondary },
});
