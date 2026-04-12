// ============================================================
// Claude Adapter — Anthropic Messages API streaming
// ============================================================
// Uses @anthropic-ai/sdk for real Claude streaming responses.
// Supports extended thinking for Claude Opus 4 / Sonnet 4.
// Maintains conversation history per thread in memory.

import Anthropic from '@anthropic-ai/sdk';
import type {
  ProviderAdapter,
  ModelInfo,
  ProviderEvent,
  SendTurnInput,
  ApprovalDecision,
} from './types';
import {
  textDelta,
  textDone,
  thinkingDelta,
  thinkingDone,
  toolUseStart,
  toolUseDone,
  turnComplete,
  turnError,
} from './types';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-20250514',
    name: 'Claude Sonnet 4',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    isDefault: true,
  },
  {
    id: 'claude-opus-4-20250514',
    name: 'Claude Opus 4',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
  },
  {
    id: 'claude-haiku-3-5-20241022',
    name: 'Claude Haiku 3.5',
    provider: 'claude',
    supportsThinking: false,
    maxTokens: 8192,
    contextWindow: 200000,
  },
];

const DEFAULT_SYSTEM_PROMPT = `You are an AI coding assistant running inside Stavi, a mobile IDE. You help users with coding, debugging, and development tasks. Be concise and practical. Format responses in Markdown when helpful.`;

// ----------------------------------------------------------
// Session state
// ----------------------------------------------------------

interface ClaudeSession {
  threadId: string;
  cwd: string;
  history: Anthropic.MessageParam[];
  abortController: AbortController | null;
}

