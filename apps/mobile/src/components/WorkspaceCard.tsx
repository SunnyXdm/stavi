// WHAT: Card component for a single workspace in SessionsHomeScreen.
// WHY:  Redesigned for the new home screen: icon box, bold title, accent left-border for active.
// HOW:  AnimatedPressable card (tap → WorkspaceScreen). Long-press shows action sheet.
//       Icon is derived from folder name heuristics. Orange left border = running session.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx

import React, { useCallback, useMemo } from 'react';
import {
  ActionSheetIOS,
  Alert,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { AppNavigation } from '../navigation/types';
import type { Session } from '@stavi/shared';
import type { ConnectionState } from '../stores/connection';
import { useTheme } from '../theme';
import { radii, spacing, typography } from '../theme';
import { useHaptics } from '../hooks/useHaptics';
import { AnimatedPressable } from './AnimatedPressable';
import {
  Code2,
  Braces,
  Database,
  Globe,
  Server,
  Layers,
} from 'lucide-react-native';

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function relativeTime(epochMs: number): string {
  const diffMs = Math.max(0, Date.now() - epochMs);
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(epochMs).toLocaleDateString();
}

function displayPath(folder: string): string {
  if (!folder || folder === '.' || folder === './') return '~';
  if (folder.startsWith('/Users/')) {
    const rest = folder.slice('/Users/'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '~' : `~${rest.slice(slash)}`;
  }
  if (folder.startsWith('/home/')) {
    const rest = folder.slice('/home/'.length);
    const slash = rest.indexOf('/');
    return slash === -1 ? '~' : `~${rest.slice(slash)}`;
  }
  return folder;
}

function sessionTitle(session: Session): string {
  if (session.title && session.title.trim()) return session.title.trim();
  const folderName = session.folder.split('/').filter(Boolean).pop();
  return folderName || 'Workspace';
}

function WorkspaceIcon({ folder, size = 20 }: { folder: string; size?: number }) {
  const { colors } = useTheme();
  const lower = folder.toLowerCase();
  const color = colors.fg.secondary;

  if (/postgres|mysql|mongo|sqlite|db|database|redis/.test(lower))
    return <Database size={size} color={color} strokeWidth={1.8} />;
  if (/web|frontend|react|next|nuxt|svelte|vue|vite/.test(lower))
    return <Globe size={size} color={color} strokeWidth={1.8} />;
  if (/api|backend|server|service|lambda/.test(lower))
    return <Server size={size} color={color} strokeWidth={1.8} />;
  if (/infra|deploy|k8s|docker|cloud|devops/.test(lower))
    return <Layers size={size} color={color} strokeWidth={1.8} />;
  if (/json|config|settings|env|dotfile/.test(lower))
    return <Braces size={size} color={color} strokeWidth={1.8} />;
  return <Code2 size={size} color={color} strokeWidth={1.8} />;
}

// Fixed card height for getItemLayout.
export const WORKSPACE_CARD_HEIGHT = 88;

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

export interface WorkspaceCardProps {
  session: Session;
  serverName: string;
  serverStatus: ConnectionState;
  onArchive?: (sessionId: string) => void;
  onDelete?: (sessionId: string) => void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function WorkspaceCard({
  session,
  serverStatus,
  onArchive,
  onDelete,
}: WorkspaceCardProps) {
  const navigation = useNavigation<AppNavigation>();
  const { colors } = useTheme();
  const haptics = useHaptics();

  const isOffline = serverStatus === 'disconnected' || serverStatus === 'error' || serverStatus === 'idle';
  const isRunning = session.status === 'running';

  const styles = useMemo(() => StyleSheet.create({
    card: {
      height: WORKSPACE_CARD_HEIGHT,
      backgroundColor: colors.bg.raised,
      borderRadius: radii.card,
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[3],
      gap: spacing[3],
      overflow: 'hidden',
    },
    cardOffline: { opacity: 0.55 },
    leftBorder: {
      position: 'absolute',
      left: 0,
      top: 0,
      bottom: 0,
      width: 3,
      borderTopLeftRadius: radii.card,
      borderBottomLeftRadius: radii.card,
    },
    iconBox: {
      width: 48,
      height: 48,
      borderRadius: radii.md,
      backgroundColor: colors.bg.active,
      borderWidth: 1,
      borderColor: colors.divider,
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
    },
    content: { flex: 1, gap: 3 },
    titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing[2] },
    title: {
      flex: 1,
      fontSize: typography.fontSize.md,
      fontWeight: typography.fontWeight.semibold,
      color: colors.fg.primary,
      letterSpacing: typography.letterSpacing.tight,
    },
    titleOffline: { color: colors.fg.secondary },
    activeDot: {
      width: 7,
      height: 7,
      borderRadius: radii.full,
      flexShrink: 0,
    },
    path: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.secondary,
      fontFamily: typography.fontFamily.mono,
    },
    meta: {
      fontSize: typography.fontSize.xs,
      color: colors.fg.muted,
    },
  }), [colors]);

  const handlePress = useCallback(() => {
    haptics.selection();
    navigation.navigate('Workspace', { sessionId: session.id });
  }, [navigation, session.id, haptics]);

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
            { text: 'Delete', style: 'destructive', onPress: () => onDelete?.(session.id) },
          ],
        );
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, destructiveButtonIndex: 1, cancelButtonIndex: 2, title: session.title },
        (i) => handle(options[i] ?? ''),
      );
    } else {
      Alert.alert(session.title, undefined, [
        { text: 'Archive', onPress: () => handle('Archive') },
        { text: 'Delete', style: 'destructive', onPress: () => handle('Delete') },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [session.id, session.title, onArchive, onDelete]);

  return (
    <AnimatedPressable
      style={[styles.card, isOffline && styles.cardOffline]}
      onPress={handlePress}
      onLongPress={handleLongPress}
      accessibilityRole="button"
      accessibilityLabel={`${session.title}, ${session.folder}`}
    >
      {/* Left accent border for running sessions */}
      {isRunning && !isOffline && (
        <View style={[styles.leftBorder, { backgroundColor: colors.semantic.warning }]} />
      )}

      {/* Icon box */}
      <View style={styles.iconBox}>
        <WorkspaceIcon folder={session.folder} />
      </View>

      {/* Text content */}
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={[styles.title, isOffline && styles.titleOffline]} numberOfLines={1}>
            {sessionTitle(session)}
          </Text>
          {isRunning && !isOffline && (
            <View style={[styles.activeDot, { backgroundColor: colors.semantic.warning }]} />
          )}
        </View>
        <Text style={styles.path} numberOfLines={1}>{displayPath(session.folder)}</Text>
        <Text style={styles.meta} numberOfLines={1}>{relativeTime(session.lastActiveAt)}</Text>
      </View>
    </AnimatedPressable>
  );
}
