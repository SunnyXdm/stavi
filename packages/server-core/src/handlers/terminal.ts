// ============================================================
// handlers/terminal.ts — terminal.* RPCs + subscribeTerminalEvents
// Phase C1: adds server-side VT parsing ('cells' mode) alongside the
// existing raw byte-stream mode. Raw mode is unchanged; WebView clients
// using xterm.js continue to work with no code changes.
// ============================================================

import type { ServerContext, RpcHandler } from '../context';
import type { TerminalFrame, TerminalSubscribeMode } from '@stavi/shared';
import {
  createVtSession,
  emitFullFrame,
  resizeVt,
} from '../terminal-vt';

function parseMode(value: unknown): TerminalSubscribeMode {
  return value === 'cells' ? 'cells' : 'raw';
}

/**
 * Lazily attach a headless xterm to a session on the first `cells`-mode
 * subscription. Subsequent pty chunks automatically flow through the VT
 * (see process-spawn.ts data() callback).
 */
function ensureVt(
  ctx: ServerContext,
  session: import('../types').TerminalSession,
): NonNullable<import('../types').TerminalSession['vt']> {
  if (session.vt) return session.vt;
  // Derive dims from the pty if exposed; fall back to 80x24.
  const cols = (session.proc?.terminal?.cols as number | undefined) ?? 80;
  const rows = (session.proc?.terminal?.rows as number | undefined) ?? 24;
  const vt = createVtSession(cols, rows, (frame: TerminalFrame) => {
    ctx.emitTerminalEvent({
      type: 'frame',
      mode: 'cells',
      threadId: session.threadId,
      terminalId: session.terminalId,
      frame,
    });
  });
  // Seed the VT with any already-captured history so new cells clients
  // see context, not a blank buffer.
  if (session.history) {
    try {
      vt.term.write(session.history);
    } catch {
      /* ignore replay errors */
    }
  }
  session.vt = vt;
  return vt;
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
      // Phase C1: optional mode hint on open — purely informational at
      // open-time; the real mode is bound on subscribeTerminalEvents.
      // Accepted for forward-compat with clients that want to pre-warm
      // the VT buffer. Default 'raw' preserves existing behavior.
      const mode = parseMode(payload.mode);
      const session = ctx.createTerminalSession(threadId, terminalId, cwd, cols, rows);
      if (mode === 'cells') {
        // Pre-warm so the first frame isn't empty.
        ensureVt(ctx, session);
      }
      sendJson(ws, makeSuccess(id, {
        threadId,
        terminalId,
        history: session.history,
        status: session.status,
        mode,
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
      // Phase C1: mirror resize onto the VT and push a full-snapshot
      // frame so `cells` subscribers can reset their grids.
      if (session?.vt) {
        resizeVt(session.vt, cols, rows);
        const frame = emitFullFrame(session.vt);
        ctx.emitTerminalEvent({
          type: 'frame',
          mode: 'cells',
          threadId,
          terminalId,
          frame,
        });
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
        // Best-effort dispose of the headless VT if attached.
        try { session.vt?.term.dispose(); } catch { /* ignore */ }
        ctx.terminalSessions.delete(key);
      }
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    // subscribeTerminalEvents — filters output to a specific (threadId, optional terminalId).
    // If threadId is omitted, the subscription receives nothing and a warning is logged —
    // there is no fallback to global broadcast.
    //
    // Phase C1: accepts `mode: 'raw' | 'cells'` (default 'raw'). Raw
    // subscribers receive `{type:'output', data: string}` events (existing
    // shape); cells subscribers receive `{type:'frame', frame:
    // TerminalFrame}` events. The first cells frame for any subscriber is
    // marked `full: true` so clients can initialize their grid.
    'subscribeTerminalEvents': async (ws, id, payload) => {
      const threadId = typeof payload.threadId === 'string' ? payload.threadId.trim() : '';
      const terminalId = typeof payload.terminalId === 'string' ? payload.terminalId.trim() : undefined;
      const mode = parseMode(payload.mode);

      if (!threadId) {
        console.warn(`[terminal] subscribeTerminalEvents called without threadId (requestId=${id}); no events will be emitted`);
      }

      ctx.terminalSubscriptions.set(id, {
        ws,
        requestId: id,
        tag: 'subscribeTerminalEvents',
        threadId: threadId || undefined,
        terminalId,
        mode,
      });
      ctx.addConnectionSubscription(ws, id);
      sendJson(ws, makeChunk(id, []));

      // Phase C1: for cells-mode subscribers, attach VT (if needed) and
      // send an initial full-snapshot frame so the client can render
      // immediately without waiting for the next pty write.
      if (mode === 'cells' && threadId) {
        // Match any terminalId for this thread if client didn't specify one.
        for (const [, session] of ctx.terminalSessions) {
          if (session.threadId !== threadId) continue;
          if (terminalId && session.terminalId !== terminalId) continue;
          const vt = ensureVt(ctx, session);
          const frame = emitFullFrame(vt);
          sendJson(ws, makeChunk(id, [{
            type: 'frame',
            mode: 'cells',
            threadId: session.threadId,
            terminalId: session.terminalId,
            frame,
          }]));
        }
      }
    },
  };
}
