// ============================================================
// useOrchestration — Hook wrapping Stavi server's orchestration RPC
// ============================================================
// Manages threads, messages, tool calls, approvals via Stavi's
// event-sourced orchestration system.
//
// Messages use the AIMessage / AIPart model from types.ts.
// The server sends flat `text` strings on thread.message-sent;
// we map those to [{ type: 'text', text }] parts. Tool activities
// from thread.activity-appended are mapped to tool parts and
// merged into the active assistant message.

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { staviClient } from '../../../stores/stavi-client';
import { useConnectionStore } from '../../../stores/connection';
import type { AIMessage, AIPart } from './types';
import { applyMessageUpdate } from './streaming';

const instanceThreadBindings = new Map<string, string>();

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

/**
 * Convert a server activity event payload into an AIPart for merging
 * into the active assistant message.
 *
 * The server sends activity payloads with fields directly in event.payload:
 *   { threadId, turnId, type: 'reasoning'|'tool-use'|'tool-result', text?, toolName?, ... }
 */
function activityPayloadToAIPart(payload: any): AIPart | null {
  const kind: string = payload.type ?? '';

  if (kind === 'reasoning') {
    return {
      type: 'reasoning',
      text: payload.text ?? '',
    };
  }

  if (kind === 'tool-use') {
    return {
      type: 'tool-call',
      id: payload.toolId,
      toolName: payload.toolName ?? 'tool',
      state: payload.state ?? 'running',
      input: payload.input,
    };
  }

  if (kind === 'tool-result') {
    return {
      type: 'tool-result',
      id: payload.toolId,
      toolName: payload.toolName ?? 'tool',
      output: payload.result,
    };
  }

  return null;
}

/**
 * Merge an activity-derived AIPart into the last assistant message's parts.
 * For reasoning: accumulate text onto existing reasoning part.
 * For tool-use/tool-result: add or update by toolId.
 */
function mergeActivityPart(messages: AIMessage[], part: AIPart, turnId?: string): AIMessage[] {
  if (messages.length === 0) return messages;

  // Find the streaming assistant message for this turn, or fallback to last assistant
  let targetIdx = -1;
  if (turnId) {
    targetIdx = messages.findIndex(
      (m) => m.role === 'assistant' && m.turnId === turnId,
    );
  }
  if (targetIdx === -1) {
    // Fallback: last assistant message
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') {
        targetIdx = i;
        break;
      }
    }
  }
  if (targetIdx === -1) return messages;

  const msg = messages[targetIdx];
  const parts = [...msg.parts];

  if (part.type === 'reasoning') {
    // Find existing reasoning part and append, or add new
    const existingIdx = parts.findIndex((p) => p.type === 'reasoning');
    if (existingIdx >= 0) {
      const existing = parts[existingIdx] as any;
      parts[existingIdx] = {
        ...existing,
        text: (existing.text ?? '') + (part as any).text,
      };
    } else {
      // Insert reasoning before text parts
      const firstTextIdx = parts.findIndex((p) => p.type === 'text');
      if (firstTextIdx >= 0) {
        parts.splice(firstTextIdx, 0, part);
      } else {
        parts.push(part);
      }
    }
  } else if (part.type === 'tool-call' || part.type === 'tool-result') {
    const partId = (part as any).id;
    if (partId) {
      const existingIdx = parts.findIndex((p) => (p as any).id === partId);
      if (existingIdx >= 0) {
        parts[existingIdx] = { ...parts[existingIdx], ...part };
      } else {
        parts.push(part);
      }
    } else {
      parts.push(part);
    }
  } else {
    parts.push(part);
  }

  const updated = [...messages];
  updated[targetIdx] = { ...msg, parts };
  return updated;
}

// ----------------------------------------------------------
// Streaming coalescing
// ----------------------------------------------------------

/**
 * Creates a coalescing updater that batches rapid setState calls.
 * Events are queued and flushed together on the next animation frame.
 */
function createCoalescingUpdater(
  setStateFn: React.Dispatch<React.SetStateAction<OrchestrationState>>,
) {
  let pendingUpdates: Array<(prev: OrchestrationState) => OrchestrationState> = [];
  let rafId: ReturnType<typeof requestAnimationFrame> | null = null;

  function flush() {
    rafId = null;
    const updates = pendingUpdates;
    pendingUpdates = [];
    if (updates.length === 0) return;

    setStateFn((prev) => {
      let state = prev;
      for (const update of updates) {
        state = update(state);
      }
      return state;
    });
  }

  return {
    enqueue(updater: (prev: OrchestrationState) => OrchestrationState) {
      pendingUpdates.push(updater);
      if (rafId == null) {
        rafId = requestAnimationFrame(flush);
      }
    },
    /** Force-flush for critical updates (approvals, thread creation) */
    immediate(updater: (prev: OrchestrationState) => OrchestrationState) {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      const updates = pendingUpdates;
      pendingUpdates = [];
      setStateFn((prev) => {
        let state = prev;
        for (const update of updates) {
          state = update(state);
        }
        return updater(state);
      });
    },
    destroy() {
      if (rafId != null) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
      pendingUpdates = [];
    },
  };
}

