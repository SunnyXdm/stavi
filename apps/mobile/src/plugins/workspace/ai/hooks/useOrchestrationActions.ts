// ============================================================
// hooks/useOrchestrationActions.ts — RPC action callbacks for orchestration
// ============================================================

import { useCallback } from 'react';
import { useConnectionStore } from '../../../../stores/connection';
import { useAiBindingsStore } from '../../../../stores/ai-bindings-store';
import { logEvent } from '../../../../services/telemetry';
import type { OrchestrationState, Thread } from '../useOrchestration';

function getOrchestrationClient(serverId: string) {
  return useConnectionStore.getState().getClientForServer(serverId);
}

interface ActionDeps {
  serverId: string;
  sessionId: string;
  setState: React.Dispatch<React.SetStateAction<OrchestrationState>>;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  instanceId: string | undefined;
  ensureActiveThread: (agentRuntime?: 'claude' | 'codex') => Promise<string>;
  resolveThreadModelSelection: () => NonNullable<Thread['modelSelection']>;
}

export function useOrchestrationActions({
  serverId,
  sessionId,
  setState,
  activeThreadIdRef,
  instanceId,
  ensureActiveThread,
  resolveThreadModelSelection,
}: ActionDeps) {
  const sendMessage = useCallback(
    async (
      text: string,
      threadId?: string,
      options?: {
        modelSelection?: Thread['modelSelection'];
        interactionMode?: 'default' | 'plan';
        accessLevel?: string;
        /** Phase 8c: provider to use for this chat (written to thread on first create) */
        agentRuntime?: 'claude' | 'codex';
      },
    ) => {
      const tid = threadId || (await ensureActiveThread(options?.agentRuntime));
      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const modelSel = options?.modelSelection ?? resolveThreadModelSelection();
      const runtimeMode =
        options?.accessLevel === 'full-access'
          ? 'full-access'
          : options?.accessLevel === 'auto-accept'
          ? 'auto-accept-edits'
          : 'approval-required';

      setState((prev) => {
        const existing = prev.messages.get(tid) || [];
        const updated = new Map(prev.messages);
        const createdAt = new Date().toISOString();
        updated.set(tid, [
          ...existing,
          { messageId, threadId: tid, role: 'user' as const, text, streaming: false, createdAt },
        ]);
        const existingAI = prev.aiMessages.get(tid) ?? [];
        const updatedAI = new Map(prev.aiMessages);
        updatedAI.set(tid, [
          ...existingAI,
          {
            messageId,
            threadId: tid,
            role: 'user' as const,
            parts: [{ type: 'text' as const, text }],
            streaming: false,
            createdAt,
            localStatus: 'sending' as const,
          },
        ]);
        const updatedThreads = prev.threads.map((thread) =>
          thread.threadId === tid
            ? {
                ...thread,
                runtimeMode: runtimeMode as Thread['runtimeMode'],
                interactionMode: options?.interactionMode ?? 'default',
                modelSelection: modelSel,
                updatedAt: createdAt,
              }
            : thread,
        );
        return { ...prev, messages: updated, aiMessages: updatedAI, threads: updatedThreads };
      });

      await getOrchestrationClient(serverId)?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.start',
          commandId,
          threadId: tid,
          message: { messageId, role: 'user', text, attachments: [] },
          modelSelection: modelSel,
          runtimeMode,
          interactionMode: options?.interactionMode ?? 'default',
          createdAt: new Date().toISOString(),
        },
      });

      logEvent('ai.send', { sessionId, serverId, threadId: tid, provider: modelSel?.provider });
      return { threadId: tid, turnId: commandId };
    },
    [ensureActiveThread, resolveThreadModelSelection, serverId, setState],
  );

  const interruptTurn = useCallback(async (threadId?: string) => {
    const tid = threadId || activeThreadIdRef.current;
    if (!tid) return;
    await getOrchestrationClient(serverId)?.request('orchestration.dispatchCommand', {
      command: {
        type: 'thread.turn.interrupt',
        commandId: `cmd-${Date.now()}`,
        threadId: tid,
        createdAt: new Date().toISOString(),
      },
    });
  }, [activeThreadIdRef, serverId]);

  const respondToApproval = useCallback(
    async (threadId: string, requestId: string, decision: 'accept' | 'reject' | 'always-allow') => {
      setState((prev) => {
        const existing = prev.approvals.get(threadId) || [];
        const updated = new Map(prev.approvals);
        updated.set(threadId, existing.map((a) => a.requestId === requestId ? { ...a, pending: false } : a));
        return { ...prev, approvals: updated };
      });
      await getOrchestrationClient(serverId)?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.approval.respond',
          commandId: `cmd-${Date.now()}`,
          threadId,
          requestId,
          decision: decision === 'always-allow' ? 'always-allow' : decision === 'reject' ? 'reject' : 'accept',
          createdAt: new Date().toISOString(),
        },
      });
    },
    [serverId, setState],
  );

  // AskUserQuestion response (Phase E2).  Dispatches thread.user-input.respond
  // with the user's selections so the server resolves the Deferred inside
  // claude.ts canUseTool() and the SDK continues the turn.
  const respondToUserInput = useCallback(
    async (
      threadId: string,
      requestId: string,
      answers: Array<{ question: string; selections: string[]; notes?: string }>,
    ) => {
      setState((prev) => {
        const existing = prev.userInputs.get(threadId) || [];
        const updated = new Map(prev.userInputs);
        updated.set(threadId, existing.map((r) => r.requestId === requestId ? { ...r, pending: false } : r));
        return { ...prev, userInputs: updated };
      });
      await getOrchestrationClient(serverId)?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.user-input.respond',
          commandId: `cmd-${Date.now()}`,
          threadId,
          requestId,
          answers,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [serverId, setState],
  );

  const setActiveThread = useCallback((threadId: string) => {
    if (instanceId) {
      useAiBindingsStore.getState().bind(
        { serverId, sessionId, instanceId },
        threadId,
      );
    }
    activeThreadIdRef.current = threadId;
    setState((prev) => ({ ...prev, activeThreadId: threadId }));
  }, [instanceId, serverId, sessionId, activeThreadIdRef, setState]);

  const updateSettings = useCallback(async (settings: Record<string, unknown>) => {
    const result = await getOrchestrationClient(serverId)?.request<{ providers?: any[] }>('server.updateSettings', settings);
    if (result?.providers) {
      setState((prev) => ({ ...prev, providers: result.providers! }));
    }
  }, [serverId, setState]);

  const refreshProviders = useCallback(async () => {
    try {
      const result = await getOrchestrationClient(serverId)?.request<{ providers?: any[] }>('server.refreshProviders', {});
      if (result?.providers) {
        setState((prev) => ({ ...prev, providers: result.providers! }));
      }
    } catch { /* ignore */ }
  }, [serverId, setState]);

  return { sendMessage, interruptTurn, respondToApproval, respondToUserInput, setActiveThread, updateSettings, refreshProviders };
}
