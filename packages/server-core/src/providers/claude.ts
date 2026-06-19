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
  ProviderSlashCommand,
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
  userInputRequired,
  compactBoundary,
  planProposed,
  type UserInputQuestion,
  type UserInputAnswer,
} from './types';
import { execSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

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

// Catalog mirrors t3code's ClaudeProvider BUILT_IN_MODELS (2026-06 sync).
// The Claude CLI has no model-list RPC, so like t3code we ship a static
// catalog and gate the newest models on the installed CLI version
// (`claude --version`), filtered in getModels().

const FULL_EFFORT_LEVELS = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High', isDefault: true },
  { value: 'xhigh', label: 'Extra High' },
  { value: 'max', label: 'Max' },
  { value: 'ultracode', label: 'Ultracode' },
  { value: 'ultrathink', label: 'Ultrathink' },
];

const WIDE_CONTEXT_OPTIONS = [
  { value: '200k', label: '200k', isDefault: true },
  { value: '1m', label: '1M' },
];

// Minimum `claude --version` required for the newest models (t3code parity).
const CLAUDE_MODEL_MIN_CLI_VERSION: Record<string, string> = {
  'claude-fable-5': '2.1.169',
  'claude-opus-4-8': '2.1.154',
  'claude-opus-4-7': '2.1.111',
};

const CLAUDE_MODELS: ModelInfo[] = [
  {
    id: 'claude-fable-5',
    name: 'Claude Fable 5',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: {
      reasoningEffortLevels: FULL_EFFORT_LEVELS,
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: WIDE_CONTEXT_OPTIONS,
      promptInjectedEffortLevels: ['ultrathink'],
    },
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: {
      reasoningEffortLevels: FULL_EFFORT_LEVELS,
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: ['ultrathink'],
    },
  },
  {
    id: 'claude-opus-4-7',
    name: 'Claude Opus 4.7',
    provider: 'claude',
    supportsThinking: true,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: {
      reasoningEffortLevels: [
        { value: 'low', label: 'Low' },
        { value: 'medium', label: 'Medium' },
        { value: 'high', label: 'High' },
        { value: 'xhigh', label: 'Extra High', isDefault: true },
        { value: 'max', label: 'Max' },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
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
      contextWindowOptions: WIDE_CONTEXT_OPTIONS,
      promptInjectedEffortLevels: ['ultrathink'],
    },
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
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
      ],
      supportsFastMode: true,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  },
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
        { value: 'max', label: 'Max' },
        { value: 'ultrathink', label: 'Ultrathink' },
      ],
      supportsFastMode: false,
      supportsThinkingToggle: false,
      contextWindowOptions: WIDE_CONTEXT_OPTIONS,
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

/** Parse "2.1.173 (Claude Code)" → [2, 1, 173]. Returns null when unparsable. */
function parseCliVersion(raw: string): number[] | null {
  const m = raw.match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function cliVersionAtLeast(version: number[], minimum: string): boolean {
  const min = parseCliVersion(minimum)!;
  for (let i = 0; i < 3; i++) {
    if (version[i] !== min[i]) return version[i] > min[i];
  }
  return true;
}

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
    resolve: (result: { behavior: string; updatedInput?: unknown; message?: string; updatedPermissions?: unknown[] }) => void;
    toolName: string;
    toolInput: unknown;
    /** SDK PermissionUpdate suggestions for "always allow" persistence. */
    suggestions?: unknown[];
  }>;
  // Pending AskUserQuestion resolvers (keyed by requestId)
  pendingUserInputs: Map<string, {
    resolve: (answers: UserInputAnswer[]) => void;
    questions: UserInputQuestion[];
  }>;
}

function normalizeApprovalDecision(decision: ApprovalDecision): 'accept' | 'reject' | 'always-allow' {
  if (decision === 'acceptForSession') return 'always-allow';
  if (decision === 'decline') return 'reject';
  return decision;
}

function isAutoApprovedClaudeTool(
  _toolName: string,
  runtimeMode: SendTurnInput['runtimeMode'],
): boolean {
  // full-access maps to bypassPermissions, but keep the belt-and-braces allow
  // in case the SDK still consults canUseTool. auto-accept-edits relies on the
  // SDK's own acceptEdits permissionMode — the old substring list here
  // (edit/write/create/delete/...) silently auto-approved ANY tool whose name
  // contained one of those tokens, including MCP tools like delete_record.
  return runtimeMode === 'full-access';
}

