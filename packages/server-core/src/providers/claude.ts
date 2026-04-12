// ============================================================
// Claude Adapter — Uses @anthropic-ai/claude-agent-sdk
// ============================================================
// Spawns Claude Code as a subprocess via the official SDK.
// No API key needed — uses the user's existing `claude auth login`.
// Supports streaming, extended thinking, tool approval, and
// multi-turn conversations via async iterable prompt queues.

import {
  query,
  type Options as ClaudeQueryOptions,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
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
  approvalRequired,
} from './types';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    isDefault: true,
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
    supportsThinking: false,
    maxTokens: 8192,
    contextWindow: 200000,
  },
];

// ----------------------------------------------------------
// Async iterable queue for multi-turn prompts
// ----------------------------------------------------------

class PromptQueue {
  private queue: SDKUserMessage[] = [];
  private resolve: (() => void) | null = null;
  private done = false;

  push(msg: SDKUserMessage) {
    this.queue.push(msg);
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  close() {
    this.done = true;
    if (this.resolve) {
      this.resolve();
      this.resolve = null;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<SDKUserMessage> {
    while (!this.done) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!;
      } else {
        await new Promise<void>((r) => { this.resolve = r; });
      }
    }
    // Drain remaining
    while (this.queue.length > 0) {
      yield this.queue.shift()!;
    }
  }
}

// ----------------------------------------------------------
// Session state
// ----------------------------------------------------------

interface ClaudeSession {
  threadId: string;
  cwd: string;
  sessionId: string;
  promptQueue: PromptQueue;
  queryRuntime: any; // The query() return value
  streamIterator: AsyncIterableIterator<SDKMessage> | null;
  aborted: boolean;
  interruptFn: (() => Promise<void>) | null;
  closeFn: (() => void) | null;
  // Pending approval resolvers
  pendingApprovals: Map<string, {
    resolve: (result: { behavior: string; updatedInput?: unknown; message?: string }) => void;
    toolName: string;
    toolInput: unknown;
  }>;
}

// ----------------------------------------------------------
// Claude Adapter
// ----------------------------------------------------------

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude' as const;

  private sessions = new Map<string, ClaudeSession>();
  private ready = false;
  private claudeBinaryPath: string | null = null;

  constructor(private _getApiKey: () => string | undefined) {}

  async initialize(): Promise<boolean> {
    // Check if `claude` binary is available
    try {
      const path = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
      if (path) {
        this.claudeBinaryPath = path;
        this.ready = true;
        console.log(`[Claude] Found binary at: ${path}`);
        return true;
      }
    } catch {
      // Try common paths
      const commonPaths = [
        '/usr/local/bin/claude',
        `${process.env.HOME}/.claude/local/claude`,
        `${process.env.HOME}/.local/bin/claude`,
      ];
      for (const p of commonPaths) {
        try {
          execSync(`test -x "${p}"`, { timeout: 2000 });
          this.claudeBinaryPath = p;
          this.ready = true;
          console.log(`[Claude] Found binary at: ${p}`);
          return true;
        } catch {
          // continue
        }
      }
    }

    // Fallback: also check API key for direct SDK usage
    const key = this._getApiKey();
    if (key) {
      this.ready = true;
      console.log('[Claude] No binary found, but API key available');
      return true;
    }

    console.log('[Claude] Not ready — no binary and no API key');
    this.ready = false;
    return false;
  }

