// ============================================================
// orchestration/turn-start.ts — thread.turn.start streaming loop
// ============================================================
// Handles the full AI provider streaming lifecycle for one turn:
// user message → provider stream → text/tool/approval events → done

import type { WebSocket } from 'ws';
import type { ServerContext } from '../../context';
import type { OrchestrationMessage, OrchestrationThread } from '../../types';
import { nowIso, createAssistantReply } from '../../utils';

export async function handleTurnStart(
  ws: WebSocket,
  id: string,
  command: Record<string, unknown>,
  thread: OrchestrationThread,
  ctx: ServerContext,
): Promise<void> {
  const { threads, messages, activeTurnAdapters, providerRegistry, broadcastOrchestrationEvent, sendJson, makeFailure } = ctx;
  const threadId = thread.threadId;

  // Validate
  if (!threadId) {
    sendJson(ws, makeFailure(id, 'threadId is required'));
    return;
  }

  // Update thread from this command (runtime/interaction mode may change)
  const updatedThread = ctx.buildThreadFromCommand(threadId, command, thread);
  threads.set(threadId, updatedThread);
  if (!messages.has(threadId)) messages.set(threadId, []);

  // Build user message
  const msg = command.message as Record<string, unknown>;
  const userMessage: OrchestrationMessage = {
    messageId: String(msg.messageId ?? `msg-${Date.now()}`),
    threadId,
    role: 'user',
    text: String(msg.text ?? ''),
    createdAt: String(command.createdAt ?? nowIso()),
  };
  messages.set(threadId, [...(messages.get(threadId) ?? []), userMessage]);
  updatedThread.updatedAt = nowIso();
  broadcastOrchestrationEvent({
    type: 'thread.message-sent',
    occurredAt: nowIso(),
    payload: userMessage,
  });

  // Create placeholder assistant message (streaming=true)
  const assistantMessageId = `assistant-${Date.now()}`;
  const turnId = String(command.commandId ?? `turn-${Date.now()}`);
  const assistantStart: OrchestrationMessage = {
    messageId: assistantMessageId,
    threadId,
    role: 'assistant',
    text: '',
    turnId,
    streaming: true,
    createdAt: nowIso(),
  };
  messages.set(threadId, [...(messages.get(threadId) ?? []), assistantStart]);
  broadcastOrchestrationEvent({
    type: 'thread.message-sent',
    occurredAt: nowIso(),
    payload: assistantStart,
  });

  // Resolve provider
  const modelSelection = command.modelSelection as import('../../providers/types').ModelSelection | undefined;
  const providerKind = modelSelection?.provider;
  const adapter = providerKind
    ? providerRegistry.getAdapter(providerKind)
    : providerRegistry.getDefaultAdapter();

  if (!(adapter && adapter.isReady())) {
    // No provider — send a placeholder reply after a brief delay
    setTimeout(() => {
      const finalMessage: OrchestrationMessage = {
        ...assistantStart,
        text: createAssistantReply(userMessage.text, providerRegistry.getProviderInfos()),
        streaming: false,
      };
      const next = (messages.get(threadId) ?? []).map((m) =>
        m.messageId === assistantMessageId ? finalMessage : m,
      );
      messages.set(threadId, next);
      broadcastOrchestrationEvent({
        type: 'thread.message-sent',
        occurredAt: nowIso(),
        payload: finalMessage,
      });
    }, 250);
    return;
  }

  // Real provider — stream the turn
  activeTurnAdapters.set(threadId, providerKind ?? adapter.provider);

  (async () => {
    try {
      let fullText = '';
      const stream = adapter.sendTurn({
        threadId,
        text: userMessage.text,
        cwd: updatedThread.worktreePath ?? ctx.workspaceRoot,
        modelSelection,
        interactionMode: command.interactionMode as 'default' | 'plan' | undefined,
        runtimeMode: updatedThread.runtimeMode,
      });

      for await (const event of stream) {
        switch (event.type) {
          case 'text-delta': {
            fullText += String(event.data.text ?? '');
            const streamingMsg: OrchestrationMessage = { ...assistantStart, text: fullText, streaming: true };
            messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
              m.messageId === assistantMessageId ? streamingMsg : m,
            ));
            broadcastOrchestrationEvent({
              type: 'thread.message-sent',
              occurredAt: nowIso(),
              payload: streamingMsg,
            });
            break;
          }

          case 'thinking-delta': {
            broadcastOrchestrationEvent({
              type: 'thread.activity-appended',
              occurredAt: nowIso(),
              payload: { threadId, turnId, type: 'reasoning', text: String(event.data.text ?? '') },
            });
            break;
          }

          case 'tool-use-start': {
            broadcastOrchestrationEvent({
              type: 'thread.activity-appended',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId, type: 'tool-use',
                toolName: String(event.data.toolName ?? ''),
                toolId: String(event.data.toolId ?? ''),
                input: event.data.input,
                state: 'running',
              },
            });
            break;
          }

          case 'tool-use-delta': {
            broadcastOrchestrationEvent({
              type: 'thread.activity-appended',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId, type: 'tool-use',
                toolId: String(event.data.toolId ?? ''),
                input: event.data.input,
                state: 'running',
              },
            });
            break;
          }

          case 'tool-use-done': {
            broadcastOrchestrationEvent({
              type: 'thread.activity-appended',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId, type: 'tool-result',
                toolId: String(event.data.toolId ?? ''),
                result: event.data.result,
                state: 'completed',
              },
            });
            break;
          }

          case 'approval-required': {
            broadcastOrchestrationEvent({
              type: 'thread.approval-response-requested',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId,
                requestId: String(event.data.requestId ?? ''),
                toolName: String(event.data.toolName ?? ''),
                toolInput: event.data.toolInput,
              },
            });
            break;
          }

          case 'turn-complete': {
            activeTurnAdapters.delete(threadId);
            const finalMessage: OrchestrationMessage = { ...assistantStart, text: fullText, streaming: false };
            messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
              m.messageId === assistantMessageId ? finalMessage : m,
            ));
            broadcastOrchestrationEvent({
              type: 'thread.message-sent',
              occurredAt: nowIso(),
              payload: finalMessage,
            });
            if (event.data.usage) {
              broadcastOrchestrationEvent({
                type: 'thread.token-usage',
                occurredAt: nowIso(),
                payload: { threadId, turnId, usage: event.data.usage },
              });
            }
            break;
          }

          case 'turn-error': {
            activeTurnAdapters.delete(threadId);
            const errorText = fullText
              ? `${fullText}\n\n---\n\n_Error: ${event.data.error}_`
              : `_Error: ${event.data.error}_`;
            const errorMessage: OrchestrationMessage = { ...assistantStart, text: errorText, streaming: false };
            messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
              m.messageId === assistantMessageId ? errorMessage : m,
            ));
            broadcastOrchestrationEvent({
              type: 'thread.message-sent',
              occurredAt: nowIso(),
              payload: errorMessage,
            });
            break;
          }
        }
      }
    } catch (err) {
      activeTurnAdapters.delete(threadId);
      const errMsg = err instanceof Error ? err.message : 'Unknown provider error';
      const errorMessage: OrchestrationMessage = {
        ...assistantStart,
        text: `_Error: ${errMsg}_`,
        streaming: false,
      };
      messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
        m.messageId === assistantMessageId ? errorMessage : m,
      ));
      broadcastOrchestrationEvent({
        type: 'thread.message-sent',
        occurredAt: nowIso(),
        payload: errorMessage,
      });
    }
  })();
}