function formatUserInputAnswersForModel(answers: UserInputAnswer[]): string {
  const lines: string[] = [];
  answers.forEach((a, i) => {
    lines.push(`Q${i + 1}: "${a.question}"`);
    if (a.selections.length === 0) {
      lines.push('→ (no answer)');
    } else if (a.selections.length === 1) {
      lines.push(`→ Selected: "${a.selections[0]}"`);
    } else {
      lines.push(`→ Selected: ${a.selections.map((s) => `"${s}"`).join(', ')}`);
    }
    if (a.notes && a.notes.trim()) {
      lines.push(`Notes: "${a.notes.trim()}"`);
    }
    lines.push('');
  });
  return lines.join('\n').trimEnd();
}

function getClaudeModelInfo(modelId: string | undefined): ModelInfo {
  return (
    CLAUDE_MODELS.find((model) => model.id === modelId) ??
    CLAUDE_MODELS.find((model) => model.isDefault) ??
    CLAUDE_MODELS[0]
  );
}

function resolveClaudeApiModelId(model: ModelInfo, contextWindow: string | undefined) {
  if (contextWindow === '1m' && model.capabilities.contextWindowOptions.some((option) => option.value === '1m')) {
    return `${model.id}[1m]`;
  }
  return model.id;
}

// SDK 0.2.104 only accepts low|medium|high|max. Port of t3code's
// normalizeClaudeCliEffort: ultrathink is prompt-injected (no CLI effort),
// ultracode/xhigh degrade to max, and sonnet-4-6 caps at high.
function normalizeClaudeCliEffort(
  effort: string | undefined,
  modelId: string,
): 'low' | 'medium' | 'high' | 'max' | undefined {
  if (!effort || effort === 'ultrathink') return undefined;
  let level = effort;
  if (level === 'ultracode' || level === 'xhigh') level = 'max';
  if (level === 'max' && modelId === 'claude-sonnet-4-6') level = 'high';
  if (level === 'low' || level === 'medium' || level === 'high' || level === 'max') return level;
  return undefined;
}

// Minimal seed of universal Claude slash commands, shown until the capability
// probe returns the installation's real list (descriptions + argument hints +
// custom/project/plugin commands). Only commands confirmed to work through
// query() prompts belong here — /clear, /model etc. are interactive-CLI-only
// and are NOT valid as prompt text.
const CLAUDE_SLASH_COMMAND_SEED: ProviderSlashCommand[] = [
  { name: 'compact', description: 'Clear conversation history but keep a summary in context', argumentHint: '<optional custom summarization instructions>' },
  { name: 'context', description: 'Show current context usage' },
  { name: 'cost', description: 'Show the total cost and duration of the current session' },
];

/** Trim/drop-empty + case-insensitive dedupe; later duplicates only backfill
 *  missing description/argumentHint (t3code parity). */
function dedupeSlashCommands(commands: ProviderSlashCommand[]): ProviderSlashCommand[] {
  const byName = new Map<string, ProviderSlashCommand>();
  for (const cmd of commands) {
    const name = cmd.name?.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    const existing = byName.get(key);
    if (!existing) {
      byName.set(key, {
        name,
        ...(cmd.description?.trim() ? { description: cmd.description.trim() } : {}),
        ...(cmd.argumentHint?.trim() ? { argumentHint: cmd.argumentHint.trim() } : {}),
      });
    } else {
      if (!existing.description && cmd.description?.trim()) existing.description = cmd.description.trim();
      if (!existing.argumentHint && cmd.argumentHint?.trim()) existing.argumentHint = cmd.argumentHint.trim();
    }
  }
  return [...byName.values()];
}

// ----------------------------------------------------------
// Claude Adapter
// ----------------------------------------------------------

export class ClaudeAdapter implements ProviderAdapter {
  readonly provider = 'claude' as const;

