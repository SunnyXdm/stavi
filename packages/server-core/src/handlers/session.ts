// ============================================================
// handlers/session.ts — session.* RPC handlers + subscribeSessions
// ============================================================
// WHAT: Session CRUD + subscription stream.
// WHY:  Sessions are persisted and need RPC access.
// HOW:  Calls repositories; broadcasts updates to subscribers.
//       Phase 5: belt-and-suspenders serverId validation on all session reads.
// SEE:  repositories/session-repo.ts, repositories/thread-repo.ts

import type { ServerContext, RpcHandler } from '../context';
import type { AgentRuntime } from '@stavi/shared';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, normalize, resolve, sep } from 'node:path';

/**
 * Resolve + validate a session folder. Accepts:
 *   - "~" / "~/x"  → expanded against the user's home
 *   - absolute     → must live under home
 *   - relative     → resolved against workspaceRoot (legacy behavior)
 * The folder must exist and be a directory — creating sessions for missing
 * folders is how the misleading "binary not found" spawn failures happened.
 * Returns the normalized ABSOLUTE path, or an error string.
 */
export function resolveSessionFolder(
  workspaceRoot: string,
  rawFolder: string,
): { ok: true; folder: string } | { ok: false; error: string } {
  const home = normalize(homedir());
  let abs: string;
  if (rawFolder === '~') {
    abs = home;
  } else if (rawFolder.startsWith('~/') || rawFolder.startsWith('~\\')) {
    abs = normalize(join(home, rawFolder.slice(2)));
  } else if (isAbsolute(rawFolder)) {
    abs = normalize(rawFolder);
  } else {
    abs = normalize(resolve(workspaceRoot, rawFolder));
  }

  const underHome = abs === home || abs.startsWith(home + sep);
  const underWorkspace = abs === workspaceRoot || abs.startsWith(workspaceRoot + sep);
  if (!underHome && !underWorkspace) {
    return { ok: false, error: 'Folder must be inside your home directory' };
  }
  if (!existsSync(abs) || !statSync(abs).isDirectory()) {
    return { ok: false, error: `Folder does not exist on this server: ${abs}` };
  }
  return { ok: true, folder: abs };
}

function broadcastSessions(
  ctx: ServerContext,
  event: { type: 'created' | 'updated' | 'archived' | 'deleted'; session: any },
) {
  for (const sub of ctx.sessionSubscriptions.values()) {
    ctx.sendJson(sub.ws, ctx.makeChunk(sub.requestId, [event]));
  }
}

export function createSessionHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'session.create': async (ws, id, payload) => {
      const rawFolder = String(payload.folder ?? '').trim();
      if (!rawFolder) {
        sendJson(ws, makeFailure(id, 'folder is required'));
        return;
      }
      const resolved = resolveSessionFolder(ctx.workspaceRoot, rawFolder);
      if (!resolved.ok) {
        sendJson(ws, makeFailure(id, resolved.error));
        return;
      }
      const title = String(payload.title ?? '').trim() || 'Workspace';
      const agentRuntime = (payload.agentRuntime as AgentRuntime | undefined) ?? 'claude';

      const session = ctx.sessionRepo.createSession({ folder: resolved.folder, title, agentRuntime });

      sendJson(ws, makeSuccess(id, session));
      broadcastSessions(ctx, { type: 'created', session });
    },

    'session.list': async (ws, id, payload) => {
      const includeArchived = payload.includeArchived === true;
      const sessions = ctx.sessionRepo.listSessions({ includeArchived });
      sendJson(ws, makeSuccess(id, { sessions }));
    },

    'session.get': async (ws, id, payload) => {
      const sessionId = String(payload.sessionId ?? '');
      if (!sessionId) {
        sendJson(ws, makeFailure(id, 'sessionId is required'));
        return;
      }
      const session = ctx.sessionRepo.getSession(sessionId);
      if (!session) {
        sendJson(ws, makeFailure(id, `Session not found: ${sessionId}`));
        return;
      }
      // Phase 5: belt-and-suspenders — each server only holds its own sessions.
      if (session.serverId && session.serverId !== ctx.serverId) {
        sendJson(ws, makeFailure(id, `Session ${sessionId} belongs to a different server`));
        return;
      }
      const threads = ctx.threadRepo.listThreadsForSession(sessionId);
      sendJson(ws, makeSuccess(id, { session, threads }));
    },

    'session.rename': async (ws, id, payload) => {
      const sessionId = String(payload.sessionId ?? '');
      const title = String(payload.title ?? '').trim();
      if (!sessionId) {
        sendJson(ws, makeFailure(id, 'sessionId is required'));
        return;
      }
      if (!title) {
        sendJson(ws, makeFailure(id, 'title is required'));
        return;
      }
      const session = ctx.sessionRepo.updateSession(sessionId, { title });
      sendJson(ws, makeSuccess(id, { session }));
      broadcastSessions(ctx, { type: 'updated', session });
    },

    'session.archive': async (ws, id, payload) => {
      const sessionId = String(payload.sessionId ?? '');
      if (!sessionId) {
        sendJson(ws, makeFailure(id, 'sessionId is required'));
        return;
      }
      ctx.sessionRepo.archiveSession(sessionId);
      const session = ctx.sessionRepo.getSession(sessionId);
      if (session) broadcastSessions(ctx, { type: 'archived', session });
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'session.delete': async (ws, id, payload) => {
      const sessionId = String(payload.sessionId ?? '');
      if (!sessionId) {
        sendJson(ws, makeFailure(id, 'sessionId is required'));
        return;
      }
      const session = ctx.sessionRepo.getSession(sessionId);
      ctx.sessionRepo.deleteSession(sessionId);
      if (session) broadcastSessions(ctx, { type: 'deleted', session });
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'session.touch': async (ws, id, payload) => {
      const sessionId = String(payload.sessionId ?? '');
      if (!sessionId) {
        sendJson(ws, makeFailure(id, 'sessionId is required'));
        return;
      }
      ctx.sessionRepo.touchSession(sessionId);
      const session = ctx.sessionRepo.getSession(sessionId);
      if (session) broadcastSessions(ctx, { type: 'updated', session });
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'subscribeSessions': async (ws, id) => {
      ctx.sessionSubscriptions.set(id, { ws, requestId: id, tag: 'subscribeSessions' });
      ctx.addConnectionSubscription(ws, id);
      sendJson(ws, makeChunk(id, []));
    },
  };
}
