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
  ModelCapabilities,
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

const CLAUDE_DEFAULT_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [],
  supportsFastMode: false,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-sonnet-4-6',
    name: 'Claude Sonnet 4.6',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    isDefault: true,
    capabilities: {
      reasoningEffortLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High', isDefault: true },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: '200k', label: '200k', isDefault: true },
        { value: '1m', label: '1M' },
      ],
      promptInjectedEffortLevels: ['ultrathink'],
    },
  },
  {
    id: 'claude-opus-4-6',
    name: 'Claude Opus 4.6',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: {
      reasoningEffortLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High', isDefault: true },
        { value: 'max', label: 'Max' },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [
        { value: '200k', label: '200k', isDefault: true },
        { value: '1m', label: '1M' },
      ],
      promptInjectedEffortLevels: ['ultrathink'],
    },
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 8192,
    contextWindow: 200000,
    capabilities: {
      reasoningEffortLevels: [],
      supportsFastMode: false,
      supportsThinkingToggle: true,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
];

// ----------------------------------------------------------
// Session state
// ----------------------------------------------------------

interface ClaudeSession {
  threadId: string;
  cwd: string;
  sessionId: string;
  hasStarted: boolean;
  queryRuntime: any; // The query() return value
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

function normalizeApprovalDecision(decision: ApprovalDecision): 'accept' | 'reject' | 'always-allow' {
  if (decision === 'acceptForSession') return 'always-allow';
  if (decision === 'decline') return 'reject';
  return decision;
}

function isAutoApprovedClaudeTool(
  toolName: string,
  runtimeMode: SendTurnInput['runtimeMode'],
): boolean {
  if (runtimeMode === 'full-access') return true;
  if (runtimeMode !== 'auto-accept-edits') return false;

  const normalized = toolName.toLowerCase();
  return [
    'edit',
    'write',
    'multiedit',
    'replace',
    'create',
    'rename',
    'delete',
  ].some((token) => normalized.includes(token));
}

function getClaudeModelInfo(modelId: string | undefined): ModelInfo {
  return CLAUDE_MODELS.find((model) => model.id === modelId) ?? CLAUDE_MODELS[0];
}

function resolveClaudeApiModelId(model: ModelInfo, contextWindow: string | undefined) {
  if (contextWindow === '1m' && model.capabilities.contextWindowOptions.some((option) => option.value === '1m')) {
    return `${model.id}[1m]`;
  }
  return model.id;
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
      hasStarted: false,
      queryRuntime: null,
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
      await this.startSession(input.threadId, input.cwd ?? '.');
      session = this.sessions.get(input.threadId)!;
    } else if (input.cwd && session.cwd === '.') {
      // Backfill cwd if it wasn't set at session creation time
      session.cwd = input.cwd;
    }

    session.aborted = false;

    const turnId = `turn-${Date.now()}`;
    const modelInfo = getClaudeModelInfo(input.modelSelection?.modelId);
    const rawEffort = input.modelSelection?.effort;
    const effort =
      rawEffort &&
      modelInfo.capabilities.reasoningEffortLevels.some((level) => level.value === rawEffort) &&
      !modelInfo.capabilities.promptInjectedEffortLevels.includes(rawEffort)
        ? rawEffort
        : modelInfo.capabilities.reasoningEffortLevels.find((level) => level.isDefault)?.value;
    const apiModelId = resolveClaudeApiModelId(modelInfo, input.modelSelection?.contextWindow);
    const fastMode = modelInfo.capabilities.supportsFastMode && input.modelSelection?.fastMode === true;
    const thinking =
      modelInfo.capabilities.supportsThinkingToggle && typeof input.modelSelection?.thinking === 'boolean'
        ? input.modelSelection.thinking
        : undefined;

    const thinkingBudgetMap: Record<string, number | null> = {
      low: null,
      medium: 5000,
      high: 10000,
      max: 100000,
    };
    const thinkingConfig =
      thinking === false
        ? { type: 'disabled' as const }
        : typeof effort === 'string' && effort in thinkingBudgetMap
          ? thinkingBudgetMap[effort] == null
            ? undefined
            : modelInfo.id === 'claude-opus-4-6'
              ? { type: 'adaptive' as const }
              : { type: 'enabled' as const, budgetTokens: thinkingBudgetMap[effort]! }
          : thinking === true
            ? modelInfo.id === 'claude-opus-4-6'
              ? { type: 'adaptive' as const }
              : { type: 'enabled' as const, budgetTokens: 10000 }
            : undefined;

    const userMessage: SDKUserMessage = {
      type: 'user',
      message: { role: 'user', content: input.text },
      parent_tool_use_id: null,
    };

    try {
      const queryOptions: ClaudeQueryOptions = {
        includePartialMessages: true,
        env: process.env,
        model: apiModelId,
        effort: effort && effort !== 'ultrathink' && effort !== 'xhigh' ? effort as any : undefined,
        permissionMode:
          input.interactionMode === 'plan'
            ? 'plan'
            : input.runtimeMode === 'full-access'
              ? 'bypassPermissions'
              : input.runtimeMode === 'auto-accept-edits'
                ? 'acceptEdits'
                : undefined,
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>, opts: any) => {
          if (isAutoApprovedClaudeTool(toolName, input.runtimeMode)) {
            return {
              behavior: 'allow',
              updatedInput: toolInput,
            };
          }

          const requestId = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const deferred = {
            resolve: null as any,
            toolName,
            toolInput,
          };
          const promise = new Promise<{ behavior: string; updatedInput?: unknown; message?: string }>((resolve) => {
            deferred.resolve = resolve;
          });
          session!.pendingApprovals.set(requestId, deferred as any);
          this._pendingApprovalEmitter?.(input.threadId, requestId, toolName, toolInput, turnId);

          if (opts?.signal) {
            opts.signal.addEventListener('abort', () => {
              session!.pendingApprovals.delete(requestId);
              deferred.resolve({ behavior: 'deny', message: 'Turn interrupted' });
            });
          }

          return promise;
        },
      } as any;

      if (session.hasStarted) {
        (queryOptions as any).resume = session.sessionId;
      } else {
        queryOptions.sessionId = session.sessionId;
      }

      if (this.claudeBinaryPath) {
        (queryOptions as any).pathToClaudeCodeExecutable = this.claudeBinaryPath;
      }

      if (session.cwd && session.cwd !== '.') {
        queryOptions.cwd = session.cwd;
      }

      const settings: Record<string, unknown> = {};
      if (thinking !== undefined) {
        settings.alwaysThinkingEnabled = thinking;
      }
      if (fastMode) {
        settings.fastMode = true;
      }
      if (Object.keys(settings).length > 0) {
        (queryOptions as any).settings = settings;
      }
      if (thinkingConfig) {
        (queryOptions as any).thinking = thinkingConfig;
      }

      const promptText = rawEffort === 'ultrathink' ? `Ultrathink:\n${input.text.trim()}` : input.text;
      const q = query({
        prompt: {
          async *[Symbol.asyncIterator]() {
            yield {
              ...userMessage,
              message: { role: 'user', content: promptText },
            } as SDKUserMessage;
          },
        } as any,
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

    let fullText = '';
    let thinkingText = '';
    const toolInputBuffers = new Map<string, string>();

    try {
      for await (const message of session.queryRuntime as AsyncIterable<SDKMessage>) {
        if (session.aborted) break;
        switch ((message as SDKMessage).type) {
          case 'stream_event': {
            const event = (message as any).event;
            if (!event) break;

            if (event.type === 'content_block_start') {
              const block = event.content_block;
              if (block?.type === 'thinking') {
                thinkingText = '';
              } else if (block?.type === 'tool_use') {
                const toolId = block.id ?? `tool-${Date.now()}`;
                if (block.input && typeof block.input === 'object') {
                  toolInputBuffers.set(toolId, JSON.stringify(block.input));
                } else {
                  toolInputBuffers.set(toolId, '');
                }
                yield toolUseStart(
                  input.threadId,
                  block.name ?? 'unknown',
                  toolId,
                  block.input ?? null,
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
              } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
                const toolId = event.content_block?.id;
                if (toolId) {
                  const next = (toolInputBuffers.get(toolId) ?? '') + delta.partial_json;
                  toolInputBuffers.set(toolId, next);
                  try {
                    yield {
                      type: 'tool-use-delta',
                      threadId: input.threadId,
                      turnId,
                      data: {
                        toolId,
                        input: JSON.parse(next),
                      },
                    };
                  } catch {
                    // Partial JSON — wait for more chunks.
                  }
                }
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
            session.hasStarted = true;
            session.queryRuntime = null;

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

      if (session.aborted) {
        session.queryRuntime = null;
        session.aborted = false;
        yield turnError(input.threadId, 'Turn interrupted by user', turnId);
        return;
      }

      // If we get here without a result, the stream ended unexpectedly
      if (fullText) {
        yield textDone(input.threadId, fullText, turnId);
      }
      yield turnComplete(input.threadId, turnId);
      session.queryRuntime = null;
      session.hasStarted = true;
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

    const normalizedDecision = normalizeApprovalDecision(decision);

    if (normalizedDecision === 'accept' || normalizedDecision === 'always-allow') {
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
