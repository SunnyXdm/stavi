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
      const folder = String(payload.folder ?? '').trim();
      if (!folder) {
        sendJson(ws, makeFailure(id, 'folder is required'));
        return;
      }
      const title = String(payload.title ?? '').trim() || 'Workspace';
      const agentRuntime = (payload.agentRuntime as AgentRuntime | undefined) ?? 'claude';

      const session = ctx.sessionRepo.createSession({ folder, title, agentRuntime });

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
