// ============================================================
// repositories/message-repo.ts — Messages persistence
// ============================================================
// WHAT: Append/replace messages for streaming AI threads.
// WHY:  Orchestration messages must survive server restarts.
// HOW:  bun:sqlite queries with per-thread sequence numbers.
//       replaceMessage() calls are coalesced: buffered for 50ms then flushed
//       in a single BEGIN/COMMIT transaction to avoid write amplification
//       during streaming (which can fire 20+ updates per second).
// SEE:  db/index.ts, types.ts

import type { Database } from 'bun:sqlite';
import type { OrchestrationMessage } from '../types';

function toMessage(row: any): OrchestrationMessage {
  return {
    messageId: row.id,
    threadId: row.thread_id,
    role: row.role,
    text: row.text,
    turnId: row.turn_id ?? undefined,
    streaming: !!row.streaming,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

// ----------------------------------------------------------
// PendingWrites — coalesces replaceMessage calls within 50ms window
// ----------------------------------------------------------

class PendingWrites {
  private pending = new Map<string, OrchestrationMessage>(); // id → latest message
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private db: Database,
    private delayMs = 50,
  ) {}

  enqueue(id: string, next: OrchestrationMessage): void {
    this.pending.set(id, next);
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.delayMs);
    }
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pending.size === 0) return;

    const updates = Array.from(this.pending.entries());
    this.pending.clear();

    // Single transaction for all pending updates
    const stmt = this.db.prepare(
      'UPDATE messages SET text = ?, turn_id = ?, streaming = ?, created_at = ? WHERE id = ?',
    );
    this.db.transaction(() => {
      for (const [id, next] of updates) {
        const updatedAtMs = Date.parse(next.createdAt);
        stmt.run(
          next.text,
          next.turnId ?? null,
          next.streaming ? 1 : 0,
          Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs,
          id,
        );
      }
    })();
  }
}

// ----------------------------------------------------------
// MessageRepository
// ----------------------------------------------------------

export class MessageRepository {
  private pendingWrites: PendingWrites;

  constructor(private db: Database) {
    this.pendingWrites = new PendingWrites(db);
  }

  appendMessage(m: OrchestrationMessage): void {
    const createdAtMs = Date.parse(m.createdAt);
    const row = this.db.query('SELECT MAX(sequence) as maxSeq FROM messages WHERE thread_id = ?').get(m.threadId) as any;
    const nextSeq = (row?.maxSeq ?? 0) + 1;
    this.db.query(
      'INSERT INTO messages (id, thread_id, role, text, turn_id, streaming, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      m.messageId,
      m.threadId,
      m.role,
      m.text,
      m.turnId ?? null,
      m.streaming ? 1 : 0,
      Number.isNaN(createdAtMs) ? Date.now() : createdAtMs,
      nextSeq,
    );
  }

  listMessagesForThread(threadId: string): OrchestrationMessage[] {
    const rows = this.db.query('SELECT * FROM messages WHERE thread_id = ? ORDER BY sequence ASC').all(threadId);
    return rows.map(toMessage);
  }

  /**
   * Coalesced update — multiple rapid calls within 50ms are batched into one
   * DB transaction. Call flush() before server shutdown to commit any pending writes.
   */
  replaceMessage(id: string, next: OrchestrationMessage): void {
    this.pendingWrites.enqueue(id, next);
  }

  /** Flush all pending coalesced writes immediately. Call on server shutdown. */
  flush(): void {
    this.pendingWrites.flush();
  }
}