// ----------------------------------------------------------
// Claude Adapter
// ----------------------------------------------------------

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude' as const;

  private client: Anthropic | null = null;
  private apiKey: string | null = null;
  private sessions = new Map<string, ClaudeSession>();
  private ready = false;

  constructor(private getApiKey: () => string | undefined) {}

  async initialize(): Promise<boolean> {
    const key = this.getApiKey();
    if (!key) {
      this.ready = false;
      return false;
    }

    this.apiKey = key;
    this.client = new Anthropic({ apiKey: key });
    this.ready = true;
    return true;
  }

  isReady(): boolean {
    // Re-check in case key was added after init
    if (!this.ready) {
      const key = this.getApiKey();
      if (key && key !== this.apiKey) {
        this.apiKey = key;
        this.client = new Anthropic({ apiKey: key });
        this.ready = true;
      }
    }
    return this.ready;
  }

  getModels(): ModelInfo[] {
    return CLAUDE_MODELS;
  }

  async startSession(threadId: string, cwd: string): Promise<void> {
    if (this.sessions.has(threadId)) return;

    this.sessions.set(threadId, {
      threadId,
      cwd,
      history: [],
      abortController: null,
    });
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent> {
    if (!this.client) {
      yield turnError(input.threadId, 'Claude adapter not initialized — no API key');
      return;
    }

    let session = this.sessions.get(input.threadId);
    if (!session) {
      // Auto-create session
      await this.startSession(input.threadId, '.');
      session = this.sessions.get(input.threadId)!;
    }

    const turnId = `turn-${Date.now()}`;
    const abortController = new AbortController();
    session.abortController = abortController;

    // Add user message to history
    session.history.push({
      role: 'user',
      content: input.text,
    });

    // Resolve model
    const modelId = input.modelSelection?.modelId ?? 'claude-sonnet-4-20250514';
    const modelInfo = CLAUDE_MODELS.find((m) => m.id === modelId);
    const effort = input.modelSelection?.effort ?? 'high';

    // Map effort to thinking behavior
    // low = thinking disabled, medium = 5K budget, high = 10K, max = 100K
    const effortThinkingEnabled = effort !== 'low';
    const effortBudgetMap: Record<string, number> = {
      'low': 0,
      'medium': 5000,
      'high': 10000,
      'max': 100000,
    };
    const useThinking = effortThinkingEnabled
      && input.modelSelection?.thinking !== false
      && (modelInfo?.supportsThinking ?? false);
    const thinkingBudget = input.modelSelection?.thinkingBudget
      ?? effortBudgetMap[effort]
      ?? 10000;

    try {
      // Build request params
      const params: Anthropic.MessageCreateParams = {
        model: modelId,
        max_tokens: modelInfo?.maxTokens ?? 16384,
        system: DEFAULT_SYSTEM_PROMPT,
        messages: session.history,
      };

      // Add thinking if supported
      if (useThinking) {
        (params as any).thinking = {
          type: 'enabled',
          budget_tokens: thinkingBudget,
        };
      }

      // Stream the response
      const stream = this.client.messages.stream(params, {
        signal: abortController.signal,
      });

      let fullText = '';
      let thinkingText = '';
      let currentToolId: string | null = null;
      let currentToolName: string | null = null;
      let toolInputAccumulator = '';

      for await (const event of stream) {
        if (abortController.signal.aborted) break;

        switch (event.type) {
          case 'content_block_start': {
            const block = (event as any).content_block;
            if (block?.type === 'thinking') {
              thinkingText = '';
            } else if (block?.type === 'tool_use') {
              currentToolId = block.id ?? `tool-${Date.now()}`;
              currentToolName = block.name ?? 'unknown';
              toolInputAccumulator = '';
              yield toolUseStart(input.threadId, currentToolName ?? 'unknown', currentToolId ?? 'unknown', null, turnId);
            }
            break;
          }

          case 'content_block_delta': {
            const delta = (event as any).delta;
            if (delta?.type === 'text_delta' && delta.text) {
              fullText += delta.text;
              yield textDelta(input.threadId, delta.text, turnId);
            } else if (delta?.type === 'thinking_delta' && delta.thinking) {
              thinkingText += delta.thinking;
              yield thinkingDelta(input.threadId, delta.thinking, turnId);
            } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
              toolInputAccumulator += delta.partial_json;
            }
            break;
          }

          case 'content_block_stop': {
            if (thinkingText) {
              yield thinkingDone(input.threadId, thinkingText, turnId);
              thinkingText = '';
            }
            if (currentToolId && currentToolName) {
              // Parse accumulated tool input
              let parsedInput: unknown = null;
              try {
                parsedInput = JSON.parse(toolInputAccumulator);
              } catch {
                parsedInput = toolInputAccumulator;
              }
              yield toolUseDone(input.threadId, currentToolId, parsedInput, turnId);
              currentToolId = null;
              currentToolName = null;
              toolInputAccumulator = '';
            }
            break;
          }

          case 'message_stop': {
            if (fullText) {
              yield textDone(input.threadId, fullText, turnId);
            }
            break;
          }

          case 'message_delta': {
            // Extract usage from the final message delta
            const usage = (event as any).usage;
            if (usage) {
              // Will be included in turn-complete
            }
            break;
          }
        }
      }

      // Get the final message for history and usage
      const finalMessage = await stream.finalMessage();

      // Add assistant response to history
      session.history.push({
        role: 'assistant',
        content: finalMessage.content,
      });

      // Extract usage
      const usage = {
        inputTokens: finalMessage.usage?.input_tokens ?? 0,
        outputTokens: finalMessage.usage?.output_tokens ?? 0,
      };

      yield turnComplete(input.threadId, turnId, usage);
    } catch (error: unknown) {
      if (abortController.signal.aborted) {
        yield turnError(input.threadId, 'Turn interrupted by user', turnId);
      } else {
        const message = error instanceof Error ? error.message : 'Unknown Claude API error';
        yield turnError(input.threadId, message, turnId);
      }

      // Remove partial assistant entry from history on error
      // (user message stays so they can retry)
    } finally {
      session.abortController = null;
    }
  }

  async interruptTurn(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (session?.abortController) {
      session.abortController.abort();
      session.abortController = null;
    }
  }

  async respondToApproval(
    _threadId: string,
    _requestId: string,
    _decision: ApprovalDecision,
  ): Promise<void> {
    // Claude direct API doesn't have tool approval gates
    // (that's a Claude Code CLI feature). For now, no-op.
    // In the future, if we use claude-agent-sdk, we'd implement this.
  }

  async stopSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (session) {
      session.abortController?.abort();
      this.sessions.delete(threadId);
    }
  }

  async stopAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.abortController?.abort();
    }
    this.sessions.clear();
  }
}
