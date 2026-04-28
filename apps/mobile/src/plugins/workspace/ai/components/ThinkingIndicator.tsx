// ============================================================
// ThinkingIndicator — animated pulsing dots shown while AI is working
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).

import React, { useEffect, useRef, memo, useMemo } from 'react';
import { View, StyleSheet, Animated } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { useTheme, spacing, radii } from '../../../../theme';

export const ThinkingIndicator = memo(function ThinkingIndicator() {
  const { colors } = useTheme();
  const styles = useMemo(() => StyleSheet.create({
    container: { flexDirection: 'row', alignItems: 'center', gap: spacing[2], paddingHorizontal: spacing[4], paddingVertical: spacing[2] },
    iconWrap: { width: 24, height: 24, borderRadius: radii.full, backgroundColor: colors.accent.subtle, alignItems: 'center', justifyContent: 'center' },
    dotsRow: { flexDirection: 'row', gap: 4, alignItems: 'center' },
    dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.accent.primary },
  }), [colors]);
  const anim1 = useRef(new Animated.Value(0.3)).current;
  const anim2 = useRef(new Animated.Value(0.3)).current;
  const anim3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    const pulse = (value: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(value, { toValue: 1, duration: 400, useNativeDriver: true }),
          Animated.timing(value, { toValue: 0.3, duration: 400, useNativeDriver: true }),
        ]),
      );

    const a1 = pulse(anim1, 0);
    const a2 = pulse(anim2, 150);
    const a3 = pulse(anim3, 300);
    a1.start();
    a2.start();
    a3.start();

    return () => { a1.stop(); a2.stop(); a3.stop(); };
  }, [anim1, anim2, anim3]);

  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Sparkles size={14} color={colors.accent.primary} />
      </View>
      <View style={styles.dotsRow}>
        <Animated.View style={[styles.dot, { opacity: anim1 }]} />
        <Animated.View style={[styles.dot, { opacity: anim2 }]} />
        <Animated.View style={[styles.dot, { opacity: anim3 }]} />
      </View>
    </View>
  );
});

// Styles live in ThinkingIndicator via useMemo — see component body.
