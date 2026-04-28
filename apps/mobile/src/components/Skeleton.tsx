// WHAT: Skeleton — a theme-aware, opacity-pulsing placeholder block used for
//       loading states (AI threads, git status, session cards, etc).
// WHY:  Empty space feels broken; a pulsing skeleton communicates "loading" with
//       zero layout shift when real content arrives.
// HOW:  Animated.Value loop driving opacity 0.4 ⇄ 0.9. Background comes from
//       theme tokens (colors.bg.raised). Width/height/radius overridable via props.

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTheme } from '../theme';
import { radii as radiiTokens } from '../theme';

export interface SkeletonProps {
  width?: number | `${number}%`;
  height?: number;
  radius?: number;
  style?: ViewStyle;
}

export function Skeleton({
  width = '100%',
  height = 16,
  radius = radiiTokens.sm,
  style,
}: SkeletonProps) {
  const { colors } = useTheme();
  const opacity = useRef(new Animated.Value(0.4)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.9,
          duration: 700,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.4,
          duration: 700,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      style={[
        {
          width,
          height,
          borderRadius: radius,
          backgroundColor: colors.bg.raised,
          opacity,
        },
        style,
      ]}
    />
  );
}

// Common multi-row skeleton (AI thread rows, session list, etc).
export function SkeletonRows({
  count = 3,
  rowHeight = 56,
  gap = 8,
}: {
  count?: number;
  rowHeight?: number;
  gap?: number;
}) {
  return (
    <View style={[styles.rowContainer, { gap }]}>
      {Array.from({ length: count }).map((_, i) => (
        <Skeleton key={i} height={rowHeight} radius={radiiTokens.md} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  rowContainer: {
    paddingHorizontal: 0,
  },
});
