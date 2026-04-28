// WHAT: Subscription Maps and broadcast/subscribe helpers for the Stavi server.
// WHY:  context.ts exceeded 400 lines; subscription plumbing is a clear seam.
// HOW:  Exports createSubscriptions() which populates the Maps and closes over
//       them to produce the broadcast/subscribe helpers. Called once by
//       createServerContext() and merged into the ServerContext object.
// SEE:  packages/server-core/src/context.ts, packages/server-core/src/server.ts

import type { WebSocket } from 'ws';
import type { Subscription } from './types';
import { makeChunk, sendJson } from './utils';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface SubscriptionMaps {
  terminalSubscriptions: Map<string, Subscription>;
  gitSubscriptions: Map<string, Subscription>;
  orchestrationSubscriptions: Map<string, Subscription>;
  processSubscriptions: Map<string, Subscription>;
  sessionSubscriptions: Map<string, Subscription>;
  connectionSubscriptions: Map<WebSocket, Set<string>>;
}

export interface SubscriptionHelpers {
  // Broadcast helpers
  broadcastOrchestrationEvent: (event: Record<string, unknown>) => void;
  emitTerminalEvent: (event: Record<string, unknown>) => void;
  emitProcessEvent: (event: Record<string, unknown>) => void;

  // Subscription lifecycle
  addConnectionSubscription: (ws: WebSocket, requestId: string) => void;
}

// The subset of ctx.state that subscriptions.ts reads and writes
interface SubscriptionState {
  sequence: number;
  lastGitStatusJson: string;
  gitPollTimer: ReturnType<typeof setInterval> | null;
}

// ----------------------------------------------------------
// Factory
// ----------------------------------------------------------

export function createSubscriptions(
  state: SubscriptionState,
  getGitStatus: (cwd: string) => Promise<import('./types').GitStatusPayload>,
  workspaceRoot: string,
): {
  maps: SubscriptionMaps;
  helpers: SubscriptionHelpers;
  broadcastGitStatus: () => Promise<void>;
  ensureGitPolling: () => void;
  maybeStopGitPolling: () => void;
} {
  // Maps
  const terminalSubscriptions = new Map<string, Subscription>();
  const gitSubscriptions = new Map<string, Subscription>();
  const orchestrationSubscriptions = new Map<string, Subscription>();
  const processSubscriptions = new Map<string, Subscription>();
  const sessionSubscriptions = new Map<string, Subscription>();
  const connectionSubscriptions = new Map<WebSocket, Set<string>>();

  // -- Broadcast helpers --

  const broadcastOrchestrationEvent = (event: Record<string, unknown>) => {
    const payload = { ...event, sequence: ++state.sequence };
    for (const sub of orchestrationSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [payload]));
    }
  };

  const broadcastGitStatus = async () => {
    if (gitSubscriptions.size === 0) return;
    const status = await getGitStatus(workspaceRoot);
    const nextJson = JSON.stringify(status);
    if (nextJson === state.lastGitStatusJson) return;
    state.lastGitStatusJson = nextJson;
    for (const sub of gitSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [status]));
    }
  };

  const emitTerminalEvent = (event: Record<string, unknown>) => {
    const eventThreadId = typeof event.threadId === 'string' ? event.threadId : undefined;
    const eventTerminalId = typeof event.terminalId === 'string' ? event.terminalId : undefined;
    // Phase C1: events may be `raw` byte output (existing) or `cells` frames.
    // Default mode is 'raw' for back-compat with xterm.js WebView clients.
    const eventMode = typeof event.mode === 'string' ? event.mode : 'raw';
    for (const sub of terminalSubscriptions.values()) {
      // Subscriptions without a threadId filter receive nothing (no global broadcast).
      if (!sub.threadId) continue;
      if (sub.threadId !== eventThreadId) continue;
      if (sub.terminalId !== undefined && sub.terminalId !== eventTerminalId) continue;
      const subMode = sub.mode ?? 'raw';
      if (subMode !== eventMode) continue;
      sendJson(sub.ws, makeChunk(sub.requestId, [event]));
    }
  };

  const emitProcessEvent = (event: Record<string, unknown>) => {
    for (const sub of processSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [event]));
    }
  };

  // -- Git polling --

  const ensureGitPolling = () => {
    if (state.gitPollTimer || gitSubscriptions.size === 0) return;
    state.gitPollTimer = setInterval(() => void broadcastGitStatus(), 4000);
  };

  const maybeStopGitPolling = () => {
    if (gitSubscriptions.size === 0 && state.gitPollTimer) {
      clearInterval(state.gitPollTimer);
      state.gitPollTimer = null;
    }
  };

  // -- Subscription lifecycle --

  const addConnectionSubscription = (ws: WebSocket, requestId: string) => {
    const current = connectionSubscriptions.get(ws) ?? new Set<string>();
    current.add(requestId);
    connectionSubscriptions.set(ws, current);
  };

  return {
    maps: {
      terminalSubscriptions,
      gitSubscriptions,
      orchestrationSubscriptions,
      processSubscriptions,
      sessionSubscriptions,
      connectionSubscriptions,
    },
    helpers: {
      broadcastOrchestrationEvent,
      emitTerminalEvent,
      emitProcessEvent,
      addConnectionSubscription,
    },
    broadcastGitStatus,
    ensureGitPolling,
    maybeStopGitPolling,
  };
}