  private sessions = new Map<string, ClaudeSession>();
  private ready = false;
  private claudeBinaryPath: string | null = null;
  /** Parsed `claude --version`; null = probe failed (show full catalog). */
  private cliVersion: number[] | null = null;
  /** Slash command names discovered from the SDK `init` message. Populated on
   *  the first turn of any session; names only (no descriptions). */
  private discoveredSlashCommands: string[] = [];
  /** Rich command list from the capability probe (descriptions + argument
   *  hints + custom/project/plugin commands). Highest-priority source. */
  private richSlashCommands: ProviderSlashCommand[] | null = null;
  /** Disk-cached command list seeded by the registry before the probe lands,
   *  so the composer has the full list immediately after a server restart. */
  private seededSlashCommands: ProviderSlashCommand[] | null = null;
  /** Wired by the registry to persist probe results across restarts. */
  private _onCapabilitiesUpdated: ((commands: ProviderSlashCommand[]) => void) | null = null;

  /** Seed the command list from a persisted cache (called by the registry). */
  seedSlashCommands(commands: ProviderSlashCommand[]): void {
    if (commands.length) this.seededSlashCommands = dedupeSlashCommands(commands);
  }

  /** Register a listener for fresh probe results (called by the registry). */
  onCapabilitiesUpdated(cb: (commands: ProviderSlashCommand[]) => void): void {
    this._onCapabilitiesUpdated = cb;
  }

  // Callbacks wired at boot (server.ts) to persist / fetch resume cursors.
  // Using callbacks (same pattern as onApprovalRequired) keeps the adapter
  // free of direct DB coupling.
  private _onCursorPersist: ((threadId: string, sessionId: string | null) => void) | null = null;
  private _getCursor: ((threadId: string) => string | null) | null = null;

  /** Wire cursor persistence.  Called once in server.ts after adapter init. */
  onCursorPersist(
    persist: (threadId: string, sessionId: string | null) => void,
    getCursor: (threadId: string) => string | null,
  ): void {
    this._onCursorPersist = persist;
    this._getCursor = getCursor;
  }

  constructor(private _getApiKey: () => string | undefined) {}

