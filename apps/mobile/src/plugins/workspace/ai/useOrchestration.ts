// ============================================================
// useOrchestration — Hook wrapping Stavi server's orchestration RPC
// ============================================================
// Manages threads, messages, tool calls, approvals via Stavi's
// event-sourced orchestration system.
//
// Split layout:
//   utils/event-helpers.ts  — pure payload→AIMessage/AIPart mappers
//   utils/coalescer.ts      — RAF-batched setState utility
//   hooks/useOrchestrationActions.ts — sendMessage, interruptTurn, etc.

import { useState, useEffect, useCallback, useRef } from 'react';
import { staviClient } from '../../../stores/stavi-client';
import { useConnectionStore } from '../../../stores/connection';
import { useAiBindingsStore } from '../../../stores/ai-bindings-store';
import type { AIMessage } from './types';
import {
  rawMessageToAIMessage,
  activityPayloadToAIPart,
  mergeActivityPart,
  applyMessageUpdate,
} from './utils/event-helpers';
import { createCoalescingUpdater } from './utils/coalescer';
import { useOrchestrationActions } from './hooks/useOrchestrationActions';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

export interface Thread {
  threadId: string;
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath: string | null;
  modelSelection?: {
    provider: string;
    modelId: string;
    thinking?: boolean;
    effort?: string;
    fastMode?: boolean;
    contextWindow?: string;
  };
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Legacy flat-text Message — kept for backward compat during transition.
export interface Message {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId?: string;
  streaming?: boolean;
  createdAt: string;
}

export interface ToolCall {
  threadId: string;
  turnId: string;
  type: string;
  name: string;
  input?: Record<string, unknown>;
  output?: string;
  status: 'pending' | 'running' | 'completed' | 'error';
}

export interface ApprovalRequest {
  threadId: string;
  requestId: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  pending: boolean;
}

export interface ThreadActivity {
  threadId: string;
  type: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export interface OrchestrationState {
  threads: Thread[];
  messages: Map<string, Message[]>;
  aiMessages: Map<string, AIMessage[]>;
  activities: Map<string, ThreadActivity[]>;
  approvals: Map<string, ApprovalRequest[]>;
  activeThreadId: string | null;
  loading: boolean;
  snapshotSequence: number;
  providers: any[];
  serverCwd: string;
}

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useOrchestration(input?: { instanceId?: string; worktreePath?: string | null }) {
  const instanceId = input?.instanceId;
  const preferredWorktreePath = input?.worktreePath ?? null;
  const connectionState = useConnectionStore((s) => s.state);
  const activeConnectionId = useConnectionStore((s) => s.activeConnection?.id ?? 'local');
  const projectsRef = useRef<any[]>([]);
  const serverConfigRef = useRef<any>(null);
  const activeThreadIdRef = useRef<string | null>(null);

  const [state, setState] = useState<OrchestrationState>({
    threads: [],
    messages: new Map(),
    aiMessages: new Map(),
    activities: new Map(),
    approvals: new Map(),
    activeThreadId: null,
    loading: true,
    snapshotSequence: 0,
    providers: [],
    serverCwd: '',
  });

  useEffect(() => { activeThreadIdRef.current = state.activeThreadId; }, [state.activeThreadId]);

  const unsubRef = useRef<(() => void) | null>(null);

  const coalescerRef = useRef<ReturnType<typeof createCoalescingUpdater> | null>(null);
  if (coalescerRef.current == null) {
    coalescerRef.current = createCoalescingUpdater(setState);
  }
  const coalescer = coalescerRef.current;

  useEffect(() => {
    return () => {
      coalescerRef.current?.destroy();
      if (instanceId) {
        useAiBindingsStore.getState().unbind({ serverId: activeConnectionId, sessionId: 'local', instanceId });
      }
    };
  }, [instanceId, activeConnectionId]);

  // ----------------------------------------------------------
  // Model resolution
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
  }, []);

  // ----------------------------------------------------------
  // Thread creation
  // ----------------------------------------------------------

  const ensureActiveThread = useCallback(async () => {
    const currentId = instanceId
      ? useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId: 'local', instanceId }) ?? activeThreadIdRef.current
      : activeThreadIdRef.current;
    if (currentId) return currentId;

    const project = projectsRef.current[0];
    if (!project?.id) throw new Error('No project is available on the connected server');

    const createdAt = new Date().toISOString();
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const dirName = preferredWorktreePath
      ? preferredWorktreePath.split('/').filter(Boolean).pop()
      : null;
    const title = dirName ? `${dirName} AI` : 'AI Session';

    await staviClient.request('orchestration.dispatchCommand', {
      command: {
        type: 'thread.create',
        commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        threadId,
        projectId: project.id,
        title,
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        branch: null,
        worktreePath: preferredWorktreePath,
        createdAt,
      },
    });

