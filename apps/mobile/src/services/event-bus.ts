// ============================================================
// Event Bus — Typed cross-plugin communication
// ============================================================
// Plugins emit events, other plugins subscribe. Error-isolated per handler.
// Functional from day one — no stub implementations.

import type { PluginEventPayloads } from '@stavi/shared';

type EventName = keyof PluginEventPayloads | string;
type EventCallback<T = unknown> = (data: T) => void;

class PluginEventBus {
  private listeners = new Map<string, Set<EventCallback>>();
  private history: Array<{ event: string; data: unknown; timestamp: number }> = [];
  private readonly maxHistory = 100;

  /**
   * Subscribe to a typed event.
   * Returns an unsubscribe function.
   */
  on<E extends keyof PluginEventPayloads>(
    event: E,
    callback: EventCallback<PluginEventPayloads[E]>,
  ): () => void;
  on(event: string, callback: EventCallback): () => void;
  on(event: string, callback: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);

    return () => {
      this.listeners.get(event)?.delete(callback);
      // Clean up empty sets
      if (this.listeners.get(event)?.size === 0) {
        this.listeners.delete(event);
      }
    };
  }

  /**
   * Emit a typed event.
   * Each handler is wrapped in try/catch — one handler's error never affects others.
   */
  emit<E extends keyof PluginEventPayloads>(event: E, data: PluginEventPayloads[E]): void;
  emit(event: string, data: unknown): void;
  emit(event: string, data: unknown): void {
    // Record history
    this.history.push({ event, data, timestamp: Date.now() });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }

    // Fire event-specific listeners
    const callbacks = this.listeners.get(event);
    if (callbacks) {
      for (const cb of callbacks) {
        try {
          cb(data);
        } catch (err) {
          console.error(`[EventBus] Handler threw for "${event}":`, err);
        }
      }
    }

    // Fire wildcard listeners
    const wildcardCallbacks = this.listeners.get('*');
    if (wildcardCallbacks) {
      for (const cb of wildcardCallbacks) {
        try {
          cb({ event, data });
        } catch (err) {
          console.error(`[EventBus] Wildcard handler threw:`, err);
        }
      }
    }
  }

  /**
   * Listen to ALL events (useful for debugging and logging).
   */
  onAny(callback: (payload: { event: string; data: unknown }) => void): () => void {
    return this.on('*', callback as EventCallback);
  }

  /**
   * Get recent event history for debugging.
   */
  getHistory() {
    return [...this.history];
  }

  /**
   * Remove all listeners (for cleanup/testing).
   */
  clear() {
    this.listeners.clear();
    this.history = [];
  }
}

// Singleton instance
export const eventBus = new PluginEventBus();
