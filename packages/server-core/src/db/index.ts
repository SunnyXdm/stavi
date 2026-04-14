// ============================================================
// db/index.ts — SQLite entry point
// ============================================================
// WHAT: Opens ~/.stavi/userdata/stavi.db and runs migrations.
// WHY:  Phase 1 persistence layer for Sessions/Threads/Messages.
// HOW:  bun:sqlite Database + forward-only migration runner.
// SEE:  db/migrations/runner.ts

import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { runMigrations } from './migrations/runner';

export function openDatabase(baseDir: string): Database {
  const path = join(baseDir, 'userdata', 'stavi.db');
  const db = new Database(path, { create: true });
  runMigrations(db, join(import.meta.dir, 'migrations'));
  return db;
}
