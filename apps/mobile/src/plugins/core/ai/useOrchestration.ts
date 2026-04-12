// ============================================================
// useOrchestration — Hook wrapping Stavi server's orchestration RPC
// ============================================================
// Manages threads, messages, tool calls, approvals via Stavi's
// event-sourced orchestration system.
//
// Messages use the AIMessage / AIPart model from types.ts.
// The server sends flat `text` strings on thread.message-sent;
// we map those to [{ type: 'text', text }] parts. Tool activities
// from thread.activity-appended are mapped to tool parts.

import { useState, useEffect, useCallback, useRef } from 'react';
import { staviClient } from '../../../stores/stavi-client';
import { useConnectionStore } from '../../../stores/connection';
import type { AIMessage, AIPart } from './types';
import { applyMessageUpdate } from './streaming';

// ----------------------------------------------------------
// Types (derived from Stavi server's orchestration domain)
// ----------------------------------------------------------

export interface Thread {
  threadId: string;
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath: string | null;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

// Legacy flat-text Message — kept for backward compat during transition.
// New code should use AIMessage from ./types instead.
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
  messages: Map<string, Message[]>; // threadId → legacy flat messages
  aiMessages: Map<string, AIMessage[]>; // threadId → AIPart-based messages
  activities: Map<string, ThreadActivity[]>; // threadId → activities
  approvals: Map<string, ApprovalRequest[]>; // threadId → pending approvals
  activeThreadId: string | null;
  loading: boolean;
  snapshotSequence: number;
  // Provider/model config from server
  providers: any[];
  serverCwd: string;
}

// ----------------------------------------------------------
// Helpers — map raw server payloads to AIMessage / AIPart
// ----------------------------------------------------------

