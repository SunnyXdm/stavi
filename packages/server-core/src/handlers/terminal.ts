// ============================================================
// handlers/terminal.ts — terminal.* RPCs + subscribeTerminalEvents
// ============================================================

import type { ServerContext, RpcHandler } from '../context';

export function createTerminalHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'terminal.open': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
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
      const data = String(payload.data ?? '');
      const session = ctx.terminalSessions.get(`${threadId}:${terminalId}`);
      if (!session) {
        sendJson(ws, makeFailure(id, `Terminal not found: ${threadId}`));
        return;
      }
      session.proc.terminal?.write(data);
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'terminal.resize': async (ws, id, payload) => {
      const threadId = String(payload.threadId ?? '');
      const terminalId = String(payload.terminalId ?? 'default');
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
      const key = `${threadId}:${terminalId}`;
      const session = ctx.terminalSessions.get(key);
      if (session) {
        session.proc.kill('SIGTERM');
        ctx.terminalSessions.delete(key);
      }
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'subscribeTerminalEvents': async (ws, id) => {
      ctx.terminalSubscriptions.set(id, { ws, requestId: id, tag: 'subscribeTerminalEvents' });
      ctx.addConnectionSubscription(ws, id);
      sendJson(ws, makeChunk(id, []));
    },
  };
}
