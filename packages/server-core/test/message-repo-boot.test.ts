// ============================================================
// test/message-repo-boot.test.ts — ghost-streaming boot reconciliation
// ============================================================
// WHAT: MessageRepository clears streaming=1 rows left by a crash/restart.
// WHY:  A turn persisted with streaming=1 whose process died before the flag
//       flipped would re-render as a perpetual cursor with no live adapter,
//       locking the composer. The repo must reset these on construction and
//       append an interrupted marker exactly once (idempotent across boots).
// SEE:  packages/server-core/src/repositories/message-repo.ts

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MessageRepository } from '../src/repositories/message-repo';

function makeDb(): Database {
  const db = new Database(':memory:');
  // Minimal messages table (no FK to threads — standalone repo test).
  db.run(`CREATE TABLE messages (
    id TEXT PRIMARY KEY,
    thread_id TEXT NOT NULL,
    role TEXT NOT NULL,
    text TEXT NOT NULL,
    turn_id TEXT,
    streaming INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    sequence INTEGER NOT NULL
  )`);
  return db;
}

function seed(db: Database, row: { id: string; role: string; text: string; streaming: number; seq: number }) {
  db.run(
    'INSERT INTO messages (id, thread_id, role, text, turn_id, streaming, created_at, sequence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [row.id, 't1', row.role, row.text, null, row.streaming, Date.parse('2026-06-18T00:00:00Z'), row.seq],
  );
}

test('boot reconciliation clears streaming=1 assistant rows and appends marker once', () => {
  const db = makeDb();
  seed(db, { id: 'm1', role: 'assistant', text: 'partial answer', streaming: 1, seq: 1 });
  seed(db, { id: 'm2', role: 'assistant', text: 'finished answer', streaming: 0, seq: 2 });
  seed(db, { id: 'm3', role: 'user', text: 'a question', streaming: 0, seq: 3 });

  // Construction triggers reconcileStreamingOnBoot.
  new MessageRepository(db);

  const rows = db.query('SELECT id, text, streaming FROM messages ORDER BY sequence').all() as any[];
  const m1 = rows.find((r) => r.id === 'm1');
  const m2 = rows.find((r) => r.id === 'm2');

  // Ghost row: flag cleared, marker appended.
  expect(m1.streaming).toBe(0);
  expect(m1.text).toContain('partial answer');
  expect(m1.text).toContain('this turn was interrupted');
  // Untouched rows stay as-is.
  expect(m2.text).toBe('finished answer');
});

test('boot reconciliation is idempotent — marker not duplicated across restarts', () => {
  const db = makeDb();
  seed(db, { id: 'm1', role: 'assistant', text: 'partial', streaming: 1, seq: 1 });

  new MessageRepository(db); // first boot
  const afterFirst = (db.query('SELECT text FROM messages WHERE id = ?').get('m1') as any).text;

  // Simulate a SECOND restart over the already-reconciled DB.
  new MessageRepository(db);
  const afterSecond = (db.query('SELECT text FROM messages WHERE id = ?').get('m1') as any).text;

  expect(afterFirst).toBe(afterSecond); // no second marker
  const markerCount = afterSecond.split('this turn was interrupted').length - 1;
  expect(markerCount).toBe(1);
});

test('boot reconciliation leaves a clean DB untouched', () => {
  const db = makeDb();
  seed(db, { id: 'm1', role: 'assistant', text: 'done', streaming: 0, seq: 1 });
  new MessageRepository(db);
  const m1 = db.query('SELECT text, streaming FROM messages WHERE id = ?').get('m1') as any;
  expect(m1.streaming).toBe(0);
  expect(m1.text).toBe('done');
});