  isReady(): boolean {
    if (!this.ready) {
      // Re-probe
      try {
        const path = execSync('which claude', { encoding: 'utf-8', timeout: 3000, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
        if (path) {
          this.claudeBinaryPath = path;
          this.ready = true;
        }
      } catch {
        // Check API key
        if (this._getApiKey()) {
          this.ready = true;
        }
      }
    }
    return this.ready;
  }

  getModels(): ModelInfo[] {
    return CLAUDE_MODELS;
  }

  async startSession(threadId: string, cwd: string): Promise<void> {
    if (this.sessions.has(threadId)) return;

    const session: ClaudeSession = {
      threadId,
      cwd,
      sessionId: randomUUID(),
      promptQueue: new PromptQueue(),
      queryRuntime: null,
      streamIterator: null,
      aborted: false,
      interruptFn: null,
      closeFn: null,
      pendingApprovals: new Map(),
    };

    this.sessions.set(threadId, session);
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent> {
    let session = this.sessions.get(input.threadId);
    if (!session) {
      await this.startSession(input.threadId, '.');
      session = this.sessions.get(input.threadId)!;
    }

    const turnId = `turn-${Date.now()}`;
    const effort = input.modelSelection?.effort ?? 'high';
    const modelId = input.modelSelection?.modelId ?? 'claude-sonnet-4-6';

    // Map effort to thinking budget
    const effortBudgetMap: Record<string, number | null> = {
      'low': null,
      'medium': 5000,
      'high': 10000,
      'max': 100000,
    };
    const thinkingBudget = effortBudgetMap[effort] ?? 10000;

    // Push user message into the prompt queue
    const userMessage: SDKUserMessage = {
      type: 'user',
      content: input.text,
    } as any;

    // If no query running, start one
    if (!session.queryRuntime) {
      try {
        const queryOptions: ClaudeQueryOptions = {
          sessionId: session.sessionId,
          includePartialMessages: true,
          env: process.env,
          model: modelId,
          effort: effort === 'low' ? null : effort as any,
          permissionMode: input.interactionMode === 'plan' ? 'plan' as any : undefined,
          canUseTool: async (toolName: string, toolInput: Record<string, unknown>, opts: any) => {
            // Generate a request ID for this approval
            const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

            // Create a deferred promise
            const deferred = {
              resolve: null as any,
              toolName,
              toolInput,
            };
            const promise = new Promise<{ behavior: string; updatedInput?: unknown; message?: string }>((resolve) => {
              deferred.resolve = resolve;
            });
            session!.pendingApprovals.set(requestId, deferred as any);

            // Yield an approval-required event (we'll handle this via the event channel)
            // The approval will be resolved externally via respondToApproval()
            this._pendingApprovalEmitter?.(input.threadId, requestId, toolName, toolInput, turnId);

            // Handle abort
            if (opts?.signal) {
              opts.signal.addEventListener('abort', () => {
                session!.pendingApprovals.delete(requestId);
                deferred.resolve({ behavior: 'deny', message: 'Turn interrupted' });
              });
            }

            return promise;
          },
        } as any;

        if (this.claudeBinaryPath) {
          (queryOptions as any).pathToClaudeCodeExecutable = this.claudeBinaryPath;
        }

        if (thinkingBudget != null) {
          (queryOptions as any).settings = {
            alwaysThinkingEnabled: true,
          };
        }

        if (session.cwd && session.cwd !== '.') {
          queryOptions.cwd = session.cwd;
        }

        // Start the query with prompt iterable
        const promptIterable = session.promptQueue[Symbol.asyncIterator]();
        const q = query({
          prompt: { [Symbol.asyncIterator]: () => promptIterable } as any,
          options: queryOptions,
        });

        session.queryRuntime = q;
        session.interruptFn = (q as any).interrupt?.bind(q) ?? null;
        session.closeFn = (q as any).close?.bind(q) ?? null;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Claude] Failed to start query:', msg);
        yield turnError(input.threadId, `Failed to start Claude session: ${msg}`, turnId);
        return;
      }
    }

    // Push the user message
    session.promptQueue.push(userMessage);

    // Stream events from the query
    let fullText = '';
    let thinkingText = '';

    try {
      for await (const message of session.queryRuntime as AsyncIterable<SDKMessage>) {
        if (session.aborted) break;

        switch (message.type) {
          case 'stream_event': {
            const event = (message as any).event;
            if (!event) break;

            if (event.type === 'content_block_start') {
              const block = event.content_block;
              if (block?.type === 'thinking') {
                thinkingText = '';
              } else if (block?.type === 'tool_use') {
                yield toolUseStart(
                  input.threadId,
                  block.name ?? 'unknown',
                  block.id ?? `tool-${Date.now()}`,
                  null,
                  turnId,
                );
              }
            }

            if (event.type === 'content_block_delta') {
              const delta = event.delta;
              if (delta?.type === 'text_delta' && delta.text) {
                fullText += delta.text;
                yield textDelta(input.threadId, delta.text, turnId);
              } else if (delta?.type === 'thinking_delta' && delta.thinking) {
                thinkingText += delta.thinking;
                yield thinkingDelta(input.threadId, delta.thinking, turnId);
              }
            }

            if (event.type === 'content_block_stop') {
              if (thinkingText) {
                yield thinkingDone(input.threadId, thinkingText, turnId);
                thinkingText = '';
              }
            }

            if (event.type === 'message_stop') {
              if (fullText) {
                yield textDone(input.threadId, fullText, turnId);
              }
            }
            break;
          }

          case 'assistant': {
            // Complete assistant message (non-streaming fallback)
            const content = (message as any).content;
            if (Array.isArray(content)) {
              for (const block of content) {
                if (block.type === 'text') {
                  fullText += block.text;
                  yield textDelta(input.threadId, block.text, turnId);
                } else if (block.type === 'tool_use') {
                  yield toolUseStart(
                    input.threadId,
                    block.name ?? 'unknown',
                    block.id ?? `tool-${Date.now()}`,
                    block.input,
                    turnId,
                  );
                  yield toolUseDone(input.threadId, block.id, block.input, turnId);
                }
              }
            } else if (typeof content === 'string') {
              fullText += content;
              yield textDelta(input.threadId, content, turnId);
            }
            break;
          }

          case 'result': {
            // Turn complete
            const usage = {
              inputTokens: (message as any).usage?.input_tokens ?? 0,
              outputTokens: (message as any).usage?.output_tokens ?? 0,
            };

            if (fullText) {
              yield textDone(input.threadId, fullText, turnId);
            }
            yield turnComplete(input.threadId, turnId, usage);

            // Store session ID for future resume
            if ((message as any).session_id) {
              session.sessionId = (message as any).session_id;
            }

            // This turn is done — break out of the for-await loop
            // The query stays alive for the next turn
            return;
          }

          case 'system': {
            // System messages (notifications)
            const subtype = (message as any).subtype;
            if (subtype === 'error') {
              yield turnError(input.threadId, (message as any).message ?? 'Claude system error', turnId);
              return;
            }
            break;
          }

          default:
            // tool_progress, auth_status, rate_limit_event, etc. — skip
            break;
        }
      }

      // If we get here without a result, the stream ended unexpectedly
      if (fullText) {
        yield textDone(input.threadId, fullText, turnId);
      }
      yield turnComplete(input.threadId, turnId);
    } catch (error: unknown) {
      if (session.aborted) {
        yield turnError(input.threadId, 'Turn interrupted by user', turnId);
      } else {
        let msg = error instanceof Error ? error.message : 'Unknown Claude error';
        // Try to extract nested API error details
        if (error instanceof Error && (error as any).stderr) {
          const stderr = String((error as any).stderr);
          // Look for JSON error payloads in stderr
          const jsonMatch = stderr.match(/\{[^}]*"error"[^}]*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.error?.message) {
                msg = parsed.error.message;
              }
            } catch { /* ignore parse errors */ }
          } else if (stderr.trim()) {
            msg = `${msg}: ${stderr.trim().slice(0, 200)}`;
          }
        }
        console.error('[Claude] Stream error:', msg);
        yield turnError(input.threadId, msg, turnId);
      }
      // Clean up session so next message starts a fresh query
      session.queryRuntime = null;
      session.streamIterator = null;
      session.aborted = false;
    }
  }

  // Approval event emitter — set by the server to broadcast approval events
  private _pendingApprovalEmitter: ((
    threadId: string,
    requestId: string,
    toolName: string,
    toolInput: unknown,
    turnId: string,
  ) => void) | null = null;

  /** Set a callback to emit approval-required events to the server's broadcast */
  onApprovalRequired(
    emitter: (threadId: string, requestId: string, toolName: string, toolInput: unknown, turnId: string) => void,
  ) {
    this._pendingApprovalEmitter = emitter;
  }

  async interruptTurn(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    session.aborted = true;
    if (session.interruptFn) {
      try {
        await session.interruptFn();
      } catch {
        // Best-effort
      }
    }

    // Reject all pending approvals
    for (const [requestId, pending] of session.pendingApprovals) {
      pending.resolve({ behavior: 'deny', message: 'Turn interrupted' });
    }
    session.pendingApprovals.clear();
  }

  async respondToApproval(
    threadId: string,
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    const pending = session.pendingApprovals.get(requestId);
    if (!pending) return;

    session.pendingApprovals.delete(requestId);

    if (decision === 'accept' || decision === 'always-allow') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: pending.toolInput as Record<string, unknown>,
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: 'User declined tool execution.',
      });
    }
  }

  async stopSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    session.aborted = true;
    session.promptQueue.close();

    if (session.closeFn) {
      try {
        session.closeFn();
      } catch {
        // Best-effort
      }
    }

    // Reject all pending approvals
    for (const [, pending] of session.pendingApprovals) {
      pending.resolve({ behavior: 'deny', message: 'Session stopped' });
    }
    session.pendingApprovals.clear();

    this.sessions.delete(threadId);
  }

  async stopAll(): Promise<void> {
    for (const threadId of [...this.sessions.keys()]) {
      await this.stopSession(threadId);
    }
  }
}
