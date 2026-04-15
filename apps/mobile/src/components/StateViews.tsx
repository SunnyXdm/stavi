// WHAT: Shared loading, error, and empty state components for all plugins and screens.
// WHY:  Phase 7d requires consistent state treatment across every plugin. Without a shared
//       component, each plugin invents its own layout, leading to visual inconsistency.
// HOW:  Three components — LoadingView, ErrorView, EmptyView — all centered flex containers
//       using theme tokens exclusively. Drop-in: place inside any flex:1 parent.
// SEE:  apps/mobile/src/theme/tokens.ts, apps/mobile/src/plugins/workspace/*/index.tsx

import React, { type ComponentType } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Pressable,
} from 'react-native';
import { colors, spacing, typography, radii } from '../theme';

// ----------------------------------------------------------
// LoadingView — centered spinner with optional message
// ----------------------------------------------------------

interface LoadingViewProps {
  message?: string;
}

export function LoadingView({ message }: LoadingViewProps) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="small" color={colors.accent.primary} />
      {message ? <Text style={styles.subtitle}>{message}</Text> : null}
    </View>
  );
}

// ----------------------------------------------------------
// ErrorView — icon + title + optional retry button
// ----------------------------------------------------------

interface ErrorViewProps {
  icon?: ComponentType<{ size?: number; color?: string }>;
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export function ErrorView({
  icon: Icon,
  title,
  message,
  onRetry,
  retryLabel = 'Retry',
}: ErrorViewProps) {
  return (
    <View style={styles.container}>
      {Icon ? <Icon size={32} color={colors.semantic.error} /> : null}
      {title ? <Text style={styles.title}>{title}</Text> : null}
      <Text style={[styles.subtitle, styles.errorText]}>{message}</Text>
      {onRetry ? (
        <Pressable style={styles.retryButton} onPress={onRetry} hitSlop={8}>
          <Text style={styles.retryButtonText}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------
// EmptyView — icon + title + subtitle + optional CTA button
// ----------------------------------------------------------

interface EmptyViewProps {
  icon?: ComponentType<{ size?: number; color?: string }>;
  title: string;
  subtitle?: string;
  onAction?: () => void;
  actionLabel?: string;
}

export function EmptyView({
  icon: Icon,
  title,
  subtitle,
  onAction,
  actionLabel,
}: EmptyViewProps) {
  return (
    <View style={styles.container}>
      {Icon ? <Icon size={32} color={colors.fg.muted} /> : null}
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {onAction && actionLabel ? (
        <Pressable style={styles.ctaButton} onPress={onAction} hitSlop={8}>
          <Text style={styles.ctaButtonText}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

// ----------------------------------------------------------
// Styles — all use tokens, zero hardcoded values
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing[6],
    gap: spacing[3],
    backgroundColor: colors.bg.base,
  },
  title: {
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.primary,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.tertiary,
    textAlign: 'center',
    lineHeight: typography.fontSize.sm * typography.lineHeight.normal,
  },
  errorText: {
    color: colors.semantic.error,
  },
  retryButton: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.semantic.error,
  },
  retryButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.medium,
    color: colors.semantic.error,
  },
  ctaButton: {
    marginTop: spacing[2],
    paddingHorizontal: spacing[5],
    paddingVertical: spacing[3],
    borderRadius: radii.md,
    backgroundColor: colors.accent.primary,
  },
  ctaButtonText: {
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
    color: colors.fg.onAccent,
  },
});
