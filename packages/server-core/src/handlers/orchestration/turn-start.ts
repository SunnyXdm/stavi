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
  ctx.threadRepo.updateThread(threadId, updatedThread);
  if (!messages.has(threadId)) messages.set(threadId, []);

  // Touch parent Session
  if (updatedThread.sessionId) {
    ctx.sessionRepo.touchSession(updatedThread.sessionId, 'running');
  }

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
  ctx.messageRepo.appendMessage(userMessage);
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
  ctx.messageRepo.appendMessage(assistantStart);
  broadcastOrchestrationEvent({
    type: 'thread.message-sent',
    occurredAt: nowIso(),
    payload: assistantStart,
  });

  // Resolve provider
  // Phase 8c fallback chain: modelSelection.provider > thread.agentRuntime > session.agentRuntime > default adapter
  const modelSelection = command.modelSelection as import('../../providers/types').ModelSelection | undefined;
  const providerKind: import('../../providers/types').ProviderKind | undefined =
    (modelSelection?.provider as import('../../providers/types').ProviderKind | undefined) ??
    updatedThread.agentRuntime ??
    (updatedThread.sessionId ? ctx.sessionRepo.getSession(updatedThread.sessionId)?.agentRuntime : undefined);
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
      ctx.messageRepo.replaceMessage(assistantMessageId, finalMessage);
      if (updatedThread.sessionId) {
        ctx.sessionRepo.touchSession(updatedThread.sessionId, 'idle');
      }
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
    // ----------------------------------------------------------
    // Streaming throttles. The Claude SDK emits 10-50 deltas/sec; broadcasting
    // the full accumulated text per delta is O(n²) bytes on the wire, and a
    // SQLite write per delta is hundreds of writes per turn. Coalesce:
    //   - WS broadcast: at most every STREAM_FLUSH_MS (trailing timer so the
    //     tail is never dropped)
    //   - DB write: at most every DB_FLUSH_MS (final write on completion)
    // The client merges accumulated snapshots, so skipping intermediates is
    // lossless (streaming.ts mergeStreamingText handles both shapes).
    // ----------------------------------------------------------
    const STREAM_FLUSH_MS = 60;
    const DB_FLUSH_MS = 300;
    let fullText = '';
    let lastBroadcast = 0;
    let lastDbWrite = 0;
    let textTimer: ReturnType<typeof setTimeout> | null = null;
    let thinkingBuffer = '';
    let thinkingTimer: ReturnType<typeof setTimeout> | null = null;

    const flushText = () => {
      const streamingMsg: OrchestrationMessage = { ...assistantStart, text: fullText, streaming: true };
      messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
        m.messageId === assistantMessageId ? streamingMsg : m,
      ));
      broadcastOrchestrationEvent({
        type: 'thread.message-sent',
        occurredAt: nowIso(),
        payload: streamingMsg,
      });
      const now = Date.now();
      if (now - lastDbWrite >= DB_FLUSH_MS) {
        lastDbWrite = now;
        ctx.messageRepo.replaceMessage(assistantMessageId, streamingMsg);
      }
    };

    const flushThinking = () => {
      if (!thinkingBuffer) return;
      const text = thinkingBuffer;
      thinkingBuffer = '';
      broadcastOrchestrationEvent({
        type: 'thread.activity-appended',
        occurredAt: nowIso(),
        payload: { threadId, turnId, type: 'reasoning', text },
      });
    };

    const stopStreamTimers = () => {
      if (textTimer) { clearTimeout(textTimer); textTimer = null; }
      if (thinkingTimer) { clearTimeout(thinkingTimer); thinkingTimer = null; }
      flushThinking();
    };

    // Resolve any approvals left pending when the turn ends (interrupt, error,
    // completion with an unanswered card) — broadcast so every client clears
    // its card instead of showing a ghost forever.
    const clearPendingApprovals = () => {
      const pend = ctx.pendingApprovals.get(threadId);
      if (pend?.length) {
        for (const p of pend) {
          broadcastOrchestrationEvent({
            type: 'thread.approval-resolved',
            occurredAt: nowIso(),
            payload: { threadId, requestId: p.requestId, decision: 'cancelled' },
          });
        }
      }
      ctx.pendingApprovals.delete(threadId);
    };

    try {
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
            const now = Date.now();
            if (now - lastBroadcast >= STREAM_FLUSH_MS) {
              lastBroadcast = now;
              if (textTimer) { clearTimeout(textTimer); textTimer = null; }
              flushText();
            } else if (!textTimer) {
              textTimer = setTimeout(() => {
                textTimer = null;
                lastBroadcast = Date.now();
                flushText();
              }, STREAM_FLUSH_MS);
            }
            break;
          }

          case 'thinking-delta': {
            thinkingBuffer += String(event.data.text ?? '');
            if (!thinkingTimer) {
              thinkingTimer = setTimeout(() => {
                thinkingTimer = null;
                flushThinking();
              }, STREAM_FLUSH_MS);
            }
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
            // Track in ctx so snapshots rehydrate pending cards after reload
            // (codex path — claude approvals are tracked by the server.ts
            // emitter wiring; this stream never carries claude approvals).
            const requestId = String(event.data.requestId ?? '');
            const list = ctx.pendingApprovals.get(threadId) ?? [];
            list.push({
              requestId,
              threadId,
              turnId,
              toolName: String(event.data.toolName ?? ''),
              toolInput: event.data.toolInput,
              provider: providerKind ?? adapter.provider,
              requestedAt: nowIso(),
            });
            ctx.pendingApprovals.set(threadId, list);
            broadcastOrchestrationEvent({
              type: 'thread.approval-response-requested',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId,
                requestId,
                toolName: String(event.data.toolName ?? ''),
                toolInput: event.data.toolInput,
              },
            });
            break;
          }

          case 'compact-boundary': {
            // /compact (or auto-compact) summarized the conversation — render
            // an info marker in the timeline and let the client reset its
            // context-usage display.
            broadcastOrchestrationEvent({
              type: 'thread.compaction',
              occurredAt: nowIso(),
              payload: {
                threadId, turnId,
                trigger: event.data.trigger,
                preTokens: event.data.preTokens,
              },
            });
            break;
          }

          case 'turn-complete': {
            activeTurnAdapters.delete(threadId);
            stopStreamTimers();
            clearPendingApprovals();
            const finalMessage: OrchestrationMessage = { ...assistantStart, text: fullText, streaming: false };
            messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
              m.messageId === assistantMessageId ? finalMessage : m,
            ));
            ctx.messageRepo.replaceMessage(assistantMessageId, finalMessage);
            if (updatedThread.sessionId) {
              ctx.sessionRepo.touchSession(updatedThread.sessionId, 'idle');
            }
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
            stopStreamTimers();
            clearPendingApprovals();
            const errorText = fullText
              ? `${fullText}\n\n---\n\n_Error: ${event.data.error}_`
              : `_Error: ${event.data.error}_`;
            const errorMessage: OrchestrationMessage = { ...assistantStart, text: errorText, streaming: false };
            messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
              m.messageId === assistantMessageId ? errorMessage : m,
            ));
            ctx.messageRepo.replaceMessage(assistantMessageId, errorMessage);
            if (updatedThread.sessionId) {
              ctx.sessionRepo.touchSession(updatedThread.sessionId, 'errored');
            }
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
      stopStreamTimers();
      clearPendingApprovals();
      const errMsg = err instanceof Error ? err.message : 'Unknown provider error';
      const errorMessage: OrchestrationMessage = {
        ...assistantStart,
        text: `_Error: ${errMsg}_`,
        streaming: false,
      };
      messages.set(threadId, (messages.get(threadId) ?? []).map((m) =>
        m.messageId === assistantMessageId ? errorMessage : m,
      ));
      ctx.messageRepo.replaceMessage(assistantMessageId, errorMessage);
      if (updatedThread.sessionId) {
        ctx.sessionRepo.touchSession(updatedThread.sessionId, 'errored');
      }
      broadcastOrchestrationEvent({
        type: 'thread.message-sent',
        occurredAt: nowIso(),
        payload: errorMessage,
      });
    }
  })();
}
