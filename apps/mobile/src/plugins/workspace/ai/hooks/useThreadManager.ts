// ============================================================
// useThreadManager — thread creation and model resolution
// ============================================================
// Extracted from useOrchestration.ts (Phase 8g split).
// Owns: resolveThreadModelSelection, ensureActiveThread, createNewChat.
// Parent hook passes refs and stable primitive values via the input object.

import { useCallback } from 'react';
import { useAiBindingsStore } from '../../../../stores/ai-bindings-store';
import type { Thread } from '../useOrchestration';

export interface ThreadManagerInput {
  instanceId?: string;
  preferredWorktreePath: string | null;
  activeConnectionId: string;
  sessionId: string;
  client: any;
  activeThreadIdRef: React.MutableRefObject<string | null>;
  projectsRef: React.MutableRefObject<any[]>;
  serverConfigRef: React.MutableRefObject<any>;
  setState: React.Dispatch<React.SetStateAction<import('../useOrchestration').OrchestrationState>>;
}

export function useThreadManager(input: ThreadManagerInput) {
  const {
    instanceId,
    preferredWorktreePath,
    activeConnectionId,
    sessionId,
    client,
    activeThreadIdRef,
    projectsRef,
    serverConfigRef,
    setState,
  } = input;

  // ----------------------------------------------------------
  // Model resolution — reads project default or first authed provider
  // ----------------------------------------------------------
  const resolveThreadModelSelection = useCallback((): NonNullable<Thread['modelSelection']> => {
    const project = projectsRef.current[0];
    if (project?.defaultModelSelection) return project.defaultModelSelection;

    const providers = serverConfigRef.current?.providers;
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        if (!provider?.authenticated || !provider?.installed) continue;
        const firstModel = Array.isArray(provider.models) ? provider.models[0] : null;
        if (provider.provider && (firstModel?.id || firstModel?.slug)) {
          const defaultEffort = firstModel?.capabilities?.reasoningEffortLevels?.find((l: any) => l?.isDefault)?.value;
          const defaultContextWindow = firstModel?.capabilities?.contextWindowOptions?.find((o: any) => o?.isDefault)?.value;
          return {
            provider: provider.provider,
            modelId: firstModel.id ?? firstModel.slug,
            thinking: firstModel?.capabilities?.supportsThinkingToggle ? true : undefined,
            effort: defaultEffort,
            fastMode: firstModel?.capabilities?.supportsFastMode ? false : undefined,
            contextWindow: defaultContextWindow,
          };
        }
      }
    }
    return { provider: 'claude', modelId: 'claude-sonnet-4-6' };
  }, [projectsRef, serverConfigRef]);

  // ----------------------------------------------------------
  // Shared thread creation logic
  // ----------------------------------------------------------
  function buildThreadPayload(agentRuntime?: 'claude' | 'codex') {
    const project = projectsRef.current[0];
    if (!project?.id) throw new Error('No project is available on the connected server');
    if (!client) throw new Error('Client unavailable for active server');
    const createdAt = new Date().toISOString();
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dirName = preferredWorktreePath
      ? preferredWorktreePath.split('/').filter(Boolean).pop()
      : null;
    const title = dirName ? `${dirName} AI` : 'AI Chat';
    return { project, createdAt, threadId, title };
  }

  async function dispatchThreadCreate(
    threadId: string,
    projectId: string,
    title: string,
    createdAt: string,
    agentRuntime?: 'claude' | 'codex',
  ) {
    await client.request('orchestration.dispatchCommand', {
      command: {
        type: 'thread.create',
        commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        threadId,
        sessionId: sessionId !== 'local' ? sessionId : undefined,
        projectId,
        title,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        branch: null,
        worktreePath: preferredWorktreePath,
        agentRuntime: agentRuntime ?? null,
        createdAt,
      },
    });
  }

  function applyNewThread(
    threadId: string,
    projectId: string,
    title: string,
    createdAt: string,
    agentRuntime?: 'claude' | 'codex',
  ) {
    if (instanceId) {
      useAiBindingsStore.getState().bind({ serverId: activeConnectionId, sessionId, instanceId }, threadId);
    }
    activeThreadIdRef.current = threadId;
    setState((prev) => ({
      ...prev,
      activeThreadId: threadId,
      threads: prev.threads.some((t) => t.threadId === threadId)
        ? prev.threads
        : [
            ...prev.threads,
            {
              threadId,
              projectId,
              title,
              runtimeMode: 'approval-required' as const,
              interactionMode: 'default' as const,
              branch: '',
              worktreePath: preferredWorktreePath,
              agentRuntime,
              modelSelection: undefined,
              archived: false,
              createdAt,
              updatedAt: createdAt,
            },
          ],
    }));
  }

  // ----------------------------------------------------------
  // ensureActiveThread — reuses existing bound thread if present
  // ----------------------------------------------------------
  const ensureActiveThread = useCallback(async (agentRuntime?: 'claude' | 'codex') => {
    const currentId = instanceId
      ? useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId, instanceId }) ?? activeThreadIdRef.current
      : activeThreadIdRef.current;
    if (currentId) return currentId;

    const { project, createdAt, threadId, title } = buildThreadPayload(agentRuntime);
    await dispatchThreadCreate(threadId, project.id, title, createdAt, agentRuntime);
    applyNewThread(threadId, project.id, title, createdAt, agentRuntime);
    return threadId;
  }, [instanceId, preferredWorktreePath, activeConnectionId, sessionId, client]);

  // ----------------------------------------------------------
  // createNewChat — always creates a fresh thread (never reuses)
  // ----------------------------------------------------------
  const createNewChat = useCallback(async (agentRuntime?: 'claude' | 'codex') => {
    const { project, createdAt, threadId, title } = buildThreadPayload(agentRuntime);
    await dispatchThreadCreate(threadId, project.id, title, createdAt, agentRuntime);
    applyNewThread(threadId, project.id, title, createdAt, agentRuntime);
    return threadId;
  }, [instanceId, preferredWorktreePath, activeConnectionId, sessionId, client]);

  return { resolveThreadModelSelection, ensureActiveThread, createNewChat };
}