    if (instanceId) {
      useAiBindingsStore.getState().bind({ serverId: activeConnectionId, sessionId: 'local', instanceId }, threadId);
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
              projectId: project.id,
              title,
              runtimeMode: 'approval-required',
              interactionMode: 'default',
              branch: '',
              worktreePath: preferredWorktreePath,
              modelSelection: undefined,
              archived: false,
              createdAt,
              updatedAt: createdAt,
            },
          ],
    }));
    return threadId;
  }, [instanceId, preferredWorktreePath, activeConnectionId]);

  // ----------------------------------------------------------
  // Event processing (pure state reducer)
  // ----------------------------------------------------------

  const processEventInner = useCallback((prev: OrchestrationState, event: any): OrchestrationState => {
    const next = { ...prev };

    switch (event.type) {
      case 'thread.created': {
        const thread: Thread = {
          threadId: event.payload.threadId,
          projectId: event.payload.projectId,
          title: event.payload.title,
          runtimeMode: event.payload.runtimeMode,
          interactionMode: event.payload.interactionMode,
          branch: event.payload.branch || '',
          worktreePath: event.payload.worktreePath,
          modelSelection: event.payload.modelSelection,
          archived: false,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        };
        next.threads = prev.threads.some((item) => item.threadId === thread.threadId)
          ? prev.threads.map((item) => (item.threadId === thread.threadId ? thread : item))
          : [...prev.threads, thread];
        if (instanceId && useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId: 'local', instanceId }) === thread.threadId) {
          next.activeThreadId = thread.threadId;
          activeThreadIdRef.current = thread.threadId;
        }
        break;
      }
      case 'thread.deleted': {
        next.threads = prev.threads.filter((t) => t.threadId !== event.payload.threadId);
        if (prev.activeThreadId === event.payload.threadId) {
          const newActive = next.threads[0]?.threadId ?? null;
          next.activeThreadId = newActive;
          activeThreadIdRef.current = newActive;
        }
        break;
      }
      case 'thread.archived':
        next.threads = prev.threads.map((t) =>
          t.threadId === event.payload.threadId ? { ...t, archived: true } : t);
        break;
      case 'thread.meta-updated':
        next.threads = prev.threads.map((t) =>
          t.threadId === event.payload.threadId
            ? { ...t, title: event.payload.title ?? t.title, updatedAt: event.payload.updatedAt }
            : t);
        break;

      case 'thread.message-sent': {
        const tid = event.payload.threadId;
        const existing = prev.messages.get(tid) || [];
        const msgIdx = existing.findIndex((m) => m.messageId === event.payload.messageId);
        const msg: Message = {
          messageId: event.payload.messageId,
          threadId: tid,
          role: event.payload.role,
          text: event.payload.text ?? '',
          turnId: event.payload.turnId,
          streaming: event.payload.streaming,
          createdAt: event.payload.createdAt,
        };
        const updated = new Map(prev.messages);
        if (msgIdx >= 0) {
          const copy = [...existing];
          copy[msgIdx] = msg;
          updated.set(tid, copy);
        } else {
          updated.set(tid, [...existing, msg]);
        }
        next.messages = updated;

        const incomingAI = rawMessageToAIMessage(event.payload, tid);
        const existingAI = prev.aiMessages.get(tid) ?? [];
        const updatedAI = new Map(prev.aiMessages);
        updatedAI.set(tid, applyMessageUpdate(existingAI, incomingAI));
        next.aiMessages = updatedAI;
        break;
      }

      case 'thread.activity-appended': {
        const tid = event.payload.threadId;
        const turnId = event.payload.turnId;
        const existingActivities = prev.activities.get(tid) || [];
        const activity: ThreadActivity = {
          threadId: tid,
          type: event.payload.type ?? 'unknown',
          data: event.payload,
          createdAt: event.occurredAt,
        };
        const updatedActivities = new Map(prev.activities);
        updatedActivities.set(tid, [...existingActivities, activity]);
        next.activities = updatedActivities;

        const part = activityPayloadToAIPart(event.payload);
        if (part) {
          const existingAI = prev.aiMessages.get(tid) ?? [];
          const updatedAI = new Map(prev.aiMessages);
          updatedAI.set(tid, mergeActivityPart(existingAI, part, turnId));
          next.aiMessages = updatedAI;
        }
        break;
      }

      case 'thread.approval-response-requested': {
        const tid = event.payload.threadId;
        const existing = prev.approvals.get(tid) || [];
        const updated = new Map(prev.approvals);
        const existingIdx = existing.findIndex((a) => a.requestId === event.payload.requestId);
        if (existingIdx >= 0) {
          const copy = [...existing];
          copy[existingIdx] = { ...copy[existingIdx], pending: true };
          updated.set(tid, copy);
        } else {
          updated.set(tid, [
            ...existing,
            {
              threadId: tid,
              requestId: event.payload.requestId,
              toolName: event.payload.toolName,
              toolInput: event.payload.toolInput,
              pending: true,
            },
          ]);
        }
        next.approvals = updated;
        break;
      }

      case 'thread.session-set':
      case 'thread.token-usage':
        break;

      default:
        if (event.sequence != null) {
          next.snapshotSequence = Math.max(prev.snapshotSequence, event.sequence);
        }
        break;
    }

    if (event.sequence != null) {
      next.snapshotSequence = Math.max(next.snapshotSequence, event.sequence);
    }
    return next;
  }, [instanceId, activeConnectionId]);

  const processEvent = useCallback((event: any) => {
    const eventType = event.type;
    console.log('[Orchestration] Event:', eventType, event.payload?.threadId ?? '', event.payload?.role ?? '', event.payload?.streaming ?? '');

    if (eventType === 'thread.message-sent' && event.payload?.streaming) {
      coalescer.enqueue((prev) => processEventInner(prev, event));
      return;
    }
    if (eventType === 'thread.activity-appended') {
      coalescer.enqueue((prev) => processEventInner(prev, event));
      return;
    }
    coalescer.immediate((prev) => processEventInner(prev, event));
  }, [coalescer, processEventInner]);

  // ----------------------------------------------------------
  // Init + subscription
  // ----------------------------------------------------------

  useEffect(() => {
    if (connectionState !== 'connected') {
      // Clear all bindings for this server on disconnect so stale threadIds don't persist.
      useAiBindingsStore.getState().clearServer(activeConnectionId);
      setState((prev) => ({ ...prev, loading: true }));
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const serverConfig = await staviClient.request<any>('server.getConfig', {});
        const snapshot = await staviClient.request<{
          snapshotSequence: number;
          threads: any[];
          projects: any[];
        }>('orchestration.getSnapshot', {});

        if (cancelled) return;

        serverConfigRef.current = serverConfig;
        projectsRef.current = snapshot.projects || [];

        const providers = serverConfig?.providers ?? [];
        const serverCwd = serverConfig?.cwd ?? '';

        console.log('[Orchestration] Init complete. Providers:', providers.map((p: any) => `${p.provider}:${p.authenticated ? 'auth' : 'no-auth'}`).join(', '));
        console.log('[Orchestration] Projects:', (snapshot.projects || []).length, 'Threads:', (snapshot.threads || []).length);
        console.log('[Orchestration] Server CWD:', serverCwd);

        const threads: Thread[] = (snapshot.threads || []).map((t: any) => ({
          threadId: t.threadId || t.id,
          projectId: t.projectId,
          title: t.title,
          runtimeMode: t.runtimeMode || 'approval-required',
          interactionMode: t.interactionMode || 'default',
          branch: t.branch || '',
          worktreePath: t.worktreePath,
          modelSelection: t.modelSelection,
          archived: t.archived || false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));

        const messages = new Map<string, Message[]>();
        const aiMsgs = new Map<string, AIMessage[]>();
        const activities = new Map<string, ThreadActivity[]>();
        const approvals = new Map<string, ApprovalRequest[]>();

        for (const t of snapshot.threads || []) {
          const tid = t.threadId || t.id;
          if (t.messages) {
            messages.set(tid, t.messages.map((m: any) => ({
              messageId: m.messageId || m.id,
              threadId: tid,
              role: m.role,
              text: m.text ?? '',
              turnId: m.turnId,
              streaming: m.streaming ?? false,
              createdAt: m.createdAt,
            })));
            aiMsgs.set(tid, t.messages.map((m: any) => rawMessageToAIMessage(m, tid)));
          }
          if (t.activities) {
            activities.set(tid, t.activities.map((a: any) => ({
              threadId: tid,
              type: a.type ?? a.kind ?? 'unknown',
              data: a ?? {},
              createdAt: a.createdAt,
            })));
          }
        }

        // Reconcile: drop any binding that points to a threadId no longer in the snapshot.
        const validThreadIds = new Set(threads.map((t) => t.threadId));
        useAiBindingsStore.getState().reconcile(activeConnectionId, 'local', validThreadIds);

        const boundThreadId = instanceId
          ? useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId: 'local', instanceId }) ?? null
          : null;
        const activeThreadId =
          boundThreadId && threads.some((t) => t.threadId === boundThreadId) ? boundThreadId : null;
        activeThreadIdRef.current = activeThreadId;

        setState({
          threads, messages, aiMessages: aiMsgs, activities, approvals,
          activeThreadId, loading: false,
          snapshotSequence: snapshot.snapshotSequence || 0,
          providers, serverCwd,
        });

        console.log('[Orchestration] Subscribing to domain events...');
        unsubRef.current = staviClient.subscribe(
          'subscribeOrchestrationDomainEvents',
          {},
          (event: any) => { if (!cancelled) processEvent(event); },
          (error) => { console.error('[Orchestration] Subscription error:', error); },
        );
      } catch (err) {
        console.error('[Orchestration] Init failed:', err);
        if (!cancelled) setState((prev) => ({ ...prev, loading: false }));
      }
    }

    init();
    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connectionState, instanceId, processEvent, activeConnectionId]);

  // ----------------------------------------------------------
  // Actions
  // ----------------------------------------------------------

  const actions = useOrchestrationActions({
    setState,
    activeThreadIdRef,
    instanceId,
    ensureActiveThread,
    resolveThreadModelSelection,
  });

  return {
    ...state,
    ...actions,
    ensureActiveThread,
  };
}
