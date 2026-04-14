// ============================================================
// handlers/terminal.ts — terminal.* RPCs + subscribeTerminalEvents
// ============================================================

import type { ServerContext, RpcHandler } from '../context';

/** Require a non-empty threadId; throws if missing so the caller returns Exit.Failure. */
function requireThreadId(threadId: string, tag: string): void {
  if (!threadId) throw new Error(`threadId is required for ${tag}`);
}

export function createTerminalHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'terminal.open': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
      if (!threadId) {
        sendJson(ws, makeFailure(id, 'threadId is required'));
        return;
      }
      const cwd = String(payload.cwd ?? '.');
      const cols = payload.cols ? Number(payload.cols) : undefined;
      const rows = payload.rows ? Number(payload.rows) : undefined;
      const session = ctx.createTerminalSession(threadId, terminalId, cwd, cols, rows);
      sendJson(ws, makeSuccess(id, {
        threadId,
        terminalId,
        history: session.history,
        status: session.status,
      }));
    },

    'terminal.write': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
      if (!threadId) {
        sendJson(ws, makeFailure(id, 'threadId is required'));
        return;
      }
      const data = String(payload.data ?? '');
      const session = ctx.terminalSessions.get(`${threadId}:${terminalId}`);
      if (!session) {
        sendJson(ws, makeFailure(id, `Terminal not found: ${threadId}:${terminalId}`));
        return;
      }
      session.proc.terminal?.write(data);
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'terminal.resize': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
      if (!threadId) {
        sendJson(ws, makeFailure(id, 'threadId is required'));
        return;
      }
      const cols = Number(payload.cols ?? 80);
      const rows = Number(payload.rows ?? 24);
      const session = ctx.terminalSessions.get(`${threadId}:${terminalId}`);
      if (session?.proc.terminal) {
        session.proc.terminal.resize(cols, rows);
      }
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'terminal.close': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
      if (!threadId) {
        sendJson(ws, makeFailure(id, 'threadId is required'));
        return;
      }
      const key = `${threadId}:${terminalId}`;
      const session = ctx.terminalSessions.get(key);
      if (session) {
        session.proc.kill('SIGTERM');
        ctx.terminalSessions.delete(key);
      }
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    // subscribeTerminalEvents — filters output to a specific (threadId, optional terminalId).
    // If threadId is omitted, the subscription receives nothing and a warning is logged —
    // there is no fallback to global broadcast.
    'subscribeTerminalEvents': async (ws, id, payload) => {
      const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
      const terminalId = typeof payload.terminalId === 'string' ? payload.terminalId.trim() : undefined;

      if (!threadId) {
        console.warn(`[terminal] subscribeTerminalEvents called without threadId (requestId=${id}); no events will be emitted`);
      }

      ctx.terminalSubscriptions.set(id, {
        ws,
        requestId: id,
        tag: 'subscribeTerminalEvents',
        threadId: threadId || undefined,
        terminalId,
      });
      ctx.addConnectionSubscription(ws, id);
      sendJson(ws, makeChunk(id, []));
    },
  };
}
