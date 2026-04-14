// ============================================================
// db/migrations/runner.ts — Forward-only migration runner
// ============================================================
// WHAT: Runs SQL migrations in order and records them in _migrations.
// WHY:  Persisted Sessions/Threads/Messages must be created on boot.
// HOW:  Scans migrations/*.sql, sorts by version prefix, applies new ones.
// SEE:  db/index.ts, db/migrations/0001_initial.sql

import { readdirSync, readFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { Database } from 'bun:sqlite';

interface Migration {
  version: number;
  path: string;
  sql: string;
}

function parseVersion(fileName: string): number {
  const match = fileName.match(/^(\d+)/);
  if (!match) return 0;
  return Number.parseInt(match[1], 10);
}

export function runMigrations(db: Database, migrationsDir: string): void {
  // Ensure _migrations exists before reading from it.
  db.exec('CREATE TABLE IF NOT EXISTS _migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');

  const rows = db.query('SELECT version FROM _migrations ORDER BY version ASC').all() as Array<{ version: number }>;
  const applied = new Set(rows.map((r) => r.version));

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith('.sql'))
    .map((f) => ({
      version: parseVersion(f),
      path: join(migrationsDir, f),
    }))
    .filter((m) => m.version > 0)
    .sort((a, b) => a.version - b.version);

  const migrations: Migration[] = files.map((m) => ({
    version: m.version,
    path: m.path,
    sql: readFileSync(m.path, 'utf-8'),
  }));

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    db.exec(migration.sql);
    db.query('INSERT INTO _migrations (version, applied_at) VALUES (?, ?)')
      .run(migration.version, Date.now());
  }
}
