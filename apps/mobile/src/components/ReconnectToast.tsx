// WHAT: ReconnectToast — minimal fade-out banner shown on server reconnect.
// WHY:  Phase 5 requires a one-shot toast when a server reconnects. Phase 7 polishes.
// HOW:  Animated.View with opacity fade-out after 2.6s. Pure presentational component.
// SEE:  apps/mobile/src/navigation/SessionsHomeScreen.tsx

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { colors, radii, spacing, typography } from '../theme';

export function ReconnectToast({ serverName }: { serverName: string }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const timer = setTimeout(() => {
      Animated.timing(opacity, { toValue: 0, duration: 400, useNativeDriver: true }).start();
    }, 2600);
    return () => clearTimeout(timer);
  }, [opacity]);

  return (
    <Animated.View style={[styles.toast, { opacity }]}>
      <Text style={styles.toastText}>Reconnected to {serverName}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    bottom: 32,
    alignSelf: 'center',
    backgroundColor: colors.bg.raised,
    paddingHorizontal: spacing[4],
    paddingVertical: spacing[2],
    borderRadius: radii.lg,
    zIndex: 100,
  },
  toastText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.primary,
  },
});