  /** Probe `claude --version` to gate newest models (t3code parity). */
  private probeCliVersion(): void {
    if (!this.claudeBinaryPath) return;
    try {
      const out = execSync(`"${this.claudeBinaryPath}" --version`, {
        encoding: 'utf-8',
        timeout: 4000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      this.cliVersion = parseCliVersion(out);
      if (this.cliVersion) {
        console.log(`[Claude] CLI version: ${this.cliVersion.join('.')}`);
      }
    } catch {
      this.cliVersion = null;
    }
  }

  async initialize(): Promise<boolean> {
    // Check if `claude` binary is available
    try {
      const path = execSync('which claude', { encoding: 'utf-8', timeout: 5000 }).trim();
      if (path) {
        this.claudeBinaryPath = path;
        this.ready = true;
        console.log(`[Claude] Found binary at: ${path}`);
        this.probeCliVersion();
        void this.probeCapabilities();
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
          this.probeCliVersion();
          void this.probeCapabilities();
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
    // Unknown CLI version (probe failed / API-key mode): show the full
    // catalog rather than an empty/short picker — t3code does the same.
    if (!this.cliVersion) return CLAUDE_MODELS;
    return CLAUDE_MODELS.filter((model) => {
      const min = CLAUDE_MODEL_MIN_CLI_VERSION[model.id];
      return !min || cliVersionAtLeast(this.cliVersion!, min);
    });
  }

  getSlashCommands(): ProviderSlashCommand[] {
    // Priority: live probe result > disk-cached seed > minimal built-in seed.
    // Per-session init messages contribute extra names (no descriptions) so
    // commands appearing mid-uptime still surface before the next probe.
    const base = this.richSlashCommands ?? this.seededSlashCommands ?? CLAUDE_SLASH_COMMAND_SEED;
    const merged = dedupeSlashCommands([
      ...base,
      ...this.discoveredSlashCommands.map((name) => ({ name })),
    ]);
    return merged.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Capability probe (t3code pattern): spawn an SDK query whose prompt never
   * yields — the subprocess completes its local initialization IPC but never
   * sends an API request — then read initializationResult() for the rich
   * command list (descriptions, argument hints, user/project/plugin commands).
   * Fire-and-forget from initialize(); failure degrades to the seed list.
   */
  private async probeCapabilities(): Promise<void> {
    if (!this.claudeBinaryPath) return;
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 8000);
    try {
      const neverYield = (async function* (): AsyncGenerator<SDKUserMessage> {
        await new Promise<void>((resolve) => {
          abort.signal.addEventListener('abort', () => resolve(), { once: true });
        });
      })();
      const q = query({
        prompt: neverYield,
        options: {
          abortController: abort,
          persistSession: false,
          allowedTools: [],
          // What makes user/project custom commands + plugin commands appear.
          settingSources: ['user', 'project', 'local'],
          pathToClaudeCodeExecutable: this.claudeBinaryPath,
          env: process.env,
        } as any,
      });
      const init = await (q as any).initializationResult();
      const commands = Array.isArray(init?.commands) ? (init.commands as unknown[]) : [];
      const parsed = dedupeSlashCommands(
        commands.map((c: any) => ({
          name: String(c?.name ?? ''),
          description: typeof c?.description === 'string' ? c.description : undefined,
          argumentHint: typeof c?.argumentHint === 'string' ? c.argumentHint : undefined,
        })),
      );
      if (parsed.length) {
        this.richSlashCommands = parsed;
        this._onCapabilitiesUpdated?.(parsed);
        console.log(`[Claude] Capability probe: ${parsed.length} slash commands`);
      }
    } catch (err) {
      console.warn('[Claude] Capability probe failed:', err instanceof Error ? err.message : String(err));
    } finally {
      clearTimeout(timeout);
      abort.abort();
    }
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
      pendingUserInputs: new Map(),
    };

    this.sessions.set(threadId, session);
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent> {
    let session = this.sessions.get(input.threadId);
    if (!session) {
      // No in-memory session — check for a stored resume cursor first.
      // This is the server-restart recovery path: the DB has a cursor from a
      // previous run, so we reconstruct the session with hasStarted=true and
      // the stored sessionId so the first query() call uses `resume:` rather
      // than `sessionId:` (which would start a brand-new blank session).
      const storedSessionId = this._getCursor?.(input.threadId) ?? null;
      await this.startSession(input.threadId, input.cwd ?? '.');
      session = this.sessions.get(input.threadId)!;
      if (storedSessionId) {
        session.sessionId = storedSessionId;
        session.hasStarted = true;
        console.log(`[Claude] Restored session for thread ${input.threadId} from stored cursor`);
      }
    } else if (input.cwd && session.cwd === '.') {
      // Backfill cwd if it wasn't set at session creation time
      session.cwd = input.cwd;
    }

    session.aborted = false;

    // If this session was restored from a stored cursor, attempt the turn.
    // On SDK rejection of a stale cursor (session expired / pruned on the CLI
    // side), we detect the error, wipe the stored cursor, start a fresh
    // session, and retry once — transparently, without surfacing a turnError.
    // We pass a flag through a local boolean to avoid a recursive generator;
    // the retry is an explicit yield* delegation.
    const isRestoredSession = session.hasStarted && this._getCursor?.(input.threadId) !== null;
    yield* this._doSendTurn(input, session, isRestoredSession);
  }

  /** Inner turn generator. Extracted so sendTurn can retry once on stale-cursor errors. */
  private async *_doSendTurn(
    input: SendTurnInput,
    session: ClaudeSession,
    allowStaleCursorRetry: boolean,
  ): AsyncGenerator<ProviderEvent> {
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
        effort: normalizeClaudeCliEffort(effort, modelInfo.id),
        permissionMode:
          input.interactionMode === 'plan'
            ? 'plan'
            : input.runtimeMode === 'full-access'
              ? 'bypassPermissions'
              : input.runtimeMode === 'auto-accept-edits'
                ? 'acceptEdits'
                : undefined,
        // Required for bypassPermissions on newer CLIs — without it some
        // versions still prompt (t3code sets the same pair).
        ...(input.interactionMode !== 'plan' && input.runtimeMode === 'full-access'
          ? { allowDangerouslySkipPermissions: true }
          : {}),
        canUseTool: async (toolName: string, toolInput: Record<string, unknown>, opts: any) => {
          // ----------------------------------------------------------
          // AskUserQuestion — intercept the SDK's built-in interactive
          // question tool and route it to a proper mobile question form
          // instead of the generic approval dialog.
          //
          // Contract: the SDK calls canUseTool with the tool input. We
          // surface a `user-input-required` event, wait for the user to
          // submit answers, and return `{ behavior: 'deny', message: <formatted answers> }`.
          // Denying with a message feeds that message back to the model
          // as the tool_result content — the model treats it as the
          // tool's output and continues the turn with the user's choices.
          //
          // Edge cases:
          //  - Turn interrupted before submit → resolve with empty answers
          //    so the Deferred never leaks; model sees "(no answer)" text.
          //  - Server restart while the prompt is pending → the request
          //    is lost (pendingUserInputs is in-memory only). Documented.
          // ----------------------------------------------------------
          if (toolName === 'AskUserQuestion') {
            const rawQuestions = Array.isArray((toolInput as any)?.questions)
              ? ((toolInput as any).questions as unknown[])
              : [];
            const questions: UserInputQuestion[] = rawQuestions.map((q: any) => ({
              question: String(q?.question ?? ''),
              header: String(q?.header ?? ''),
              multiSelect: Boolean(q?.multiSelect),
              options: Array.isArray(q?.options)
                ? q.options.map((o: any) => ({
                    label: String(o?.label ?? ''),
                    description: String(o?.description ?? ''),
                    preview: typeof o?.preview === 'string' ? o.preview : undefined,
                  }))
                : [],
            }));

            const requestId = `userinput-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
            const deferred: {
              resolve: (answers: UserInputAnswer[]) => void;
              questions: UserInputQuestion[];
            } = { resolve: null as any, questions };
            const promise = new Promise<UserInputAnswer[]>((resolve) => {
              deferred.resolve = resolve;
            });
            session!.pendingUserInputs.set(requestId, deferred);
            this._pendingUserInputEmitter?.(input.threadId, requestId, questions, turnId);

            if (opts?.signal) {
              opts.signal.addEventListener('abort', () => {
                session!.pendingUserInputs.delete(requestId);
                deferred.resolve([]);
              });
            }

            const answers = await promise;
            const formatted = answers.length
              ? formatUserInputAnswersForModel(answers)
              : 'User did not answer (turn interrupted).';
            // Returning `deny` with a `message` hands the message back to
            // the model as the tool_result content. This is the only
            // PermissionResult shape that lets us substitute output
            // without actually invoking the SDK-provided tool handler.
            return {
              behavior: 'deny',
              message: formatted,
            };
          }

          // ----------------------------------------------------------
          // ExitPlanMode — the model finished planning and proposes a plan.
          // Surface it as a dedicated plan card (not a raw JSON approval).
          // Deny-with-instruction (t3code pattern): the message becomes the
          // tool_result, telling the model to stop and wait for the user.
          // ----------------------------------------------------------
          if (toolName === 'ExitPlanMode') {
            const plan = typeof (toolInput as any)?.plan === 'string' ? (toolInput as any).plan : '';
            this._planProposedEmitter?.(input.threadId, plan, turnId);
            return {
              behavior: 'deny',
              message:
                'The plan was shown to the user for review. Stop here and wait — the user will approve the plan or give feedback in their next message.',
            };
          }

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
            // SDK-provided PermissionUpdate suggestions — echoed back as
            // updatedPermissions on "always allow" so the rule actually
            // persists for the session (without this, always-allow was a
            // one-shot accept).
            suggestions: Array.isArray(opts?.suggestions) ? opts.suggestions : undefined,
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
        // A nonexistent cwd makes spawn fail ENOENT, which the SDK reports as
        // "Claude Code native binary not found" — a wild goose chase. Fail
        // with the real reason instead. (Seen with sessions whose folder
        // exists on a different server — shared ~/.stavi SQLite.)
        if (!existsSync(session.cwd)) {
          // NB arg order is (threadId, error, turnId) — was swapped, showing
          // the turn id as the error text.
          yield turnError(
            input.threadId,
            `Session folder does not exist on this server: ${session.cwd}`,
            turnId,
          );
          return;
        }
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

            // NOTE: message_stop is NOT the authoritative completion signal — the
            // 'result' message is. textDone is emitted there (see case 'result' below).
            // Emitting here too caused duplicate text-done events to the client.
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

            // Store session ID for future resume — persisted to DB so the
            // cursor survives a server restart.
            if ((message as any).session_id) {
              session.sessionId = (message as any).session_id;
            }
            session.hasStarted = true;
            session.queryRuntime = null;
            this._onCursorPersist?.(input.threadId, session.sessionId);

            return;
          }

          case 'system': {
            // System messages (notifications)
            const subtype = (message as any).subtype;
            if (subtype === 'compact_boundary') {
              // /compact (or auto-compact) finished — context was summarized.
              const meta = (message as any).compact_metadata ?? {};
              yield compactBoundary(
                input.threadId,
                meta.trigger === 'auto' ? 'auto' : 'manual',
                Number(meta.pre_tokens ?? 0),
                turnId,
              );
              break;
            }
            if (subtype === 'init') {
              // The init message reports every slash command this installation
              // exposes. Capture it so the composer can offer the full set.
              const cmds = (message as any).slash_commands;
              if (Array.isArray(cmds)) {
                this.discoveredSlashCommands = cmds.filter(
                  (c: unknown): c is string => typeof c === 'string' && c.length > 0,
                );
              }
              break;
            }
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

      // If we get here without a result message, the stream ended unexpectedly.
      // Emit turnError — NOT turnComplete — and do NOT set hasStarted=true since
      // the session may be in a corrupted state (resume would use a bad sessionId).
      session.queryRuntime = null;
      yield turnError(input.threadId, 'Stream ended unexpectedly without completion', turnId);
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

        // Stale cursor recovery: if this turn was started from a restored
        // (DB-persisted) cursor and the SDK rejected it (session no longer
        // exists on the CLI side), silently drop the cursor and retry once
        // with a fresh session.  We only attempt this if no tokens were
        // streamed (fullText empty) so we never silently swallow partial
        // responses.
        const isStaleCursor =
          allowStaleCursorRetry &&
          !fullText &&
          (msg.includes('session') || msg.includes('resume') || msg.includes('not found') || msg.includes('expired'));

        if (isStaleCursor) {
          console.warn(`[Claude] Stale cursor for thread ${input.threadId} — clearing and retrying fresh`);
          this._onCursorPersist?.(input.threadId, null);
          session.sessionId = randomUUID();
          session.hasStarted = false;
          session.queryRuntime = null;
          session.aborted = false;
          yield* this._doSendTurn(input, session, false /* no further retry */);
          return;
        }

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

  // User-input event emitter — set by the server to broadcast AskUserQuestion events
  private _pendingUserInputEmitter: ((
    threadId: string,
    requestId: string,
    questions: UserInputQuestion[],
    turnId: string,
  ) => void) | null = null;

  /** Set a callback to emit user-input-required events to the server's broadcast */
  onUserInputRequired(
    emitter: (threadId: string, requestId: string, questions: UserInputQuestion[], turnId: string) => void,
  ) {
    this._pendingUserInputEmitter = emitter;
  }

  // Plan-proposed emitter — set by the server to broadcast ExitPlanMode plans
  private _planProposedEmitter: ((threadId: string, plan: string, turnId: string) => void) | null = null;

  /** Set a callback to emit plan-proposed events (ExitPlanMode interception). */
  onPlanProposed(emitter: (threadId: string, plan: string, turnId: string) => void) {
    this._planProposedEmitter = emitter;
  }

  /** Called from server.ts when the mobile client submits the AskUserQuestion form. */
  async respondToUserInput(
    threadId: string,
    requestId: string,
    answers: UserInputAnswer[],
  ): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;
    const pending = session.pendingUserInputs.get(requestId);
    if (!pending) return;
    session.pendingUserInputs.delete(requestId);
    pending.resolve(answers);
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

    // Resolve pending user-input requests with empty answers
    for (const [, pending] of session.pendingUserInputs) {
      pending.resolve([]);
    }
    session.pendingUserInputs.clear();
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

    if (normalizedDecision === 'always-allow') {
      // Echo the SDK's suggested PermissionUpdates back so the rule persists
      // for the session — without them this was identical to a one-shot accept.
      pending.resolve({
        behavior: 'allow',
        updatedInput: pending.toolInput as Record<string, unknown>,
        ...(pending.suggestions?.length ? { updatedPermissions: pending.suggestions } : {}),
      });
    } else if (normalizedDecision === 'accept') {
      pending.resolve({
        behavior: 'allow',
        updatedInput: pending.toolInput as Record<string, unknown>,
      });
    } else {
      pending.resolve({
        behavior: 'deny',
        message: 'The user declined this tool use. Continue without it; ask the user if you are unsure how to proceed.',
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

    // Resolve pending user-input requests with empty answers
    for (const [, pending] of session.pendingUserInputs) {
      pending.resolve([]);
    }
    session.pendingUserInputs.clear();

    this.sessions.delete(threadId);
  }

  async stopAll(): Promise<void> {
    for (const threadId of [...this.sessions.keys()]) {
      await this.stopSession(threadId);
    }
  }
}
