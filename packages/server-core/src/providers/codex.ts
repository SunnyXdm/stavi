// ============================================================
// Codex Adapter — Codex CLI app-server JSON-RPC subprocess
// ============================================================
// Spawns `codex app-server` as a child process and communicates
// via newline-delimited JSON-RPC 2.0 over stdin/stdout.

import { spawn, execFile } from 'node:child_process';
import { createInterface } from 'node:readline';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
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

const execFileAsync = promisify(execFile);

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const CODEX_DEFAULT_CAPABILITIES: ModelCapabilities = {
  reasoningEffortLevels: [
    { value: 'xhigh', label: 'Extra High' },
    { value: 'high', label: 'High', isDefault: true },
    { value: 'medium', label: 'Medium' },
    { value: 'low', label: 'Low' },
  ],
  supportsFastMode: true,
  supportsThinkingToggle: false,
  contextWindowOptions: [],
  promptInjectedEffortLevels: [],
};

// Offline fallback ONLY — `codex app-server` model/list is the source of
// truth (t3code parity: trust the app-server, never filter against a static
// catalog). Shown until discovery succeeds or when the probe fails.
const DEFAULT_CODEX_MODELS: ModelInfo[] = [
  {
    id: 'gpt-5.5',
    name: 'GPT-5.5',
    provider: 'codex',
    supportsThinking: false,
    maxTokens: 16384,
    contextWindow: 200000,
    isDefault: true,
    capabilities: CODEX_DEFAULT_CAPABILITIES,
  },
  {
    id: 'gpt-5.4',
    name: 'GPT-5.4',
    provider: 'codex',
    supportsThinking: false,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: CODEX_DEFAULT_CAPABILITIES,
  },
  {
    id: 'gpt-5.4-mini',
    name: 'GPT-5.4 Mini',
    provider: 'codex',
    supportsThinking: false,
    maxTokens: 16384,
    contextWindow: 200000,
    capabilities: CODEX_DEFAULT_CAPABILITIES,
  },
];

// "gpt-5.5-codex" → "GPT-5.5 Codex" (t3code's toDisplayName behavior).
function codexDisplayName(id: string): string {
  return id
    .replace(/^gpt/i, 'GPT')
    .replace(/-([a-z])/g, (_, c: string) => ` ${c.toUpperCase()}`)
    .replace(/-(\d)/g, '-$1');
}

const CODEX_EFFORT_LABELS: Record<string, string> = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra High',
};

// Map one `model/list` wire entry to stavi's ModelInfo. Returns null for
// hidden/unusable entries.
function mapCodexWireModel(m: any): ModelInfo | null {
  const id: string | undefined = m?.id ?? m?.model;
  if (!id || m?.hidden === true) return null;

  const rawEfforts: any[] = Array.isArray(m?.supportedReasoningEfforts)
    ? m.supportedReasoningEfforts
    : [];
  const effortValues = rawEfforts
    .map((e) => (typeof e === 'string' ? e : e?.reasoningEffort ?? e?.effort ?? e?.value))
    .filter((v): v is string => typeof v === 'string' && v.length > 0);
  const defaultEffort: string | undefined =
    typeof m?.defaultReasoningEffort === 'string' ? m.defaultReasoningEffort : undefined;

  const reasoningEffortLevels = effortValues.map((value) => ({
    value,
    label: CODEX_EFFORT_LABELS[value] ?? value,
    ...(value === defaultEffort ? { isDefault: true } : {}),
  }));

  const supportsFastMode =
    (Array.isArray(m?.additionalSpeedTiers) && m.additionalSpeedTiers.length > 0) ||
    (Array.isArray(m?.serviceTiers) && m.serviceTiers.length > 0);

  return {
    id,
    name: typeof m?.displayName === 'string' && m.displayName ? m.displayName : codexDisplayName(id),
    provider: 'codex',
    supportsThinking: false,
    maxTokens: 16384,
    contextWindow: 200000,
    ...(m?.isDefault === true ? { isDefault: true } : {}),
    capabilities: {
      reasoningEffortLevels:
        reasoningEffortLevels.length > 0
          ? reasoningEffortLevels
          : CODEX_DEFAULT_CAPABILITIES.reasoningEffortLevels,
      supportsFastMode,
      supportsThinkingToggle: false,
      contextWindowOptions: [],
      promptInjectedEffortLevels: [],
    },
  };
}

