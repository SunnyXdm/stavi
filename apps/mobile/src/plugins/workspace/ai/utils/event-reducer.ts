// ============================================================
// event-reducer — pure state reducer for orchestration events
// ============================================================
// processEventInner maps each incoming server event onto a new
// OrchestrationState.  No side effects, no RPC calls.
// Extracted from useOrchestration.ts (Phase 8g split).

import { useAiBindingsStore } from '../../../../stores/ai-bindings-store';
import type { OrchestrationState, Thread, Message, ThreadActivity } from '../useOrchestration';
import type { AIMessage } from '../types';
import {
  rawMessageToAIMessage,
  activityPayloadToAIPart,
  mergeActivityPart,
  applyMessageUpdate,
} from './event-helpers';

export interface EventReducerContext {
  instanceId?: string;
  activeConnectionId: string;
  sessionId: string;
  activeThreadIdRef: React.MutableRefObject<string | null>;
}

export function processEventInner(
  prev: OrchestrationState,
  event: any,
  ctx: EventReducerContext,
): OrchestrationState {
  const { instanceId, activeConnectionId, sessionId, activeThreadIdRef } = ctx;
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
        agentRuntime: event.payload.agentRuntime ?? undefined,
        modelSelection: event.payload.modelSelection,
        archived: false,
        createdAt: event.payload.createdAt,
        updatedAt: event.payload.updatedAt,
      };
      next.threads = prev.threads.some((item) => item.threadId === thread.threadId)
        ? prev.threads.map((item) => (item.threadId === thread.threadId ? thread : item))
        : [...prev.threads, thread];
      if (instanceId && useAiBindingsStore.getState().getBoundThreadId({ serverId: activeConnectionId, sessionId, instanceId }) === thread.threadId) {
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

    // AskUserQuestion (Phase E2).  Keyed parallel to approvals but rendered
    // with UserInputPrompt instead of ApprovalCard.
    case 'thread.user-input-requested': {
      const tid = event.payload.threadId;
      const existing = prev.userInputs.get(tid) || [];
      const updated = new Map(prev.userInputs);
      const existingIdx = existing.findIndex((r) => r.requestId === event.payload.requestId);
      const questions = Array.isArray(event.payload.questions) ? event.payload.questions : [];
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
            questions,
            pending: true,
          },
        ]);
      }
      next.userInputs = updated;
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
}
