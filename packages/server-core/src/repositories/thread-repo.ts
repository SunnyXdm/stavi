// ============================================================
// repositories/thread-repo.ts — Threads persistence
// ============================================================
// WHAT: CRUD for Threads with session_id foreign key.
// WHY:  Threads are now persisted and attached to Sessions.
// HOW:  bun:sqlite queries returning OrchestrationThread objects.
// SEE:  db/index.ts, types.ts

import type { Database } from 'bun:sqlite';
import type { OrchestrationThread } from '../types';

function parseModelSelection(raw: string | null): OrchestrationThread['modelSelection'] {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as OrchestrationThread['modelSelection'];
  } catch {
    return undefined;
  }
}

function toThread(row: any): OrchestrationThread {
  return {
    threadId: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    title: row.title,
    runtimeMode: row.runtime_mode,
    interactionMode: row.interaction_mode,
    branch: row.branch,
    worktreePath: row.worktree_path,
    agentRuntime: row.agent_runtime ?? undefined,
    modelSelection: parseModelSelection(row.model_selection),
    archived: !!row.archived,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export class ThreadRepository {
  constructor(private db: Database) {}

  createThread(input: {
    sessionId: string;
    thread: OrchestrationThread;
  }): OrchestrationThread {
    const t = input.thread;
    const createdAtMs = Date.parse(t.createdAt);
    const updatedAtMs = Date.parse(t.updatedAt);
    this.db.query(
      'INSERT INTO threads (id, session_id, project_id, title, runtime_mode, interaction_mode, branch, worktree_path, model_selection, agent_runtime, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      t.threadId,
      input.sessionId,
      t.projectId,
      t.title,
      t.runtimeMode,
      t.interactionMode,
      t.branch,
      t.worktreePath,
      t.modelSelection ? JSON.stringify(t.modelSelection) : null,
      t.agentRuntime ?? null,
      t.archived ? 1 : 0,
      Number.isNaN(createdAtMs) ? Date.now() : createdAtMs,
      Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs,
    );
    return t;
  }

  listThreadsForSession(sessionId: string): OrchestrationThread[] {
    const rows = this.db.query('SELECT * FROM threads WHERE session_id = ? ORDER BY created_at ASC').all(sessionId);
    return rows.map(toThread);
  }

  listAll(): OrchestrationThread[] {
    const rows = this.db.query('SELECT * FROM threads ORDER BY created_at ASC').all();
    return rows.map(toThread);
  }

  getThread(id: string): OrchestrationThread | undefined {
    const row = this.db.query('SELECT * FROM threads WHERE id = ?').get(id) as any;
    if (!row) return undefined;
    return toThread(row);
  }

  updateThread(id: string, patch: Partial<OrchestrationThread>): OrchestrationThread {
    const current = this.getThread(id);
    if (!current) throw new Error(`Thread not found: ${id}`);
    const next: OrchestrationThread = { ...current, ...patch, updatedAt: new Date().toISOString() };
    const updatedAtMs = Date.parse(next.updatedAt);
    this.db.query(
      'UPDATE threads SET title = ?, runtime_mode = ?, interaction_mode = ?, branch = ?, worktree_path = ?, model_selection = ?, agent_runtime = ?, archived = ?, updated_at = ? WHERE id = ?',
    ).run(
      next.title,
      next.runtimeMode,
      next.interactionMode,
      next.branch,
      next.worktreePath,
      next.modelSelection ? JSON.stringify(next.modelSelection) : null,
      next.agentRuntime ?? null,
      next.archived ? 1 : 0,
      Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs,
      id,
    );
    return next;
  }

  deleteThread(id: string): void {
    this.db.query('DELETE FROM threads WHERE id = ?').run(id);
  }
}
