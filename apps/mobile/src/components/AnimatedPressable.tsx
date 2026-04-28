// WHAT: AnimatedPressable — Pressable with a subtle scale-down press animation
//       and optional haptic feedback on press-in.
// WHY:  Primary CTAs (send message, approve/deny, new workspace, session tiles)
//       should feel tactile — a 80ms scale dip to 0.97 communicates responsiveness
//       without being flashy. Haptics on press-in fires before the visual settles,
//       so it feels like the tap caused both.
// HOW:  Wraps Pressable. Uses Animated.Value spring to scale 1 ⇄ 0.97. The haptic
//       prop opts into fire-on-press-in; call sites that want a different haptic
//       moment (e.g. on release, on success) should call useHaptics() directly.
// SEE:  apps/mobile/src/hooks/useHaptics.ts

import React, { useCallback, useRef } from 'react';
import {
  Animated,
  Pressable,
  type PressableProps,
  type GestureResponderEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useHaptics } from '../hooks/useHaptics';

export interface AnimatedPressableProps extends Omit<PressableProps, 'style'> {
  style?: StyleProp<ViewStyle>;
  /** Fire a haptic on press-in. */
  haptic?: 'light' | 'medium' | 'selection';
  /** Scale factor at press-in. Default 0.97. */
  pressedScale?: number;
}

export function AnimatedPressable({
  style,
  haptic,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  children,
  ...rest
}: AnimatedPressableProps) {
  const scale = useRef(new Animated.Value(1)).current;
  const haptics = useHaptics();

  const handlePressIn = useCallback(
    (e: GestureResponderEvent) => {
      // Fire haptic first so the tactile cue leads the visual dip.
      if (haptic === 'light') haptics.light();
      else if (haptic === 'medium') haptics.medium();
      else if (haptic === 'selection') haptics.selection();

      Animated.spring(scale, {
        toValue: pressedScale,
        useNativeDriver: true,
        speed: 50,
        bounciness: 0,
      }).start();
      onPressIn?.(e);
    },
    [scale, pressedScale, haptic, haptics, onPressIn],
  );

  const handlePressOut = useCallback(
    (e: GestureResponderEvent) => {
      Animated.spring(scale, {
        toValue: 1,
        useNativeDriver: true,
        speed: 50,
        bounciness: 4,
      }).start();
      onPressOut?.(e);
    },
    [scale, onPressOut],
  );

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable onPressIn={handlePressIn} onPressOut={handlePressOut} {...rest}>
        {children as React.ReactNode}
      </Pressable>
    </Animated.View>
  );
}
