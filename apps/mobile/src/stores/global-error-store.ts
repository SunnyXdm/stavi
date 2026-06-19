// WHAT: Holds the last fatal JS error caught by the global handler.
// WHY:  global-error-handler.ts runs outside React and cannot render UI.
//       This store lets a mounted overlay show a themed recovery surface.
// HOW:  Non-persisted Zustand. reportFatalError() is a plain fn so the
//       handler module has no hook dependency.
// SEE:  apps/mobile/src/utils/global-error-handler.ts,
//       apps/mobile/src/components/GlobalErrorOverlay.tsx
import { create } from 'zustand';

interface GlobalErrorState {
  fatalError: Error | null;
  clearFatalError: () => void;
}

export const useGlobalErrorStore = create<GlobalErrorState>((set) => ({
  fatalError: null,
  clearFatalError: () => set({ fatalError: null }),
}));

export function reportFatalError(error: Error): void {
  useGlobalErrorStore.setState({ fatalError: error });
}