const REQUEST_TIMEOUT_MS = 20_000;

function mapCodexRuntimeMode(runtimeMode: SendTurnInput['runtimeMode']): {
  approvalPolicy: 'untrusted' | 'on-request' | 'never';
  sandbox: 'read-only' | 'workspace-write' | 'danger-full-access';
} {
  switch (runtimeMode) {
    case 'auto-accept-edits':
      return {
        approvalPolicy: 'on-request',
        sandbox: 'workspace-write',
      };
    case 'full-access':
      return {
        approvalPolicy: 'never',
        sandbox: 'danger-full-access',
      };
    case 'approval-required':
    default:
      return {
        approvalPolicy: 'untrusted',
        sandbox: 'read-only',
      };
  }
}

function normalizeApprovalDecision(decision: ApprovalDecision): 'accept' | 'reject' | 'always-allow' {
  if (decision === 'acceptForSession') return 'always-allow';
  if (decision === 'decline') return 'reject';
  return decision;
}

// ----------------------------------------------------------
// JSON-RPC types
// ----------------------------------------------------------

interface JsonRpcRequest {
  id: number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcNotification {
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

// ----------------------------------------------------------
// Pending request tracking
// ----------------------------------------------------------

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface PendingApproval {
  jsonRpcId: number;
  toolName: string;
  toolInput: unknown;
}

// ----------------------------------------------------------
// Session state
// ----------------------------------------------------------

interface CodexSession {
  threadId: string;
  cwd: string;
  process: ReturnType<typeof spawn> | null;
  nextRequestId: number;
  pending: Map<string, PendingRequest>;
  pendingApprovals: Map<string, PendingApproval>;
  providerThreadId: string | null;
  activeTurnId: string | null;
  status: 'initializing' | 'ready' | 'running' | 'error' | 'closed';
  eventBuffer: ProviderEvent[];
  eventResolve: ((value: IteratorResult<ProviderEvent>) => void) | null;
}

// ----------------------------------------------------------
// Codex Adapter
// ----------------------------------------------------------

export class CodexAdapter implements ProviderAdapter {
  readonly provider = 'codex' as const;

  private sessions = new Map<string, CodexSession>();
  // Callback wired at boot (server.ts) to persist the Codex providerThreadId.
  // The codex app-server subprocess is transient — persisting providerThreadId
  // is for observability only.  On server restart, startSession() always spawns
  // a fresh subprocess and issues a new thread/start; there is no resume API in
  // the codex app-server protocol.  Therefore _onCursorPersist is called when
  // providerThreadId is first assigned, but _getCursor is intentionally NOT used
  // to reconstruct sessions on boot.
  private _onCursorPersist: ((threadId: string, providerThreadId: string | null) => void) | null = null;

  /** Wire cursor persistence (Codex — observability only, no restart resume). */
  onCursorPersist(persist: (threadId: string, providerThreadId: string | null) => void): void {
    this._onCursorPersist = persist;
  }
  private binaryPath: string | null = null;
  private ready = false;
  private dynamicModels: ModelInfo[] = [];

  constructor(private getBinaryPath?: () => string | undefined) {}

  async initialize(): Promise<boolean> {
    // Try to find the codex binary
    const configPath = this.getBinaryPath?.();
    if (configPath) {
      this.binaryPath = configPath;
    } else {
      try {
        const { stdout } = await execFileAsync('which', ['codex']);
        this.binaryPath = stdout.trim();
      } catch {
        // Codex CLI not found
        this.binaryPath = null;
        this.ready = false;
        return false;
      }
    }

    // Verify it works
    try {
      await execFileAsync(this.binaryPath!, ['--version']);
      this.ready = true;
      // Discover the real model catalog in the background — don't block boot.
      void this.probeModels();
      return true;
    } catch {
      this.ready = false;
      return false;
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  getModels(): ModelInfo[] {
    return this.dynamicModels.length > 0 ? this.dynamicModels : DEFAULT_CODEX_MODELS;
  }

  /** Map + adopt wire models from model/list. Ensures exactly one default. */
  private adoptDiscoveredModels(wireModels: any[]): void {
    const mapped = wireModels
      .map((m) => mapCodexWireModel(m))
      .filter((m): m is ModelInfo => m !== null);
    if (mapped.length === 0) return;
    if (!mapped.some((m) => m.isDefault)) mapped[0] = { ...mapped[0], isDefault: true };
    this.dynamicModels = mapped;
    console.log(`[Codex] Discovered ${mapped.length} models: ${mapped.map((m) => m.id).join(', ')}`);
  }

  /**
   * Boot-time model discovery via a short-lived `codex app-server` handshake
   * (initialize → initialized → paginated model/list → kill). t3code probes at
   * provider startup so the picker is correct before any session exists;
   * without this, models only refresh when the first session spawns.
   */
  private async probeModels(): Promise<void> {
    if (!this.binaryPath) return;
    const child = spawn(this.binaryPath, ['app-server'], {
      env: { ...process.env, TERM: 'dumb' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const pending = new Map<
      number,
      { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
    >();
    let nextId = 1;

    const settle = (id: number, fn: 'resolve' | 'reject', value: any) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      clearTimeout(p.timer);
      p[fn](value);
    };

    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => {
      try {
        const msg = JSON.parse(line);
        if (msg.id != null && pending.has(msg.id)) {
          if (msg.error) settle(msg.id, 'reject', new Error(msg.error.message ?? 'request failed'));
          else settle(msg.id, 'resolve', msg.result);
        }
      } catch { /* non-JSON noise */ }
    });

    const request = (method: string, params: Record<string, unknown>): Promise<any> =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(
          () => settle(id, 'reject', new Error(`${method} timed out`)),
          REQUEST_TIMEOUT_MS,
        );
        pending.set(id, { resolve, reject, timer });
        child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`, (err) => {
          if (err) settle(id, 'reject', err);
        });
      });

    try {
      await request('initialize', {
        clientInfo: { name: 'stavi', version: '0.0.1' },
        capabilities: { experimentalApi: true },
      });
      child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'initialized' })}\n`);

      const wireModels: any[] = [];
      let cursor: string | null = null;
      do {
        const result: any = await request('model/list', cursor ? { cursor } : {});
        const page: any[] = Array.isArray(result) ? result : result?.data ?? [];
        wireModels.push(...page);
        cursor = !Array.isArray(result) && typeof result?.nextCursor === 'string'
          ? result.nextCursor
          : null;
      } while (cursor);

      this.adoptDiscoveredModels(wireModels);
    } catch (err) {
      console.warn('[Codex] model probe failed:', err instanceof Error ? err.message : err);
    } finally {
      rl.close();
      try { child.kill(); } catch { /* already dead */ }
    }
  }

  async startSession(threadId: string, cwd: string): Promise<void> {
    if (this.sessions.has(threadId)) return;
    if (!this.binaryPath) throw new Error('Codex binary not found');
    // spawn() with a nonexistent cwd fails with a misleading ENOENT on the
    // binary. Surface the real reason (cross-server sessions, shared SQLite).
    if (cwd && cwd !== '.' && !existsSync(cwd)) {
      throw new Error(`Session folder does not exist on this server: ${cwd}`);
    }

    const session: CodexSession = {
      threadId,
      cwd,
      process: null,
      nextRequestId: 1,
      pending: new Map(),
      pendingApprovals: new Map(),
      providerThreadId: null,
      activeTurnId: null,
      status: 'initializing',
      eventBuffer: [],
      eventResolve: null,
    };
    this.sessions.set(threadId, session);

    // Spawn the codex app-server process
    const child = spawn(this.binaryPath, ['app-server'], {
      cwd,
      env: {
        ...process.env,
        TERM: 'dumb',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    session.process = child;

    // Read stdout line by line
    const rl = createInterface({ input: child.stdout! });
    rl.on('line', (line) => this.handleStdoutLine(session, line));

    // Handle stderr (log but don't crash)
    child.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      console.error(`[Codex:${threadId}] stderr:`, text);
    });

    // Handle process exit
    child.on('exit', (code) => {
      session.status = 'closed';
      this.emitEvent(session, {
        type: 'session-error',
        threadId,
        data: { error: `Codex process exited with code ${code}` },
      });
    });

    child.on('error', (err) => {
      session.status = 'error';
      console.error(`[Codex:${threadId}] process error:`, err.message);
    });

    // Perform handshake
    try {
      // 1. Initialize
      await this.sendRequest(session, 'initialize', {
        clientInfo: { name: 'stavi', version: '0.0.1' },
        capabilities: { experimentalApi: true },
      });

      // 2. Send initialized notification
      this.sendNotification(session, 'initialized');

      // 3. List models — the app-server's response is the source of truth
      // (paginated; codex-cli ≥0.13x returns { data, nextCursor }).
      try {
        const wireModels: any[] = [];
        let cursor: string | null = null;
        do {
          const result: any = await this.sendRequest(
            session,
            'model/list',
            cursor ? { cursor } : {},
          );
          const page: any[] = Array.isArray(result) ? result : result?.data ?? [];
          wireModels.push(...page);
          cursor = !Array.isArray(result) && typeof result?.nextCursor === 'string'
            ? result.nextCursor
            : null;
        } while (cursor);

        this.adoptDiscoveredModels(wireModels);
      } catch {
        // model/list is optional
      }

      session.status = 'ready';
    } catch (err) {
      session.status = 'error';
      const message = err instanceof Error ? err.message : 'Codex handshake failed';
      console.error(`[Codex:${threadId}] init error:`, message);
      throw new Error(message);
    }
  }

  async *sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent> {
    let session = this.sessions.get(input.threadId);
    if (!session) {
      await this.startSession(input.threadId, input.cwd ?? '.');
      session = this.sessions.get(input.threadId)!;
    } else if (input.cwd && session.cwd === '.') {
      session.cwd = input.cwd;
    }

    if (session.status !== 'ready') {
      yield turnError(input.threadId, `Codex session not ready (status: ${session.status})`);
      return;
    }

    const modelId = input.modelSelection?.modelId ?? this.getModels()[0]?.id ?? 'codex-mini-latest';
    const effort = input.modelSelection?.effort ?? 'medium';

    session.status = 'running';
    session.eventBuffer = [];

    try {
      const runtimeMode = mapCodexRuntimeMode(input.runtimeMode);
      // Start or resume thread
      if (!session.providerThreadId) {
        const result = await this.sendRequest(session, 'thread/start', {
          model: modelId,
          approvalPolicy: runtimeMode.approvalPolicy,
          sandbox: runtimeMode.sandbox,
          cwd: session.cwd,
        });
        session.providerThreadId = (result as any)?.thread?.id ?? null;
      }

      // Send the turn. approvalPolicy/sandboxPolicy repeat on EVERY turn
      // (t3code parity) — only sending them on thread/start silently ignored
      // mid-thread access-level changes from the chip. turn/start's V2 params
      // take a discriminated sandboxPolicy object, not the thread/start string.
      const turnSandbox =
        runtimeMode.sandbox === 'danger-full-access'
          ? { type: 'dangerFullAccess' }
          : runtimeMode.sandbox === 'workspace-write'
            ? { type: 'workspaceWrite' }
            : { type: 'readOnly' };
      const turnResult = await this.sendRequest(session, 'turn/start', {
        threadId: session.providerThreadId,
        input: [{ type: 'text', text: input.text }],
        model: modelId,
        effort,
        approvalPolicy: runtimeMode.approvalPolicy,
        sandboxPolicy: turnSandbox,
        ...(input.modelSelection?.fastMode ? { serviceTier: 'fast' } : {}),
      });
      session.activeTurnId = (turnResult as any)?.turn?.id ?? `turn-${Date.now()}`;

      // Drain the event buffer — process stdout handler pushes events in,
      // we yield them out. The loop is controlled by observing terminal events
      // (turn-complete / turn-error) in the buffer, NOT by session.status.
      // This avoids a race where handleNotification processes turn/completed
      // (setting status='ready') during the await sendRequest above, which
      // would cause a status-based loop to exit before draining any events.
      // Pattern: mirrors T3code's CodexAppServerManager — event handling is
      // fully decoupled from the turn/start RPC response.
      let drainDone = false;
      while (!drainDone) {
        if (session.eventBuffer.length > 0) {
          const event = session.eventBuffer.shift()!;
          yield event;

          if (event.type === 'turn-complete' || event.type === 'turn-error') {
            session.status = 'ready';
            session.activeTurnId = null;
            drainDone = true;
          }
        } else {
          await new Promise<void>((resolve) => {
            session!.eventResolve = () => {
              session!.eventResolve = null;
              resolve();
            };
            // Safety timeout — don't block forever if Codex subprocess dies
            // without sending turn/completed.
            setTimeout(() => {
              if (session!.eventResolve) {
                session!.eventResolve = undefined as any;
                resolve();
              }
            }, 30_000);
          });
        }
      }

      // If the process exited unexpectedly (status 'closed'), emit an error so
      // the server marks the assistant message as failed instead of hanging.
      if ((session.status as string) === 'closed') {
        yield turnError(input.threadId, 'Codex process exited unexpectedly');
      }
    } catch (err) {
      session.status = 'ready';
      const message = err instanceof Error ? err.message : 'Codex turn failed';
      yield turnError(input.threadId, message);
    }
  }

  async interruptTurn(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session || !session.providerThreadId || !session.activeTurnId) return;

    try {
      await this.sendRequest(session, 'turn/interrupt', {
        threadId: session.providerThreadId,
        turnId: session.activeTurnId,
      });
    } catch {
      // Best effort
    }
    session.status = 'ready';
    session.activeTurnId = null;
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

    // Map our decision to Codex's format
    const normalizedDecision = normalizeApprovalDecision(decision);
    const codexDecision = normalizedDecision === 'always-allow'
      ? 'acceptForSession'
      : normalizedDecision === 'accept'
        ? 'accept'
        : 'decline';

    // Send the JSON-RPC response back to Codex
    this.sendRaw(session, JSON.stringify({
      id: pending.jsonRpcId,
      result: { decision: codexDecision },
    }));

    session.pendingApprovals.delete(requestId);
  }

  async stopSession(threadId: string): Promise<void> {
    const session = this.sessions.get(threadId);
    if (!session) return;

    session.status = 'closed';

    // Reject all pending approvals so they don't hang waiting for user input
    for (const [, pending] of session.pendingApprovals) {
      this.sendRaw(session, JSON.stringify({
        id: pending.jsonRpcId,
        result: { decision: 'decline' },
      }));
    }
    session.pendingApprovals.clear();

    // Wake the drain loop if it's blocked, so sendTurn can exit cleanly
    if (session.eventResolve) {
      const resolve = session.eventResolve;
      session.eventResolve = null;
      resolve({ value: turnError(threadId, 'Session stopped'), done: false });
    }

    session.process?.kill('SIGTERM');
    this.sessions.delete(threadId);
  }

  async stopAll(): Promise<void> {
    // Go through stopSession so pending approvals are declined and the drain
    // loop wakes — a bare kill left approval Deferreds hanging.
    for (const threadId of [...this.sessions.keys()]) {
      await this.stopSession(threadId);
    }
    this.sessions.clear();
  }

  // ----------------------------------------------------------
  // JSON-RPC communication
  // ----------------------------------------------------------

  private sendRequest(session: CodexSession, method: string, params: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = session.nextRequestId++;
      const timer = setTimeout(() => {
        session.pending.delete(String(id));
        reject(new Error(`Codex request timed out: ${method}`));
      }, REQUEST_TIMEOUT_MS);

      session.pending.set(String(id), { resolve, reject, timer });

      const msg: JsonRpcRequest = { id, method, params };
      this.sendRaw(session, JSON.stringify(msg));
    });
  }

  private sendNotification(session: CodexSession, method: string, params?: Record<string, unknown>): void {
    const msg: JsonRpcNotification = { method, ...(params ? { params } : {}) };
    this.sendRaw(session, JSON.stringify(msg));
  }

  private sendRaw(session: CodexSession, data: string): void {
    if (session.process?.stdin?.writable) {
      session.process.stdin.write(data + '\n');
    }
  }

  // ----------------------------------------------------------
  // Stdout handler — parse incoming JSON-RPC messages
  // ----------------------------------------------------------

  private handleStdoutLine(session: CodexSession, line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: any;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return;
    }

    // Classify the message
    if ('id' in msg && 'method' in msg) {
      // Server-Request: Codex is asking us for something (approval)
      this.handleServerRequest(session, msg);
    } else if ('id' in msg && !('method' in msg)) {
      // Response to our request
      this.handleResponse(session, msg);
    } else if ('method' in msg && !('id' in msg)) {
      // Notification from Codex
      this.handleNotification(session, msg);
    }
  }

  private handleResponse(session: CodexSession, msg: JsonRpcResponse): void {
    const pending = session.pending.get(String(msg.id));
    if (!pending) return;

    clearTimeout(pending.timer);
    session.pending.delete(String(msg.id));

    if (msg.error) {
      pending.reject(new Error(`Codex error: ${msg.error.message}`));
    } else {
      pending.resolve(msg.result);
    }
  }

  private handleServerRequest(session: CodexSession, msg: any): void {
    const method = msg.method as string;
    const params = msg.params ?? {};

    // Approval requests
    if (
      method === 'item/commandExecution/requestApproval' ||
      method === 'item/fileRead/requestApproval' ||
      method === 'item/fileChange/requestApproval'
    ) {
      const requestId = `approval-${Date.now()}-${msg.id}`;
      // `params.command.command` may be an argv ARRAY (or object) depending on
      // codex version — normalize to a display string so the mobile card never
      // renders JSON garbage.
      const rawCommand = params.command?.command;
      const commandText = Array.isArray(rawCommand)
        ? rawCommand.join(' ')
        : typeof rawCommand === 'string'
          ? rawCommand
          : undefined;
      const toolName = commandText
        ?? params.path
        ?? method.split('/')[1]
        ?? 'unknown';
      const toolInput = commandText ? { ...params, command: commandText } : params;

      session.pendingApprovals.set(requestId, {
        jsonRpcId: msg.id,
        toolName: String(toolName),
        toolInput,
      });

      this.emitEvent(session, approvalRequired(
        session.threadId,
        requestId,
        String(toolName),
        toolInput,
        session.activeTurnId ?? undefined,
      ));
      return;
    }

    // Unknown server request — decline
    this.sendRaw(session, JSON.stringify({
      id: msg.id,
      error: { code: -32601, message: `Unsupported server request: ${method}` },
    }));
  }

  private handleNotification(session: CodexSession, msg: any): void {
    const method = msg.method as string;
    const params = msg.params ?? {};
    const threadId = session.threadId;
    const turnId = params.turnId ?? params.turn?.id ?? session.activeTurnId ?? undefined;

    switch (method) {
      case 'turn/started':
        session.status = 'running';
        session.activeTurnId = turnId ?? session.activeTurnId;
        break;

      case 'turn/completed': {
        const status = params.turn?.status ?? 'completed';
        if (status === 'error') {
          // Codex reported the turn as failed — emit turnError, not turnComplete
          const errMsg = params.turn?.error ?? params.error ?? 'Turn completed with error status';
          this.emitEvent(session, turnError(threadId, String(errMsg), turnId));
        } else {
          this.emitEvent(session, turnComplete(threadId, turnId));
        }
        // Do NOT set session.status here — the drain loop in sendTurn owns
        // the status transition after it yields the turnComplete event.
        // Setting status here caused a race: turn/completed arriving during
        // await sendRequest('turn/start') would set status='ready' before
        // the drain loop started, causing it to exit immediately.
        break;
      }

      case 'turn/aborted':
        this.emitEvent(session, turnError(threadId, 'Turn aborted', turnId));
        // Do NOT set session.status here — drain loop owns status transition.
        break;

      case 'item/agentMessage/delta': {
        const text = params.textDelta ?? params.delta ?? '';
        if (text) {
          this.emitEvent(session, textDelta(threadId, String(text), turnId));
        }
        break;
      }

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta': {
        const text = params.textDelta ?? params.delta ?? '';
        if (text) {
          this.emitEvent(session, thinkingDelta(threadId, String(text), turnId));
        }
        break;
      }

      case 'item/started': {
        const itemType = params.item?.type ?? '';
        if (itemType === 'tool_use' || itemType === 'command_execution') {
          const toolName = params.item?.name ?? params.item?.command?.command ?? 'tool';
          const toolId = params.item?.id ?? `tool-${Date.now()}`;
          this.emitEvent(session, toolUseStart(
            threadId, String(toolName), String(toolId), params.item?.input ?? null, turnId,
          ));
        }
        break;
      }

      case 'item/completed': {
        const itemType = params.item?.type ?? '';
        if (itemType === 'tool_use' || itemType === 'command_execution') {
          const toolId = params.item?.id ?? 'unknown';
          this.emitEvent(session, toolUseDone(
            threadId, String(toolId), params.item?.output ?? null, turnId,
          ));
        }
        break;
      }

      case 'item/commandExecution/outputDelta': {
        // Command output — treat as text for now
        const output = params.delta ?? params.output ?? '';
        if (output) {
          this.emitEvent(session, textDelta(threadId, String(output), turnId));
        }
        break;
      }

      case 'error': {
        const errMsg = params.message ?? params.error ?? 'Unknown Codex error';
        if (!params.willRetry) {
          this.emitEvent(session, turnError(threadId, String(errMsg), turnId));
        }
        break;
      }

      // Lifecycle events we track but don't emit
      case 'thread/started':
        if (params.thread?.id) {
          session.providerThreadId = params.thread.id;
          // Persist for observability.  NOT used for restart recovery — see
          // CodexAdapter class comment about transient subprocess lifecycle.
          this._onCursorPersist?.(session.threadId, session.providerThreadId);
        }
        break;

      case 'session/ready':
        session.status = 'ready';
        break;

      default:
        // Ignore other notifications
        break;
    }
  }

  // ----------------------------------------------------------
  // Event emission
  // ----------------------------------------------------------

  // Pushes event to the buffer AND wakes the drain loop if it's blocked
  // waiting for events. This is the only pathway for events to reach the
  // sendTurn generator — handleNotification never directly affects the
  // drain loop's control flow except through this method.
  private emitEvent(session: CodexSession, event: ProviderEvent): void {
    session.eventBuffer.push(event);
    if (session.eventResolve) {
      const resolve = session.eventResolve;
      session.eventResolve = null;
      resolve({ value: event, done: false });
    }
  }
}
