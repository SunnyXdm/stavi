// ============================================================
// useOrchestration — Hook wrapping Stavi server's orchestration RPC
// ============================================================
// Manages threads, messages, tool calls, approvals via Stavi's
// event-sourced orchestration system.
//
// File layout (Phase 8g split):
//   utils/event-helpers.ts   — pure payload→AIMessage/AIPart mappers
//   utils/coalescer.ts       — RAF-batched setState utility
//   utils/event-reducer.ts   — processEventInner pure state reducer
//   hooks/useOrchestrationActions.ts — sendMessage, interruptTurn, etc.
//   hooks/useThreadManager.ts — ensureActiveThread, createNewChat, model resolution

import { useState, useEffect, useCallback, useRef } from 'react';
import { useConnectionStore } from '../../../stores/connection';
import { useAiBindingsStore } from '../../../stores/ai-bindings-store';
import type { AIMessage } from './types';
import { createCoalescingUpdater } from './utils/coalescer';
import { processEventInner } from './utils/event-reducer';
import { rawMessageToAIMessage } from './utils/event-helpers';
import { useOrchestrationActions } from './hooks/useOrchestrationActions';
import { useThreadManager } from './hooks/useThreadManager';

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
  /** Phase 8c: per-chat provider. Undefined = inherit from workspace at turn time. */
  agentRuntime?: 'claude' | 'codex';
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

// UI terminology alias — displayed as "Chat" in the app. Phase 8b.
export type Chat = Thread;

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

// AskUserQuestion prompt — one of these renders in the chat stream via
// UserInputPrompt.tsx instead of ApprovalCard.tsx when the SDK invokes the
// AskUserQuestion tool.  Shape mirrors the server's UserInputQuestion type
// (sourced from @anthropic-ai/claude-agent-sdk AskUserQuestionInput).
export interface UserInputOption {
  label: string;
  description: string;
  preview?: string;
}

export interface UserInputQuestion {
  question: string;
  header: string;
  multiSelect: boolean;
  options: UserInputOption[];
}

export interface UserInputRequest {
  threadId: string;
  requestId: string;
  questions: UserInputQuestion[];
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
  userInputs: Map<string, UserInputRequest[]>;
  activeThreadId: string | null;
  loading: boolean;
  snapshotSequence: number;
  providers: any[];
  serverCwd: string;
}

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useOrchestration(input?: {
  instanceId?: string;
  worktreePath?: string | null;
  serverId?: string;
  sessionId?: string;
}) {
  const instanceId = input?.instanceId;
  const preferredWorktreePath = input?.worktreePath ?? null;
  const sessionId = input?.sessionId ?? 'local';
  if (!input?.serverId) {
    console.warn('[useOrchestration] serverId not provided — subscription will be inactive.');
  }
  const activeConnectionId = input?.serverId ?? 'local';
  // Phase 8e fix: reactive selector (was non-reactive .getState() call).
  const connectionState = useConnectionStore((s) => s.getServerStatus(activeConnectionId));
  const client = useConnectionStore.getState().getClientForServer(activeConnectionId);

  const projectsRef = useRef<any[]>([]);
  const serverConfigRef = useRef<any>(null);
  const activeThreadIdRef = useRef<string | null>(null);

  const [state, setState] = useState<OrchestrationState>({
    threads: [],
    messages: new Map(),
    aiMessages: new Map(),
    activities: new Map(),
    approvals: new Map(),
    userInputs: new Map(),
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
        useAiBindingsStore.getState().unbind({ serverId: activeConnectionId, sessionId, instanceId });
      }
    };
  }, [instanceId, activeConnectionId, sessionId]);

  // Thread management (create, model selection)
  const { resolveThreadModelSelection, ensureActiveThread, createNewChat } = useThreadManager({
    instanceId,
    preferredWorktreePath,
    activeConnectionId,
    sessionId,
    client,
    activeThreadIdRef,
    projectsRef,
    serverConfigRef,
    setState,
  });

  // ----------------------------------------------------------
  // Event processing
  // ----------------------------------------------------------

  // Stable ref for event reducer context — primitives are constant for the hook's lifetime.
  const reducerCtxRef = useRef({ instanceId, activeConnectionId, sessionId, activeThreadIdRef });

  const processEvent = useCallback((event: any) => {
    const eventType = event.type;
    console.log('[Orchestration] Event:', eventType, event.payload?.threadId ?? '', event.payload?.role ?? '', event.payload?.streaming ?? '');

    if (eventType === 'thread.message-sent' && event.payload?.streaming) {
      coalescer.enqueue((prev) => processEventInner(prev, event, reducerCtxRef.current));
      return;
    }
    if (eventType === 'thread.activity-appended') {
      coalescer.enqueue((prev) => processEventInner(prev, event, reducerCtxRef.current));
      return;
    }
    coalescer.immediate((prev) => processEventInner(prev, event, reducerCtxRef.current));
  }, [coalescer]);

  // ----------------------------------------------------------
  // Init + subscription
  // ----------------------------------------------------------

  useEffect(() => {
    if (connectionState !== 'connected') {
      useAiBindingsStore.getState().clearServer(activeConnectionId);
      setState((prev) => ({ ...prev, loading: true }));
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        if (!client) throw new Error('Client unavailable for active server');

        const serverConfig = await client.request<any>('server.getConfig', {});
        const snapshot = await client.request<{
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
          agentRuntime: t.agentRuntime ?? undefined,
          modelSelection: t.modelSelection,
          archived: t.archived || false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));

        const messages = new Map<string, Message[]>();
        const aiMsgs = new Map<string, AIMessage[]>();
        const activities = new Map<string, ThreadActivity[]>();
        const approvals = new Map<string, ApprovalRequest[]>();
        const userInputs = new Map<string, UserInputRequest[]>();

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

        const validThreadIds = new Set(threads.map((t) => t.threadId));
        useAiBindingsStore.getState().reconcile(activeConnectionId, sessionId, validThreadIds);

        const boundThreadId = instanceId
          ? useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId, instanceId }) ?? null
          : null;
        const activeThreadId =
          boundThreadId && threads.some((t) => t.threadId === boundThreadId) ? boundThreadId : null;
        activeThreadIdRef.current = activeThreadId;

        setState({
          threads, messages, aiMessages: aiMsgs, activities, approvals, userInputs,
          activeThreadId, loading: false,
          snapshotSequence: snapshot.snapshotSequence || 0,
          providers, serverCwd,
        });

        console.log('[Orchestration] Subscribing to domain events...');
        unsubRef.current = client.subscribe(
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
  }, [connectionState, instanceId, processEvent, activeConnectionId, client, sessionId]);

  // ----------------------------------------------------------
  // Actions
  // ----------------------------------------------------------

  const actions = useOrchestrationActions({
    serverId: activeConnectionId,
    sessionId,
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
    createNewChat,
  };
}
