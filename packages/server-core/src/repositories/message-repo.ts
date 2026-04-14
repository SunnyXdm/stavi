// ============================================================
// repositories/message-repo.ts — Messages persistence
// ============================================================
// WHAT: Append/replace messages for streaming AI threads.
// WHY:  Orchestration messages must survive server restarts.
// HOW:  bun:sqlite queries with per-thread sequence numbers.
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

export class MessageRepository {
  constructor(private db: Database) {}

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

  replaceMessage(id: string, next: OrchestrationMessage): void {
    const updatedAtMs = Date.parse(next.createdAt);
    this.db.query(
      'UPDATE messages SET text = ?, turn_id = ?, streaming = ?, created_at = ? WHERE id = ?',
    ).run(
      next.text,
      next.turnId ?? null,
      next.streaming ? 1 : 0,
      Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs,
      id,
    );
  }
}
