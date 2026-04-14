// ============================================================
// handlers/orchestration/index.ts — orchestration.* RPC handlers
// ============================================================
// Routes orchestration.dispatchCommand sub-types and manages
// thread/snapshot state. The heavy streaming logic lives in turn-start.ts.

import type { ServerContext, RpcHandler } from '../../context';
import { nowIso } from '../../utils';
import { handleTurnStart } from './turn-start';

export function createOrchestrationHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { threads, messages, sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'orchestration.getSnapshot': async (ws, id) => {
      sendJson(ws, makeSuccess(id, await ctx.getSnapshot()));
    },

    'orchestration.dispatchCommand': async (ws, id, payload) => {
      const command = payload.command as Record<string, unknown>;
      const type = String(command?.type ?? '');
      const threadId = String(command?.threadId || '');

      if (type === 'thread.create') {
        if (!threadId) {
          sendJson(ws, makeFailure(id, 'threadId is required'));
          return;
        }
        const thread = ctx.buildThreadFromCommand(threadId, command);
        threads.set(threadId, thread);
        if (!messages.has(threadId)) messages.set(threadId, []);
        ctx.broadcastOrchestrationEvent({
          type: 'thread.created',
          occurredAt: nowIso(),
          payload: thread,
        });
        sendJson(ws, makeSuccess(id, { thread }));
        return;
      }

      if (type === 'thread.turn.start') {
        if (!threadId) {
          sendJson(ws, makeFailure(id, 'threadId is required'));
          return;
        }
        const thread = ctx.buildThreadFromCommand(threadId, command, threads.get(threadId));
        // handleTurnStart fires async and returns immediately — we send success below
        void handleTurnStart(ws, id, command, thread, ctx);
        sendJson(ws, makeSuccess(id, { ok: true }));
        return;
      }

      if (type === 'thread.turn.interrupt') {
        if (!threadId) {
          sendJson(ws, makeFailure(id, 'threadId is required'));
          return;
        }
        const activeKind = ctx.activeTurnAdapters.get(threadId);
        const adapter = activeKind
          ? ctx.providerRegistry.getAdapter(activeKind as any)
          : ctx.providerRegistry.getDefaultAdapter();
        if (adapter) void adapter.interruptTurn(threadId);
        sendJson(ws, makeSuccess(id, { ok: true }));
        return;
      }

      if (type === 'thread.approval.respond') {
        if (!threadId) {
          sendJson(ws, makeFailure(id, 'threadId is required'));
          return;
        }
        const requestId = String(command.requestId ?? '');
        const rawDecision = String(command.decision ?? 'accept');
        let decision: import('../../providers/types').ApprovalDecision = 'accept';
        if (rawDecision === 'acceptForSession' || rawDecision === 'always-allow') {
          decision = 'always-allow';
        } else if (rawDecision === 'decline' || rawDecision === 'reject') {
          decision = 'reject';
        }
        const providerKind = (command.provider as string | undefined) ?? ctx.activeTurnAdapters.get(threadId);
        const adapter = providerKind
          ? ctx.providerRegistry.getAdapter(providerKind as any)
          : ctx.providerRegistry.getDefaultAdapter();
        if (adapter && requestId) void adapter.respondToApproval(threadId, requestId, decision);
        sendJson(ws, makeSuccess(id, { ok: true }));
        return;
      }

      // Unknown command type — still send ok (legacy behaviour)
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'subscribeOrchestrationDomainEvents': async (ws, id) => {
      ctx.orchestrationSubscriptions.set(id, {
        ws,
        requestId: id,
        tag: 'subscribeOrchestrationDomainEvents',
      });
      ctx.addConnectionSubscription(ws, id);
      sendJson(ws, makeChunk(id, []));
    },
  };
}
