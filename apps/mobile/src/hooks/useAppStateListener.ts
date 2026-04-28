// WHAT: Hook that listens to React Native AppState changes (active / background / inactive).
// WHY:  Expensive polling should pause when the app is backgrounded to save battery and
//       avoid stale updates. On foreground resume, we refresh session data from the server.
// HOW:  Subscribes once via AppState.addEventListener. Calls hydrateConnectedServers()
//       when transitioning from background/inactive → active.
// SEE:  apps/mobile/src/stores/sessions-store.ts (hydrateConnectedServers)

import { useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useSessionsStore } from '../stores/sessions-store';

export function useAppStateListener() {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextState;

      if (prev !== 'active' && nextState === 'active') {
        // App came to foreground — refresh stale session data from all connected servers
        useSessionsStore.getState().hydrateConnectedServers();
      }
      // When going to background: polling stops naturally because server-plugins-store
      // subscriptions are WS-push-based. No explicit pause needed until we add timers.
    });

    return () => subscription.remove();
  }, []);
}
