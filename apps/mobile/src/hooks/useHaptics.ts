// WHAT: useHaptics — thin wrapper over react-native-haptic-feedback that gates
//       every haptic trigger on the user's `app.haptics` preference.
// WHY:  Centralizes haptic firing so call sites don't have to import the library
//       directly and don't need to re-check the user toggle each time.
// HOW:  Pulls `enabled` from app-preferences-store. Returns stable callbacks via
//       useCallback so passing them to memoized children won't trip re-renders.
//
// Haptic semantics (mirrors iOS UIFeedbackGenerator expectations):
//   light / medium / heavy — ImpactFeedback of varying strength (button presses)
//   selection              — subtle "a value changed" tick (tab switch, row tap)
//   success / warning / error — NotificationFeedback (confirmations, errors)
//
// On Android, react-native-haptic-feedback maps these to reasonable equivalents.

import { useCallback, useMemo } from 'react';
import ReactNativeHapticFeedback, {
  HapticFeedbackTypes,
} from 'react-native-haptic-feedback';
import { useAppPreferencesStore } from '../stores/app-preferences-store';

const HAPTIC_OPTIONS = {
  enableVibrateFallback: false,
  ignoreAndroidSystemSettings: false,
} as const;

function trigger(type: HapticFeedbackTypes) {
  try {
    ReactNativeHapticFeedback.trigger(type, HAPTIC_OPTIONS);
  } catch {
    // Haptics are non-critical — silently swallow. (e.g. simulator without haptics)
  }
}

export interface Haptics {
  light: () => void;
  medium: () => void;
  heavy: () => void;
  selection: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
}

export function useHaptics(): Haptics {
  const enabled = useAppPreferencesStore((s) => s.haptics);

  const light = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.impactLight); }, [enabled]);
  const medium = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.impactMedium); }, [enabled]);
  const heavy = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.impactHeavy); }, [enabled]);
  const selection = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.selection); }, [enabled]);
  const success = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.notificationSuccess); }, [enabled]);
  const warning = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.notificationWarning); }, [enabled]);
  const error = useCallback(() => { if (enabled) trigger(HapticFeedbackTypes.notificationError); }, [enabled]);

  return useMemo(
    () => ({ light, medium, heavy, selection, success, warning, error }),
    [light, medium, heavy, selection, success, warning, error],
  );
}