function rawMessageToAIMessage(raw: any, threadId: string): AIMessage {
  // The server sends flat text; wrap in a text part.
  const text: string = raw.text ?? '';
  const parts: AIPart[] = text ? [{ type: 'text', text }] : [];
  return {
    messageId: raw.messageId ?? raw.id ?? `msg-${Date.now()}`,
    threadId,
    role: raw.role ?? 'assistant',
    parts,
    turnId: raw.turnId,
    streaming: raw.streaming ?? false,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

function activityToAIPart(activity: any): AIPart | null {
  const kind: string = activity.kind ?? activity.type ?? '';
  const payload = activity.payload ?? activity ?? {};

  if (kind.includes('tool-use') || kind.includes('tool_use') || kind === 'tool.invoked') {
    return {
      type: 'tool-call',
      id: payload.toolUseId ?? payload.id ?? undefined,
      toolName: payload.toolName ?? payload.name ?? kind,
      state: 'running',
      input: payload.input,
    } as AIPart;
  }

  if (kind.includes('tool-result') || kind === 'tool.result') {
    return {
      type: 'tool-result',
      id: payload.toolUseId ?? payload.id ?? undefined,
      toolName: payload.toolName ?? payload.name ?? kind,
      output: payload.output ?? payload.content,
      error: payload.error,
    } as AIPart;
  }

  return null;
}

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useOrchestration() {
  const connectionState = useConnectionStore((s) => s.state);
  const projectsRef = useRef<any[]>([]);
  const serverConfigRef = useRef<any>(null);

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

  const unsubRef = useRef<(() => void) | null>(null);

  const derivePendingApprovals = useCallback((threadActivities: any[]): ApprovalRequest[] => {
    const openByRequestId = new Map<string, ApprovalRequest>();

    for (const activity of threadActivities) {
      const payload =
        activity && typeof activity.payload === 'object' && activity.payload != null
          ? (activity.payload as Record<string, unknown>)
          : null;
      const requestId =
        payload && typeof payload.requestId === 'string' ? payload.requestId : null;
      const requestKind =
        payload && typeof payload.requestKind === 'string' ? payload.requestKind : null;
      const detail = payload && typeof payload.detail === 'string' ? payload.detail : undefined;

      if (activity.kind === 'approval.requested' && requestId && requestKind) {
        openByRequestId.set(requestId, {
          threadId: activity.threadId,
          requestId,
          toolName: requestKind,
          toolInput: detail ? { detail } : undefined,
          pending: true,
        });
        continue;
      }

      if (activity.kind === 'approval.resolved' && requestId) {
        openByRequestId.delete(requestId);
        continue;
      }

      if (
        activity.kind === 'provider.approval.respond.failed' &&
        requestId &&
        detail?.toLowerCase().includes('stale pending')
      ) {
        openByRequestId.delete(requestId);
      }
    }

    return [...openByRequestId.values()];
  }, []);

  const resolveThreadModelSelection = useCallback(() => {
    const project = projectsRef.current[0];
    if (project?.defaultModelSelection) {
      return project.defaultModelSelection;
    }

    const providers = serverConfigRef.current?.providers;
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        if (!provider?.authenticated || !provider?.installed) {
          continue;
        }
        const firstModel = Array.isArray(provider.models) ? provider.models[0] : null;
        if (provider.provider && (firstModel?.id || firstModel?.slug)) {
          return {
            provider: provider.provider,
            modelId: firstModel.id ?? firstModel.slug,
          };
        }
      }
    }

    return {
      provider: 'claude',
      modelId: 'claude-sonnet-4-20250514',
    };
  }, []);

  const ensureActiveThread = useCallback(async () => {
    if (state.activeThreadId) {
      return state.activeThreadId;
    }

    const project = projectsRef.current[0];
    if (!project?.id) {
      throw new Error('No project is available on the connected server');
    }

    const createdAt = new Date().toISOString();
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const title = 'Mobile Session';

    await staviClient.request('orchestration.dispatchCommand', {
      command: {
        type: 'thread.create',
        commandId: `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        threadId,
        projectId: project.id,
        title,
        modelSelection: resolveThreadModelSelection(),
        runtimeMode: 'approval-required',
        interactionMode: 'default',
        branch: null,
        worktreePath: null,
        createdAt,
      },
    });

    setState((prev) => ({
      ...prev,
      activeThreadId: threadId,
      threads: [
        ...prev.threads,
        {
          threadId,
          projectId: project.id,
          title,
          runtimeMode: 'approval-required',
          interactionMode: 'default',
          branch: '',
          worktreePath: null,
          archived: false,
          createdAt,
          updatedAt: createdAt,
        },
      ],
    }));

    return threadId;
  }, [resolveThreadModelSelection, state.activeThreadId]);

  // Process orchestration events
  const processEvent = useCallback((event: any) => {
    setState((prev) => {
      const next = { ...prev };

      switch (event.type) {
        // Thread lifecycle
        case 'thread.created': {
          const thread: Thread = {
            threadId: event.payload.threadId,
            projectId: event.payload.projectId,
            title: event.payload.title,
            runtimeMode: event.payload.runtimeMode,
            interactionMode: event.payload.interactionMode,
            branch: event.payload.branch || '',
            worktreePath: event.payload.worktreePath,
            archived: false,
            createdAt: event.payload.createdAt,
            updatedAt: event.payload.updatedAt,
          };
          next.threads = [...prev.threads, thread];
          // Auto-select first thread
          if (!prev.activeThreadId) {
            next.activeThreadId = thread.threadId;
          }
          break;
        }

        case 'thread.deleted': {
          next.threads = prev.threads.filter((t) => t.threadId !== event.payload.threadId);
          if (prev.activeThreadId === event.payload.threadId) {
            next.activeThreadId = next.threads[0]?.threadId ?? null;
          }
          break;
        }

        case 'thread.archived': {
          next.threads = prev.threads.map((t) =>
            t.threadId === event.payload.threadId ? { ...t, archived: true } : t,
          );
          break;
        }

        case 'thread.meta-updated': {
          next.threads = prev.threads.map((t) =>
            t.threadId === event.payload.threadId
              ? {
                  ...t,
                  title: event.payload.title ?? t.title,
                  updatedAt: event.payload.updatedAt,
                }
              : t,
          );
          break;
        }

        // Messages
        case 'thread.message-sent': {
          const tid = event.payload.threadId;
          const existing = prev.messages.get(tid) || [];

          // Check for optimistic message update (streaming)
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
            // Update existing (streaming text update)
            const copy = [...existing];
            copy[msgIdx] = msg;
            updated.set(tid, copy);
          } else {
            updated.set(tid, [...existing, msg]);
          }
          next.messages = updated;

          // Also update aiMessages with AIPart model
          const incomingAI = rawMessageToAIMessage(event.payload, tid);
          const existingAI = prev.aiMessages.get(tid) ?? [];
          const updatedAI = new Map(prev.aiMessages);
          updatedAI.set(tid, applyMessageUpdate(existingAI, incomingAI));
          next.aiMessages = updatedAI;
          break;
        }

        // Activities (tool calls, etc.)
        case 'thread.activity-appended': {
          const tid = event.payload.threadId;
          const existing = prev.activities.get(tid) || [];
          const activity: ThreadActivity = {
            threadId: tid,
            type: event.payload.activity?.kind ?? event.payload.activity?.type ?? 'unknown',
            data: event.payload.activity ?? {},
            createdAt: event.occurredAt,
          };
          const updated = new Map(prev.activities);
          const nextActivities = [...existing, activity];
          updated.set(tid, nextActivities);
          next.activities = updated;
          const nextApprovals = new Map(prev.approvals);
          nextApprovals.set(tid, derivePendingApprovals(nextActivities as any[]));
          next.approvals = nextApprovals;
          break;
        }

        // Approvals
        case 'thread.approval-response-requested': {
          const tid = event.payload.threadId;
          // An approval was responded to — mark it as no longer pending
          const existing = prev.approvals.get(tid) || [];
          const updated = new Map(prev.approvals);
          updated.set(
            tid,
            existing.map((a) =>
              a.requestId === event.payload.requestId ? { ...a, pending: false } : a,
            ),
          );
          next.approvals = updated;
          break;
        }

        // Session events may contain approval requests
        case 'thread.session-set': {
          // The session object may have pending approvals
          break;
        }

        default:
          // Track sequence number
          if (event.sequence != null) {
            next.snapshotSequence = Math.max(prev.snapshotSequence, event.sequence);
          }
          break;
      }

      // Update sequence
      if (event.sequence != null) {
        next.snapshotSequence = Math.max(next.snapshotSequence, event.sequence);
      }

      return next;
    });
  }, [derivePendingApprovals]);

  // Load initial snapshot + subscribe
  useEffect(() => {
    if (connectionState !== 'connected') {
      setState((prev) => ({ ...prev, loading: true }));
      return;
    }

    let cancelled = false;

    async function init() {
      try {
        const serverConfig = await staviClient.request<any>('server.getConfig', {});

        // Get initial snapshot
        const snapshot = await staviClient.request<{
          snapshotSequence: number;
          threads: any[];
          projects: any[];
        }>('orchestration.getSnapshot', {});

        if (cancelled) return;

        serverConfigRef.current = serverConfig;
        projectsRef.current = snapshot.projects || [];

        // Extract providers from config
        const providers = serverConfig?.providers ?? [];
        const serverCwd = serverConfig?.cwd ?? '';

        // Build initial state from snapshot
        const threads: Thread[] = (snapshot.threads || []).map((t: any) => ({
          threadId: t.threadId || t.id,
          projectId: t.projectId,
          title: t.title,
          runtimeMode: t.runtimeMode || 'approval-required',
          interactionMode: t.interactionMode || 'default',
          branch: t.branch || '',
          worktreePath: t.worktreePath,
          archived: t.archived || false,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
        }));

        // Build messages from thread data
        const messages = new Map<string, Message[]>();
        const aiMsgs = new Map<string, AIMessage[]>();
        const activities = new Map<string, ThreadActivity[]>();
        const approvals = new Map<string, ApprovalRequest[]>();

        for (const t of snapshot.threads || []) {
          const tid = t.threadId || t.id;
          if (t.messages) {
            const legacyMsgs = t.messages.map((m: any) => ({
              messageId: m.messageId || m.id,
              threadId: tid,
              role: m.role,
              text: m.text ?? '',
              turnId: m.turnId,
              streaming: m.streaming ?? false,
              createdAt: m.createdAt,
            }));
            messages.set(tid, legacyMsgs);

            // Build AIMessage array from snapshot messages
            aiMsgs.set(
              tid,
              t.messages.map((m: any) => rawMessageToAIMessage(m, tid)),
            );
          }

          if (t.activities) {
            const mappedActivities = t.activities.map((activity: any) => ({
              threadId: tid,
              type: activity.kind ?? activity.type ?? 'unknown',
              data: activity ?? {},
              createdAt: activity.createdAt,
            }));
            activities.set(tid, mappedActivities);
            approvals.set(tid, derivePendingApprovals(mappedActivities as any[]));
          }
        }

        setState({
          threads,
          messages,
          aiMessages: aiMsgs,
          activities,
          approvals,
          activeThreadId: threads.find((t) => !t.archived)?.threadId ?? null,
          loading: false,
          snapshotSequence: snapshot.snapshotSequence || 0,
          providers,
          serverCwd,
        });

        // Subscribe to live events
        unsubRef.current = staviClient.subscribe(
          'subscribeOrchestrationDomainEvents',
          {},
          (event: any) => {
            if (!cancelled) {
              processEvent(event);
            }
          },
          (error) => {
            console.error('[Orchestration] Subscription error:', error);
          },
        );
      } catch (err) {
        console.error('[Orchestration] Init failed:', err);
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      unsubRef.current?.();
      unsubRef.current = null;
    };
  }, [connectionState, processEvent]);

  // ----------------------------------------------------------
  // Actions
  // ----------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, threadId?: string, options?: {
      modelSelection?: { provider: string; modelId: string; thinking?: boolean; effort?: string };
      interactionMode?: 'default' | 'plan';
      accessLevel?: string;
    }) => {
      const tid = threadId || (await ensureActiveThread());

      const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const commandId = `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      // Build model selection
      const modelSel = options?.modelSelection ?? resolveThreadModelSelection();

      // Map access level to runtime mode
      const runtimeMode = options?.accessLevel === 'full-access'
        ? 'full-access'
        : options?.accessLevel === 'auto-accept'
          ? 'auto-accept-edits'
          : 'approval-required';

      // Optimistic user message
      setState((prev) => {
        const existing = prev.messages.get(tid) || [];
        const updated = new Map(prev.messages);
        const createdAt = new Date().toISOString();
        updated.set(tid, [
          ...existing,
          {
            messageId,
            threadId: tid,
            role: 'user' as const,
            text,
            streaming: false,
            createdAt,
          },
        ]);

        // Optimistic AIMessage
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

        return { ...prev, messages: updated, aiMessages: updatedAI };
      });

      await staviClient.request('orchestration.dispatchCommand', {
          command: {
            type: 'thread.turn.start',
            commandId,
            threadId: tid,
            message: {
            messageId,
            role: 'user',
            text,
              attachments: [],
            },
            modelSelection: modelSel,
            runtimeMode,
            interactionMode: options?.interactionMode ?? 'default',
            createdAt: new Date().toISOString(),
          },
        });

      return { threadId: tid, turnId: commandId };
    },
    [ensureActiveThread, resolveThreadModelSelection, state.activeThreadId],
  );

  const interruptTurn = useCallback(
    async (threadId?: string) => {
      const tid = threadId || state.activeThreadId;
      if (!tid) return;

      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.interrupt',
          commandId: `cmd-${Date.now()}`,
          threadId: tid,
          createdAt: new Date().toISOString(),
        },
      });
    },
    [state.activeThreadId],
  );

  const respondToApproval = useCallback(
    async (
      threadId: string,
      requestId: string,
      decision: 'accept' | 'reject' | 'always-allow',
    ) => {
      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.approval.respond',
          commandId: `cmd-${Date.now()}`,
          threadId,
          requestId,
          decision:
            decision === 'always-allow'
              ? 'acceptForSession'
              : decision === 'reject'
                ? 'decline'
                : 'accept',
          createdAt: new Date().toISOString(),
        },
      });
    },
    [],
  );

  const setActiveThread = useCallback((threadId: string) => {
    setState((prev) => ({ ...prev, activeThreadId: threadId }));
  }, []);

  const updateSettings = useCallback(
    async (settings: Record<string, unknown>) => {
      const result = await staviClient.request<{ providers?: any[] }>(
        'server.updateSettings',
        settings,
      );
      // Update local providers state
      if (result?.providers) {
        setState((prev) => ({ ...prev, providers: result.providers! }));
      }
    },
    [],
  );

  const refreshProviders = useCallback(async () => {
    try {
      const result = await staviClient.request<{ providers?: any[] }>(
        'server.refreshProviders',
        {},
      );
      if (result?.providers) {
        setState((prev) => ({ ...prev, providers: result.providers! }));
      }
    } catch {
      // ignore
    }
  }, []);

  return {
    ...state,
    sendMessage,
    interruptTurn,
    respondToApproval,
    setActiveThread,
    ensureActiveThread,
    updateSettings,
    refreshProviders,
  };
}
