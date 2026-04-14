// ============================================================
// handlers/process.ts — process.* RPCs + subscribeProcessEvents
// ============================================================

import type { ServerContext, RpcHandler } from '../context';

export function createProcessHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'process.spawn': async (ws, id, payload) => {
      const command = String(payload.command ?? '').trim();
      if (!command) {
        sendJson(ws, makeFailure(id, 'command is required'));
        return;
      }
      const args = Array.isArray(payload.args)
        ? (payload.args as string[]).filter((a) => typeof a === 'string' && a.trim())
        : typeof payload.args === 'string' && payload.args.trim()
        ? payload.args.trim().split(/\s+/)
        : [];
      const cwd = String(payload.cwd ?? '.');
      try {
        const proc = ctx.spawnManagedProcess(command, args, cwd);
        sendJson(ws, makeSuccess(id, ctx.serializeManagedProcess(proc)));
      } catch (err: any) {
        sendJson(ws, makeFailure(id, err?.message ?? 'Failed to spawn process'));
      }
    },

    'process.kill': async (ws, id, payload) => {
      const procId = String(payload.id ?? '');
      const managed = ctx.managedProcesses.get(procId);
      if (!managed) {
        sendJson(ws, makeFailure(id, `Process not found: ${procId}`));
        return;
      }
      try {
        managed.proc?.kill('SIGTERM');
        ctx.managedProcesses.delete(procId);
        ctx.emitProcessEvent({ type: 'killed', id: procId });
        sendJson(ws, makeSuccess(id, { ok: true }));
      } catch (err: any) {
        sendJson(ws, makeFailure(id, err?.message ?? 'Failed to kill process'));
      }
    },

    'process.list': async (ws, id) => {
      const list = Array.from(ctx.managedProcesses.values()).map(ctx.serializeManagedProcess);
      sendJson(ws, makeSuccess(id, { processes: list }));
    },

    'process.clearOutput': async (ws, id, payload) => {
      const procId = String(payload.id ?? '');
      const managed = ctx.managedProcesses.get(procId);
      if (managed) {
        managed.output = '';
        ctx.emitProcessEvent({ type: 'outputCleared', id: procId });
      }
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'process.remove': async (ws, id, payload) => {
      const procId = String(payload.id ?? '');
      const managed = ctx.managedProcesses.get(procId);
      if (managed && managed.status === 'running') {
        managed.proc?.kill('SIGTERM');
      }
      ctx.managedProcesses.delete(procId);
      ctx.emitProcessEvent({ type: 'removed', id: procId });
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'subscribeProcessEvents': async (ws, id) => {
      ctx.processSubscriptions.set(id, { ws, requestId: id, tag: 'subscribeProcessEvents' });
      ctx.addConnectionSubscription(ws, id);
      const snapshot = Array.from(ctx.managedProcesses.values()).map(ctx.serializeManagedProcess);
      sendJson(ws, makeChunk(id, snapshot.map((p) => ({ type: 'snapshot', process: p }))));
    },
  };
}
