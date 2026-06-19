// WHAT: Themed full-screen recovery surface for fatal async/event-handler errors.
// WHY:  ErrorBoundary only catches render-phase errors. A fatal error thrown
//       from an event handler, timer, or native callback bypasses it and would
//       otherwise crash the app with no recovery. global-error-handler.ts
//       reports such fatals (release only) into global-error-store; this overlay
//       renders on top of the running app so the user can read it and dismiss —
//       the React tree was never unmounted, so the app keeps running.
// HOW:  Function component subscribing to useGlobalErrorStore. Returns null when
//       no fatal is present (zero cost on the happy path).
// SEE:  apps/mobile/src/components/ErrorBoundary.tsx (render-phase counterpart)

import React from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useTheme, zIndex } from '../theme';
import { useGlobalErrorStore } from '../stores/global-error-store';

export function GlobalErrorOverlay() {
  const { colors, typography } = useTheme();
  const fatalError = useGlobalErrorStore((s) => s.fatalError);
  const clearFatalError = useGlobalErrorStore((s) => s.clearFatalError);

  if (!fatalError) return null;

  const styles = StyleSheet.create({
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      zIndex: zIndex.toast,
      backgroundColor: colors.bg.base,
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    card: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.bg.raised,
      borderRadius: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.divider,
      padding: 24,
      gap: 12,
      alignItems: 'center',
    },
    title: {
      fontFamily: typography.fontFamily.sansBold,
      fontSize: 16,
      fontWeight: '700',
      color: colors.fg.primary,
      textAlign: 'center',
    },
    message: {
      fontFamily: typography.fontFamily.mono,
      fontSize: 12,
      color: colors.fg.secondary,
      textAlign: 'center',
      lineHeight: 18,
    },
    button: {
      marginTop: 8,
      paddingHorizontal: 20,
      paddingVertical: 10,
      backgroundColor: colors.bg.base,
      borderRadius: 8,
      borderWidth: 1,
      borderColor: colors.semantic.error,
    },
    buttonText: {
      fontFamily: typography.fontFamily.sans,
      fontSize: 14,
      color: colors.fg.primary,
    },
  });

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.message} numberOfLines={5}>
          {fatalError.message || 'Unknown error'}
        </Text>
        <Pressable style={styles.button} onPress={clearFatalError} hitSlop={8}>
          <Text style={styles.buttonText}>Dismiss</Text>
        </Pressable>
      </View>
    </View>
  );
}
