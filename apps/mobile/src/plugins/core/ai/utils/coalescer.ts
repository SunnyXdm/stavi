// ============================================================
// utils/coalescer.ts — Batches rapid setState calls into RAF frames
// ============================================================

import type { OrchestrationState } from '../useOrchestration';

/**
 * Creates a coalescing updater that batches rapid setState calls.
 * Events are queued and flushed together on the next animation frame.
 * Use `.immediate()` for critical updates (approvals, thread creation).
 */
export function createCoalescingUpdater(
  setStateFn: React.Dispatch<React.SetStateAction<OrchestrationState>>,
) {
  let pendingUpdates: Array<(prev: OrchestrationState) => OrchestrationState> = [];
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

  function flush() {
    rafId = null;
    const updates = pendingUpdates;
    pendingUpdates = [];
    if (updates.length === 0) return;
    setStateFn((prev) => {
      let state = prev;
      for (const update of updates) state = update(state);
      return state;
    });
  }

  return {
    enqueue(updater: (prev: OrchestrationState) => OrchestrationState) {
      pendingUpdates.push(updater);
      if (rafId == null) rafId = requestAnimationFrame(flush);
    },
    immediate(updater: (prev: OrchestrationState) => OrchestrationState) {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      const updates = pendingUpdates;
      pendingUpdates = [];
      setStateFn((prev) => {
        let state = prev;
        for (const update of updates) state = update(state);
        return updater(state);
      });
    },
    destroy() {
      if (rafId != null) { cancelAnimationFrame(rafId); rafId = null; }
      pendingUpdates = [];
    },
  };
}