// ----------------------------------------------------------
// Hook
// ----------------------------------------------------------

export function useOrchestration(input?: { instanceId?: string; worktreePath?: string | null }) {
  const instanceId = input?.instanceId;
  const preferredWorktreePath = input?.worktreePath ?? null;
  const connectionState = useConnectionStore((s) => s.state);
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

  // Keep ref in sync for use in callbacks without stale closures
  useEffect(() => {
    activeThreadIdRef.current = state.activeThreadId;
  }, [state.activeThreadId]);

  const unsubRef = useRef<(() => void) | null>(null);

  // Coalescing updater — batches streaming updates into RAF frames
  const coalescerRef = useRef<ReturnType<typeof createCoalescingUpdater> | null>(null);
  if (coalescerRef.current == null) {
    coalescerRef.current = createCoalescingUpdater(setState);
  }
  const coalescer = coalescerRef.current;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      coalescerRef.current?.destroy();
      if (instanceId) {
        instanceThreadBindings.delete(instanceId);
      }
    };
  }, [instanceId]);

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
          const defaultEffort = firstModel?.capabilities?.reasoningEffortLevels?.find((level: any) => level?.isDefault)?.value;
          const defaultContextWindow = firstModel?.capabilities?.contextWindowOptions?.find((option: any) => option?.isDefault)?.value;
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

    return {
      provider: 'claude',
      modelId: 'claude-sonnet-4-6',
    };
  }, [instanceId]);

  const ensureActiveThread = useCallback(async () => {
    // Use ref for current value — avoids stale closure
    const currentId = instanceId
      ? instanceThreadBindings.get(instanceId) ?? activeThreadIdRef.current
      : activeThreadIdRef.current;
    if (currentId) {
      return currentId;
    }

    const project = projectsRef.current[0];
    if (!project?.id) {
      throw new Error('No project is available on the connected server');
    }

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

    // Update both ref and state immediately
    if (instanceId) {
      instanceThreadBindings.set(instanceId, threadId);
    }
    activeThreadIdRef.current = threadId;
    setState((prev) => ({
      ...prev,
      activeThreadId: threadId,
      threads: prev.threads.some((thread) => thread.threadId === threadId)
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
  }, [instanceId, preferredWorktreePath]);

  // Inner event processor (pure function: prev state → next state)
  const processEventInner = useCallback((prev: OrchestrationState, event: any): OrchestrationState => {
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
          modelSelection: event.payload.modelSelection,
          archived: false,
          createdAt: event.payload.createdAt,
          updatedAt: event.payload.updatedAt,
        };
        next.threads = prev.threads.some((item) => item.threadId === thread.threadId)
          ? prev.threads.map((item) => (item.threadId === thread.threadId ? thread : item))
          : [...prev.threads, thread];
        if (instanceId && instanceThreadBindings.get(instanceId) === thread.threadId) {
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

      // Activities (reasoning, tool calls, tool results)
      // Server sends: { type: 'thread.activity-appended', payload: { threadId, turnId, type: 'reasoning'|'tool-use'|'tool-result', text?, toolName?, ... } }
      case 'thread.activity-appended': {
        const tid = event.payload.threadId;
        const turnId = event.payload.turnId;
        const existingActivities = prev.activities.get(tid) || [];

        // Store the activity (read fields directly from payload, not nested)
        const activityType = event.payload.type ?? 'unknown';
        const activity: ThreadActivity = {
          threadId: tid,
          type: activityType,
          data: event.payload,
          createdAt: event.occurredAt,
        };
        const updatedActivities = new Map(prev.activities);
        updatedActivities.set(tid, [...existingActivities, activity]);
        next.activities = updatedActivities;

        // Convert to AIPart and merge into the active assistant message
        const part = activityPayloadToAIPart(event.payload);
        if (part) {
          const existingAI = prev.aiMessages.get(tid) ?? [];
          const updatedAI = new Map(prev.aiMessages);
          updatedAI.set(tid, mergeActivityPart(existingAI, part, turnId));
          next.aiMessages = updatedAI;
        }
        break;
      }

      // Approval request from server — the server is asking the user to approve something
      case 'thread.approval-response-requested': {
        const tid = event.payload.threadId;
        const existing = prev.approvals.get(tid) || [];
        const updated = new Map(prev.approvals);

        // Check if this request already exists
        const existingIdx = existing.findIndex(
          (a) => a.requestId === event.payload.requestId,
        );

        if (existingIdx >= 0) {
          // Already exists — make sure it's still pending
          const copy = [...existing];
          copy[existingIdx] = { ...copy[existingIdx], pending: true };
          updated.set(tid, copy);
        } else {
          // New approval — add it as pending
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

      // Session events may contain approval requests
      case 'thread.session-set': {
        // The session object may have pending approvals
        break;
      }

      // Token usage events — we could display these but don't need state changes
      case 'thread.token-usage': {
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
  }, []);

  // Process orchestration events — routes to coalesced or immediate path
  const processEvent = useCallback((event: any) => {
    const eventType = event.type;
    console.log('[Orchestration] Event:', eventType, event.payload?.threadId ?? '', event.payload?.role ?? '', event.payload?.streaming ?? '');

    // Streaming text updates should be coalesced
    if (eventType === 'thread.message-sent' && event.payload?.streaming) {
      coalescer.enqueue((prev) => processEventInner(prev, event));
      return;
    }

    // Activity events (reasoning deltas, tool updates) should be coalesced
    if (eventType === 'thread.activity-appended') {
      coalescer.enqueue((prev) => processEventInner(prev, event));
      return;
    }

    // Everything else (thread lifecycle, approvals, final messages) — immediate
    coalescer.immediate((prev) => processEventInner(prev, event));
  }, [coalescer, processEventInner]);

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

        console.log('[Orchestration] Init complete. Providers:', providers.map((p: any) => `${p.provider}:${p.authenticated ? 'auth' : 'no-auth'}`).join(', '));
        console.log('[Orchestration] Projects:', (snapshot.projects || []).length, 'Threads:', (snapshot.threads || []).length);
        console.log('[Orchestration] Server CWD:', serverCwd);

        // Build initial state from snapshot
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
              type: activity.type ?? activity.kind ?? 'unknown',
              data: activity ?? {},
              createdAt: activity.createdAt,
            }));
            activities.set(tid, mappedActivities);
          }
        }

        const boundThreadId = instanceId ? instanceThreadBindings.get(instanceId) ?? null : null;
        const activeThreadId = boundThreadId && threads.some((t) => t.threadId === boundThreadId)
          ? boundThreadId
          : null;
        activeThreadIdRef.current = activeThreadId;

        setState({
          threads,
          messages,
          aiMessages: aiMsgs,
          activities,
          approvals,
          activeThreadId,
          loading: false,
          snapshotSequence: snapshot.snapshotSequence || 0,
          providers,
          serverCwd,
        });

        // Subscribe to live events
        console.log('[Orchestration] Subscribing to domain events...');
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
  }, [connectionState, instanceId, processEvent]);

  // ----------------------------------------------------------
  // Actions
  // ----------------------------------------------------------

  const sendMessage = useCallback(
    async (text: string, threadId?: string, options?: {
      modelSelection?: {
        provider: string;
        modelId: string;
        thinking?: boolean;
        effort?: string;
        fastMode?: boolean;
        contextWindow?: string;
      };
      interactionMode?: 'default' | 'plan';
      accessLevel?: string;
    }) => {
      const tid = threadId || (await ensureActiveThread());

      console.log('[Orchestration] sendMessage to thread:', tid, 'model:', options?.modelSelection?.provider, options?.modelSelection?.modelId);
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
    [ensureActiveThread, resolveThreadModelSelection],
  );

  const interruptTurn = useCallback(
    async (threadId?: string) => {
      const tid = threadId || activeThreadIdRef.current;
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
    [],
  );

  const respondToApproval = useCallback(
    async (
      threadId: string,
      requestId: string,
      decision: 'accept' | 'reject' | 'always-allow',
    ) => {
      // Immediately mark as no longer pending in local state
      setState((prev) => {
        const existing = prev.approvals.get(threadId) || [];
        const updated = new Map(prev.approvals);
        updated.set(
          threadId,
          existing.map((a) =>
            a.requestId === requestId ? { ...a, pending: false } : a,
          ),
        );
        return { ...prev, approvals: updated };
      });

      await staviClient.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.approval.respond',
          commandId: `cmd-${Date.now()}`,
          threadId,
          requestId,
          decision:
            decision === 'always-allow'
              ? 'always-allow'
              : decision === 'reject'
                ? 'reject'
                : 'accept',
          createdAt: new Date().toISOString(),
        },
      });
    },
    [],
  );

  const setActiveThread = useCallback((threadId: string) => {
    if (instanceId) {
      instanceThreadBindings.set(instanceId, threadId);
    }
    activeThreadIdRef.current = threadId;
    setState((prev) => ({ ...prev, activeThreadId: threadId }));
  }, [instanceId]);

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
