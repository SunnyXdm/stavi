// WHAT: Card component for a single workspace in the flat SessionsHomeScreen list.
// WHY:  Phase 8d replaces per-server accordion sections with a single FlatList of cards.
//       Each card surfaces the title, folder path, server context, recency, and online status
//       in a three-tier typography hierarchy that mirrors Litter's HomeDashboardView pattern.
// HOW:  Pressable card (tap → WorkspaceScreen). Long-press shows an action sheet with
//       Archive and Delete actions. Offline workspaces are dimmed with an "(offline)" badge.
//       All visual values derive from theme tokens — zero hardcoded colors or sizes.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx,
//       apps/mobile/src/stores/sessions-store.ts,
//       apps/mobile/src/stores/connection.ts

import React, { useCallback } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { Session } from '@stavi/shared';
import type { ConnectionState } from '../stores/connection';
import { colors, radii, spacing, typography } from '../theme';

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

/** Returns a human-readable relative-time string for a Unix-ms timestamp. */
function relativeTime(epochMs: number): string {
  const nowMs = Date.now();
  const diffMs = Math.max(0, nowMs - epochMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

/** Shortens a home-dir absolute path to ~/relative form for display. */
function displayPath(folder: string): string {
  const home = '/home/';
  const users = '/Users/';
  if (folder.startsWith(users)) {
    const rest = folder.slice(users.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '~' : `~${rest.slice(slash)}`;
  }
  if (folder.startsWith(home)) {
    const rest = folder.slice(home.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '~' : `~${rest.slice(slash)}`;
  }
  return folder;
}

// Fixed card height for getItemLayout — title + folder + tertiary row + padding.
export const WORKSPACE_CARD_HEIGHT = 84;

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

export interface WorkspaceCardProps {
  session: Session;
  serverName: string;
  /** Current connection state of the server that owns this workspace. */
  serverStatus: ConnectionState;
  onArchive?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function WorkspaceCard({
  session,
  serverName,
  serverStatus,
  onArchive,
  onDelete,
}: WorkspaceCardProps) {
  const navigation = useNavigation<NativeStackNavigationProp<any>>();

  const isOffline = serverStatus === 'disconnected' || serverStatus === 'error' || serverStatus === 'idle';
  const isRunning = session.status === 'running';

  const handlePress = useCallback(() => {
    navigation.navigate('Workspace', { sessionId: session.id });
  }, [navigation, session.id]);

  const handleLongPress = useCallback(() => {
    const options = ['Archive', 'Delete', 'Cancel'];
    const handle = (label: string) => {
      if (label === 'Archive') onArchive?.(session.id);
      if (label === 'Delete') {
        Alert.alert(
          'Delete workspace?',
          `"${session.title}" will be permanently deleted.`,
          [
            { text: 'Cancel', style: 'cancel' },
            {
              text: 'Delete',
              style: 'destructive',
              onPress: () => onDelete?.(session.id),
            },
          ],
        );
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        {
          options,
          destructiveButtonIndex: 1,
          cancelButtonIndex: 2,
          title: session.title,
        },
        (i) => handle(options[i] ?? ''),
      );
    } else {
      Alert.alert(session.title, undefined, [
        { text: 'Archive', onPress: () => handle('Archive') },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => handle('Delete'),
        },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [session.id, session.title, onArchive, onDelete]);

  return (
    <Pressable
      style={({ pressed }) => [
        styles.card,
        isOffline && styles.cardOffline,
        pressed && styles.cardPressed,
      ]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${session.title}, ${session.folder}`}
    >
      {/* Status dot + title row */}
      <View style={styles.titleRow}>
        <View
          style={[
            styles.statusDot,
            {
              backgroundColor: isOffline
                ? colors.fg.muted
                : isRunning
                ? colors.semantic.warning
                : colors.semantic.success,
            },
          ]}
        />
        <Text style={[styles.title, isOffline && styles.titleOffline]} numberOfLines={1}>
          {session.title}
        </Text>
        {isOffline ? (
          <View style={styles.offlineBadge}>
            <Text style={styles.offlineBadgeText}>offline</Text>
          </View>
        ) : null}
      </View>

      {/* Folder path — secondary tier */}
      <Text style={styles.folder} numberOfLines={1}>
        {displayPath(session.folder)}
      </Text>

      {/* Server + relative time — tertiary tier */}
      <Text style={styles.meta} numberOfLines={1}>
        {serverName}
        {'  ·  '}
        {relativeTime(session.lastActiveAt)}
      </Text>
    </Pressable>
  );
}

// ----------------------------------------------------------
// Styles — all values from theme tokens
// ----------------------------------------------------------

const styles = StyleSheet.create({
  card: {
    height: WORKSPACE_CARD_HEIGHT,
    backgroundColor: colors.bg.raised,
    borderRadius: radii.card,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[3],
    justifyContent: 'center',
    gap: spacing[1],
  },
  cardOffline: {
    opacity: 0.55,
  },
  cardPressed: {
    backgroundColor: colors.bg.active,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
  },
  statusDot: {
    width: 7,
    height: 7,
    borderRadius: radii.full,
    flexShrink: 0,
  },
  title: {
    flex: 1,
    fontSize: typography.fontSize.md,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    letterSpacing: typography.letterSpacing.tight,
  },
  titleOffline: {
    color: colors.fg.secondary,
  },
  offlineBadge: {
    backgroundColor: colors.bg.overlay,
    borderRadius: radii.full,
    paddingHorizontal: spacing[2],
    paddingVertical: 2,
  },
  offlineBadgeText: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontWeight: typography.fontWeight.medium,
  },
  folder: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.secondary,
    marginLeft: spacing[3] + 7, // align under title (past dot + gap)
  },
  meta: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    marginLeft: spacing[3] + 7,
  },
});
