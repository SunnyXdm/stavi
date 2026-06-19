// WHAT: Animated bottom padding that keeps a workspace panel's bottom edge
//       (composer, terminal key bar) riding exactly on top of the keyboard.
// WHY:  The app is edge-to-edge (react-native-edge-to-edge), which disables
//       Android adjustResize — the IME draws OVER the window, covering the
//       PluginBottomBar and anything above it. RN's KeyboardAvoidingView only
//       gets a single post-animation event on Android and its offset math is
//       screen-top-relative (easy to get wrong — it was, twice). The keyboard
//       fully occludes the bottom bar (height bottomBarHeight = 56 + bottom
//       inset), so the panel must absorb keyboardHeight − bottomBarHeight.
// HOW:  react-native-keyboard-controller's reanimated bridge tracks the IME
//       1:1 during the show/hide animation (and interactive dismiss) on the UI
//       thread. Same math as lunel's panels: pad = max(0, K − bottomBarHeight).
// SEE:  apps/mobile/src/plugins/workspace/ai/index.tsx,
//       apps/mobile/src/plugins/workspace/terminal/index.tsx,
//       apps/mobile/src/App.tsx (KeyboardProvider)

import { useAnimatedStyle } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';

/**
 * Returns an animated style ({ paddingBottom }) for a workspace panel that
 * sits above the PluginBottomBar. `bottomBarHeight` must be the panel's
 * `bottomBarHeight` prop (56 + bottom inset).
 */
export function useKeyboardPanelStyle(bottomBarHeight: number) {
  // RNKC: height is 0 when closed and -K (negative) when the IME is open.
  const { height } = useReanimatedKeyboardAnimation();
  return useAnimatedStyle(() => ({
    paddingBottom: Math.max(0, -height.value - bottomBarHeight),
  }), [bottomBarHeight]);
}
