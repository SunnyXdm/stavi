// WHAT: App-level global JS error + unhandled-promise-rejection handlers.
// WHY:  ErrorBoundary (src/components/ErrorBoundary.tsx) only catches errors
//       thrown during React render. Errors from event handlers, timers,
//       native callbacks, and escaping `void p.catch()` sites bypass it.
//       Hermes only installs a rejection tracker in __DEV__ (see RN
//       Libraries/Core/polyfillPromise.js), so release builds drop unhandled
//       rejections silently. This restores signal in BOTH modes.
// HOW:  Chain (do not replace) ErrorUtils' global handler, and install the
//       Hermes promise-rejection tracker in release (RN already does it in dev).
// SEE:  apps/mobile/index.js (installs this before AppRegistry.registerComponent),
//       apps/mobile/src/stores/global-error-store.ts (recovery surface),
//       apps/mobile/src/components/ErrorBoundary.tsx (render-phase counterpart).

import { reportFatalError } from '../stores/global-error-store';

declare const global: {
  ErrorUtils?: {
    getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
    setGlobalHandler?: (cb: (error: unknown, isFatal?: boolean) => void) => void;
  };
  HermesInternal?: {
    hasPromise?: () => boolean;
    enablePromiseRejectionTracker?: (opts: {
      allRejections: boolean;
      onUnhandled: (id: number, rejection: unknown) => void;
      onHandled?: (id: number) => void;
    }) => void;
  };
};

let installed = false;

function toError(e: unknown): Error {
  if (e instanceof Error) return e;
  if (typeof e === 'string') return new Error(e);
  try { return new Error(JSON.stringify(e)); } catch { return new Error(String(e)); }
}

export function installGlobalErrorHandlers(): void {
  if (installed) return;
  installed = true;

  // (a) Global JS error handler — chain RN's existing handler.
  const prev = global.ErrorUtils?.getGlobalHandler?.();
  global.ErrorUtils?.setGlobalHandler?.((error: unknown, isFatal?: boolean) => {
    const err = toError(error);
    console.error('[GlobalError]', isFatal ? '(fatal)' : '(non-fatal)', err);
    // Surface a themed recovery affordance for fatals in production.
    if (isFatal && !__DEV__) {
      try { reportFatalError(err); } catch {}
    }
    // ALWAYS delegate to RN's default last so dev redbox + native crash
    // reporting are preserved. Never swallow.
    if (typeof prev === 'function') {
      prev(error, isFatal);
    }
  });

  // (b) Unhandled promise rejection tracker.
  // In __DEV__ RN already installs Hermes' tracker (polyfillPromise.js),
  // which routes to ExceptionsManager (redbox). Do NOT double-install in dev.
  // In release RN installs nothing, so we install it ourselves.
  if (!__DEV__) {
    const hermes = global.HermesInternal;
    if (hermes?.hasPromise?.() && typeof hermes.enablePromiseRejectionTracker === 'function') {
      hermes.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (id, rejection) => {
          console.error(`[UnhandledRejection id:${id}]`, rejection);
        },
        onHandled: () => {},
      });
    }
  }
}
