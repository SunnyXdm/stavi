// ============================================================
// repositories/session-repo.ts — Sessions persistence
// ============================================================
// WHAT: CRUD for Session rows in SQLite.
// WHY:  Sessions are now a first-class server object.
// HOW:  Synchronous bun:sqlite queries returning plain objects.
// SEE:  db/index.ts, types.ts

import type { Database } from 'bun:sqlite';
import type { AgentRuntime, Session, SessionStatus } from '../types';

function parseMetadata(raw: string | null): Record<string, unknown> | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function toSession(row: any): Session {
  return {
    id: row.id,
    serverId: row.server_id,
    folder: row.folder,
    title: row.title,
    agentRuntime: row.agent_runtime,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastActiveAt: row.last_active_at,
    metadata: parseMetadata(row.metadata),
  };
}

export class SessionRepository {
  constructor(private db: Database, private serverId: string) {}

  createSession(input: { folder: string; title: string; agentRuntime: AgentRuntime }): Session {
    const now = Date.now();
    const id = `sess-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const row = {
      id,
      server_id: this.serverId,
      folder: input.folder,
      title: input.title,
      agent_runtime: input.agentRuntime,
      status: 'idle',
      created_at: now,
      updated_at: now,
      last_active_at: now,
      metadata: null as string | null,
    };
    this.db.query(
      'INSERT INTO sessions (id, server_id, folder, title, agent_runtime, status, created_at, updated_at, last_active_at, metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      row.id,
      row.server_id,
      row.folder,
      row.title,
      row.agent_runtime,
      row.status,
      row.created_at,
      row.updated_at,
      row.last_active_at,
      row.metadata,
    );
    return toSession(row);
  }

  listSessions(opts?: { includeArchived?: boolean }): Session[] {
    const includeArchived = opts?.includeArchived ?? false;
    const rows = includeArchived
      ? this.db.query('SELECT * FROM sessions WHERE server_id = ? ORDER BY last_active_at DESC').all(this.serverId)
      : this.db.query('SELECT * FROM sessions WHERE server_id = ? AND status != ? ORDER BY last_active_at DESC').all(this.serverId, 'archived');
    return rows.map(toSession);
  }

  getSession(id: string): Session | undefined {
    const row = this.db.query('SELECT * FROM sessions WHERE id = ? AND server_id = ?').get(id, this.serverId) as any;
    if (!row) return undefined;
    return toSession(row);
  }

  updateSession(id: string, patch: Partial<Pick<Session, 'title' | 'status' | 'metadata' | 'lastActiveAt'>>): Session {
    const current = this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);

    const next: Session = {
      ...current,
      ...('title' in patch ? { title: patch.title! } : {}),
      ...('status' in patch ? { status: patch.status as SessionStatus } : {}),
      ...('metadata' in patch ? { metadata: patch.metadata } : {}),
      ...('lastActiveAt' in patch ? { lastActiveAt: patch.lastActiveAt! } : {}),
      updatedAt: Date.now(),
    };

    this.db.query(
      'UPDATE sessions SET title = ?, status = ?, metadata = ?, updated_at = ?, last_active_at = ? WHERE id = ? AND server_id = ?',
    ).run(
      next.title,
      next.status,
      next.metadata ? JSON.stringify(next.metadata) : null,
      next.updatedAt,
      next.lastActiveAt,
      id,
      this.serverId,
    );

    return next;
  }

  archiveSession(id: string): void {
    this.updateSession(id, { status: 'archived' });
  }

  deleteSession(id: string): void {
    this.db.query('DELETE FROM sessions WHERE id = ? AND server_id = ?').run(id, this.serverId);
  }

  touchSession(id: string, status?: SessionStatus): void {
    const now = Date.now();
    const current = this.getSession(id);
    if (!current) throw new Error(`Session not found: ${id}`);
    const nextStatus = status ?? current.status;
    this.db.query(
      'UPDATE sessions SET status = ?, last_active_at = ?, updated_at = ? WHERE id = ? AND server_id = ?',
    ).run(nextStatus, now, now, id, this.serverId);
  }
}
