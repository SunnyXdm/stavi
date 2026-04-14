// ============================================================
// ai-bindings-store.ts — Zustand store for AI tab ↔ thread bindings
// ============================================================
// WHAT: Binds plugin tab instanceId ↔ server threadId, per (serverId, sessionId).
// WHY:  Replaces the module-level instanceThreadBindings Map in useOrchestrationActions.ts
//       that leaked across reconnects — the Map never cleared on server disconnect, so
//       after a restart the stale instanceId→threadId mapping pointed at a dead threadId.
// HOW:  Zustand store. On disconnect call clearServer(serverId). On snapshot reconcile
//       to drop bindings whose threadId no longer exists on the server.
// SEE:  apps/mobile/src/plugins/workspace/ai/hooks/useOrchestrationActions.ts

import { create } from 'zustand';

export interface AiBindingKey {
  serverId: string;
  sessionId: string;
  instanceId: string;
}

function bindingKey(key: AiBindingKey): string {
  return `${key.serverId}::${key.sessionId}::${key.instanceId}`;
}

export interface AiBindingsState {
  /** key = `${serverId}::${sessionId}::${instanceId}` → threadId */
  bindings: Record<string, string>;

  /** Store a new binding. Overwrites any prior binding for the same key. */
  bind(key: AiBindingKey, threadId: string): void;

  /** Remove a single binding (e.g. on tab close). */
  unbind(key: AiBindingKey): void;

  /**
   * After receiving a server snapshot, drop any binding whose threadId is no
   * longer in the server's thread list for this (serverId, sessionId) pair.
   */
  reconcile(serverId: string, sessionId: string, validThreadIds: Set<string>): void;

  /**
   * Clear all bindings for a server (call on disconnect / connection loss).
   * This is the primary leak-prevention mechanism.
   */
  clearServer(serverId: string): void;

  /** Lookup — returns undefined if no binding exists. */
  getBoundThreadId(key: AiBindingKey): string | undefined;
}

export const useAiBindingsStore = create<AiBindingsState>((set, get) => ({
  bindings: {},

  bind: (key, threadId) => {
    const k = bindingKey(key);
    set((s) => ({ bindings: { ...s.bindings, [k]: threadId } }));
  },

  unbind: (key) => {
    const k = bindingKey(key);
    set((s) => {
      const { [k]: _, ...rest } = s.bindings;
      return { bindings: rest };
    });
  },

  reconcile: (serverId, sessionId, validThreadIds) => {
    set((s) => {
      const next: Record<string, string> = {};
      for (const [k, threadId] of Object.entries(s.bindings)) {
        // Keep bindings for other servers/sessions, or if threadId is still valid.
        const [kServerId, kSessionId] = k.split('::');
        if (kServerId !== serverId || kSessionId !== sessionId) {
          next[k] = threadId;
        } else if (validThreadIds.has(threadId)) {
          next[k] = threadId;
        }
        // Otherwise: drop stale binding silently.
      }
      return { bindings: next };
    });
  },

  clearServer: (serverId) => {
    set((s) => {
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(s.bindings)) {
        if (!k.startsWith(`${serverId}::`)) {
          next[k] = v;
        }
      }
      return { bindings: next };
    });
  },

  getBoundThreadId: (key) => {
    return get().bindings[bindingKey(key)];
  },
}));
