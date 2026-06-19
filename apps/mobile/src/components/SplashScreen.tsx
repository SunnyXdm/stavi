// WHAT: Branded splash shown at cold start while persisted stores hydrate.
// WHY:  Avoids a flash of the empty home before AsyncStorage rehydrates saved
//       servers (the "blank add-server home on launch" issue), and gives the
//       app a polished entry. Pure JS overlay — no native splash config needed.
// HOW:  Full-screen view with the moon logo + wordmark. The parent unmounts it
//       (with a fade) once the app is ready; here we just render the brand.

import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, Animated, Easing } from 'react-native';
import { useTheme, typography, spacing } from '../theme';
import { MoonLogo } from './MoonLogo';

export function SplashScreen() {
  const { colors } = useTheme();
  const fade = useRef(new Animated.Value(0)).current;
  const lift = useRef(new Animated.Value(8)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(lift, { toValue: 0, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    ]).start();
  }, [fade, lift]);

  return (
    <View style={[styles.root, { backgroundColor: colors.bg.base }]}>
      <Animated.View style={{ opacity: fade, transform: [{ translateY: lift }], alignItems: 'center' }}>
        <MoonLogo size={88} />
        <Text style={[styles.wordmark, { color: colors.fg.primary }]}>Stavi</Text>
        <Text style={[styles.tagline, { color: colors.fg.muted }]}>AI agents, from your pocket</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wordmark: {
    marginTop: spacing[4],
    fontSize: 34,
    fontWeight: typography.fontWeight.bold,
    letterSpacing: 1,
  },
  tagline: {
    marginTop: spacing[1],
    fontSize: typography.fontSize.sm,
  },
});
