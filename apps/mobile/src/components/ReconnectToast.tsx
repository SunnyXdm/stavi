// WHAT: ReconnectToast — minimal fade-in/out banner shown on server reconnect.
// WHY:  Phase 5 introduced the toast; Phase 7d polishes with tap-to-dismiss,
//       2.5s auto-dismiss, fade-in animation, and zIndex token.
// HOW:  Animated.View with opacity fade-in on mount, auto-fade-out after 2.5s.
//       Pressable wrapper enables tap-to-dismiss. Uses zIndex.toast token.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme';
import { radii, spacing, typography, zIndex } from '../theme';

interface ReconnectToastProps {
  serverName: string;
  onDismiss?: () => void;
}

export function ReconnectToast({ serverName, onDismiss }: ReconnectToastProps) {
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { colors } = useTheme();

  const styles = useMemo(() => StyleSheet.create({
    toast: {
      position: 'absolute',
      bottom: 32,
      alignSelf: 'center',
      backgroundColor: colors.bg.raised,
      paddingHorizontal: spacing[4],
      paddingVertical: spacing[2],
      borderRadius: radii.lg,
      zIndex: zIndex.toast,
    },
    toastText: {
      fontSize: typography.fontSize.sm,
      color: colors.fg.primary,
    },
  }), [colors]);

  useEffect(() => {
    // Fade in
    Animated.timing(opacity, { toValue: 1, duration: 200, useNativeDriver: true }).start();

    // Auto-dismiss after 2.5s
    timerRef.current = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start(() => {
        onDismiss?.();
      });
    }, 2500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [opacity, onDismiss]);

  const handleTapDismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      onDismiss?.();
    });
  }, [opacity, onDismiss]);

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <Pressable onPress={handleTapDismiss}>
        <Text style={styles.toastText}>Reconnected to {serverName}</Text>
      </Pressable>
    </Animated.View>
  );
}

// Styles are created inside the component via useMemo (see ReconnectToast body above).
