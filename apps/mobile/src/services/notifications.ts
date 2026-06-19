// WHAT: Local notifications for agent events via Notifee.
// WHY:  Agents finish turns and request tool approvals while the phone is
//       locked or the app is backgrounded — without notifications the user
//       has to keep the app open and watch. (litter and t3code both notify.)
// HOW:  One Android channel ("agent-events", HIGH importance). Callers fire
//       notifyAgentEvent(); it no-ops while the app is foregrounded (the chat
//       UI is already showing the event) and degrades silently if the user
//       denies the permission.
// SEE:  apps/mobile/src/plugins/workspace/ai/useOrchestration.ts (call site)

import notifee, { AndroidImportance, AuthorizationStatus } from '@notifee/react-native';
import { AppState, Platform } from 'react-native';

const CHANNEL_ID = 'agent-events';

let setupPromise: Promise<boolean> | null = null;

/**
 * Request the notification permission + create the channel up front, while the
 * app is FOREGROUND. Must be called from UI (e.g. when a workspace mounts) —
 * the Android 13+ permission dialog can't appear once we're backgrounded, which
 * is exactly when agent events fire. Safe to call repeatedly (memoized).
 */
export function primeNotifications(): void {
  void ensureSetup();
}

/** Create the channel + request permission once. Resolves false if denied. */
function ensureSetup(): Promise<boolean> {
  if (!setupPromise) {
    setupPromise = (async () => {
      try {
        const settings = await notifee.requestPermission();
        if (settings.authorizationStatus === AuthorizationStatus.DENIED) return false;
        if (Platform.OS === 'android') {
          await notifee.createChannel({
            id: CHANNEL_ID,
            name: 'Agent events',
            description: 'Approvals, questions, and finished turns from AI agents',
            importance: AndroidImportance.HIGH,
          });
        }
        return true;
      } catch (err) {
        console.warn('[notifications] setup failed:', err);
        return false;
      }
    })();
  }
  return setupPromise;
}

export type AgentEventKind = 'approval' | 'user-input' | 'turn-done' | 'turn-error';

const TITLES: Record<AgentEventKind, string> = {
  approval: 'Approval needed',
  'user-input': 'Agent has a question',
  'turn-done': 'Agent finished',
  'turn-error': 'Agent hit an error',
};

/**
 * Show a local notification for an agent event.
 * Skipped while the app is active — the chat UI already shows it live.
 */
export function notifyAgentEvent(
  kind: AgentEventKind,
  body: string,
  threadId?: string,
): void {
  if (AppState.currentState === 'active') return;

  void (async () => {
    try {
      if (!(await ensureSetup())) return;
      await notifee.displayNotification({
        // One notification per thread+kind — newer events replace older ones
        // instead of piling up.
        id: `${kind}:${threadId ?? 'global'}`,
        title: TITLES[kind],
        body: body.length > 160 ? `${body.slice(0, 157)}…` : body,
        android: {
          channelId: CHANNEL_ID,
          smallIcon: 'ic_launcher',
          pressAction: { id: 'default' },
        },
      });
    } catch (err) {
      console.warn('[notifications] display failed:', err);
    }
  })();
}
