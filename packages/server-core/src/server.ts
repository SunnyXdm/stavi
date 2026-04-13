import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { WebSocketServer, type WebSocket } from 'ws';
import { ProviderRegistry } from './providers/registry';
import type { ProviderEvent, ModelSelection } from './providers/types';

const execFileAsync = promisify(execFile);

export const DEFAULT_PORT = 3773;
const DEFAULT_WS_TOKEN_TTL_MS = 15 * 60 * 1000;
const GIT_STATUS_POLL_MS = 4000;
const MAX_HISTORY_CHARS = 100_000;

interface StoredCredentials {
  version: 1;
  bearerToken: string;
  createdAt: string;
}

interface RpcRequest {
  _tag: 'Request';
  id: string;
  tag: string;
  payload: Record<string, unknown>;
}

interface RpcChunk {
  _tag: 'Chunk';
  requestId: string;
  values: unknown[];
}

interface RpcExit {
  _tag: 'Exit';
  requestId: string;
  exit:
    | { _tag: 'Success'; value?: unknown }
    | { _tag: 'Failure'; cause: { _tag: 'Fail'; error: { message: string } } };
}

interface TerminalSession {
  threadId: string;
  terminalId: string;
  cwd: string;
  history: string;
  proc: any; // Bun.Subprocess with terminal
  status: 'running' | 'exited';
}

interface GitStatusPayload {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: string[];
}

interface OrchestrationMessage {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId?: string;
  streaming?: boolean;
  createdAt: string;
}

interface OrchestrationThread {
  threadId: string;
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath: string | null;
  modelSelection?: ModelSelection;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface Subscription {
  ws: WebSocket;
  requestId: string;
  tag: string;
}

export interface StartServerOptions {
  cwd: string;
  host?: string;
  port?: number;
  baseDir: string;
}

export interface ServerConnectionConfig {
  address: string;
  host: string;
  port: number;
  token: string;
}

export interface StaviServer {
  bearerToken: string;
  port: number;
  host: string;
  stop: () => Promise<void>;
}

function createToken(prefix: string) {
  return `${prefix}${randomBytes(18).toString('hex')}`;
}

function nowIso() {
  return new Date().toISOString();
}

function credentialsPath(baseDir: string) {
  return join(baseDir, 'userdata', 'credentials.json');
}

function runtimeStatePath(baseDir: string) {
  return join(baseDir, 'userdata', 'server-runtime.json');
}

function ensureDirFor(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function issueOrReadBearerToken(baseDir: string): string {
  const filePath = credentialsPath(baseDir);
  ensureDirFor(filePath);

  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as StoredCredentials;
      if (parsed.bearerToken) {
        return parsed.bearerToken;
      }
    } catch {
      // Fall through and replace invalid credentials.
    }
  }

  const stored: StoredCredentials = {
    version: 1,
    bearerToken: createToken('sk-stavi-'),
    createdAt: nowIso(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, filePath);
  return stored.bearerToken;
}

function writeRuntimeState(baseDir: string, host: string, port: number) {
  const filePath = runtimeStatePath(baseDir);
  ensureDirFor(filePath);
  const state = {
    version: 1,
    pid: process.pid,
    host,
    port,
    origin: `http://${host}:${port}`,
    startedAt: nowIso(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, filePath);
}

function clearRuntimeState(baseDir: string) {
  const filePath = runtimeStatePath(baseDir);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
  }
}

function getShell(): string {
  if (process.env.STAVI_SHELL) return process.env.STAVI_SHELL;
  if (process.env.SHELL) return process.env.SHELL;
  // Try common shells in order of preference
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (existsSync(shell)) return shell;
  }
  return '/bin/sh';
}

function makeChunk(requestId: string, values: unknown[]): RpcChunk {
  return { _tag: 'Chunk', requestId, values };
}

function makeSuccess(requestId: string, value?: unknown): RpcExit {
  return { _tag: 'Exit', requestId, exit: { _tag: 'Success', value } };
}

function makeFailure(requestId: string, message: string): RpcExit {
  return {
    _tag: 'Exit',
    requestId,
    exit: { _tag: 'Failure', cause: { _tag: 'Fail', error: { message } } },
  };
}

function sendJson(ws: WebSocket, payload: unknown) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function resolveWorkspacePath(root: string, maybePath: string) {
  return maybePath.startsWith('/') ? maybePath : resolve(root, maybePath);
}

function truncateHistory(history: string) {
  if (history.length <= MAX_HISTORY_CHARS) return history;
  return history.slice(history.length - MAX_HISTORY_CHARS);
}

function detectLocalIp() {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      return net.address;
    }
  }
  return '127.0.0.1';
}

export function createServerConnectionConfig(input: { host?: string; port?: number; token: string }) {
  const host = input.host && input.host !== '0.0.0.0' ? input.host : detectLocalIp();
  const port = input.port ?? DEFAULT_PORT;
  return {
    address: `${host}:${port}`,
    host,
    port,
    token: input.token,
  } satisfies ServerConnectionConfig;
}

function mapGitStatus(code: string) {
  switch (code) {
    case 'A':
    case '?':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}

async function getGitStatus(cwd: string): Promise<GitStatusPayload> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=1', '-b'], { cwd });
    const lines = stdout.split('\n').filter(Boolean);
    const first = lines.shift() ?? '';
    let branch = '';
    let ahead = 0;
    let behind = 0;

    if (first.startsWith('## ')) {
      const branchPart = first.slice(3);
      const [namePart, trackingPart] = branchPart.split('...');
      branch = namePart || '';
      const match = trackingPart?.match(/\[(.*)\]/);
      if (match) {
        for (const part of match[1].split(',')) {
          const trimmed = part.trim();
          if (trimmed.startsWith('ahead ')) ahead = Number.parseInt(trimmed.slice(6), 10) || 0;
          if (trimmed.startsWith('behind ')) behind = Number.parseInt(trimmed.slice(7), 10) || 0;
        }
      }
    }

    const staged: GitStatusPayload['staged'] = [];
    const unstaged: GitStatusPayload['unstaged'] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const xy = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath;

      if (xy === '??') {
        untracked.push(path);
        continue;
      }

      const stagedCode = xy[0];
      const unstagedCode = xy[1];

      if (stagedCode && stagedCode !== ' ') {
        staged.push({ path, status: mapGitStatus(stagedCode) });
      }
      if (unstagedCode && unstagedCode !== ' ') {
        unstaged.push({ path, status: mapGitStatus(unstagedCode) });
      }
    }

    return { branch, ahead, behind, staged, unstaged, untracked };
  } catch {
    return { branch: '', ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] };
  }
}

async function searchEntries(cwd: string, query: string, limit: number) {
  const normalizedLimit = Math.max(1, Math.min(limit || 200, 1000));
  const entries = new Map<string, { name: string; path: string; type: 'file' | 'directory' }>();

  const addDirectoryAncestors = (relativePath: string) => {
    const parts = relativePath.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      entries.set(path, { name: parts[i - 1], path, type: 'directory' });
    }
  };

  try {
    const { stdout } = await execFileAsync('rg', ['--files', '-g', '!node_modules', '-g', '!.git'], {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    const matcher = query && query !== '*'
      ? query.toLowerCase()
      : null;

    for (const filePath of stdout.split('\n').filter(Boolean)) {
      const haystack = filePath.toLowerCase();
      if (matcher && !haystack.includes(matcher)) continue;
      addDirectoryAncestors(filePath);
      entries.set(filePath, {
        name: filePath.split('/').pop() ?? filePath,
        path: filePath,
        type: 'file',
      });
      if (entries.size >= normalizedLimit) break;
    }
  } catch {
    // Ignore search failure and return empty results.
  }

  return Array.from(entries.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, normalizedLimit);
}

function createAssistantReply(input: string, providerInfos?: Array<{ provider: string; name: string; authenticated: boolean }>) {
  const trimmed = input.trim();
  if (!trimmed) {
    return 'Local Stavi server is running.';
  }

  const lines: string[] = [`No AI provider is currently available.\n`];
  if (providerInfos && providerInfos.length > 0) {
    for (const p of providerInfos) {
      if (p.provider === 'claude') {
        lines.push(p.authenticated
          ? `- **${p.name}**: Connected`
          : `- **${p.name}**: No API key. Set \`ANTHROPIC_API_KEY\` env var or add key in the app settings.`);
      } else if (p.provider === 'codex') {
        lines.push(p.authenticated
          ? `- **${p.name}**: Connected`
          : `- **${p.name}**: CLI not found. Install with \`npm install -g @openai/codex\` and run \`codex auth login\`.`);
      }
    }
  } else {
    lines.push('Set your `ANTHROPIC_API_KEY` or install the Codex CLI to enable AI responses.');
  }

  return lines.join('\n');
}

export async function startStaviServer(options: StartServerOptions): Promise<StaviServer> {
  const baseDir = resolve(options.baseDir);
  const workspaceRoot = resolve(options.cwd);
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? DEFAULT_PORT;
  const bearerToken = issueOrReadBearerToken(baseDir);

  const wsTokens = new Map<string, { sessionId: string; expiresAt: number }>();
  const terminalSessions = new Map<string, TerminalSession>();
  const terminalSubscriptions = new Map<string, Subscription>();
  const gitSubscriptions = new Map<string, Subscription>();
  const orchestrationSubscriptions = new Map<string, Subscription>();
  const connectionSubscriptions = new Map<WebSocket, Set<string>>();
  let gitPollTimer: ReturnType<typeof setInterval> | null = null;
  let lastGitStatusJson = '';
  let sequence = 0;

  const defaultThreadTemplate: OrchestrationThread = {
    threadId: 'thread-local',
    projectId: 'project-local',
    title: 'Local Assistant',
    runtimeMode: 'approval-required',
    interactionMode: 'default',
    branch: '',
    worktreePath: workspaceRoot,
    archived: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  };
  const threads = new Map<string, OrchestrationThread>();
  const messages = new Map<string, OrchestrationMessage[]>();

  // Provider registry — manages AI providers (Claude, Codex)
  const providerRegistry = new ProviderRegistry(baseDir);

  // Track which provider adapter is running each thread's active turn
  const activeTurnAdapters = new Map<string, string>(); // threadId → providerKind
  await providerRegistry.initialize();

  // Wire Claude adapter's approval emitter to broadcast via orchestration events
  {
    const claudeAdapter = providerRegistry.getAdapter('claude');
    if (claudeAdapter && 'onApprovalRequired' in claudeAdapter) {
      (claudeAdapter as any).onApprovalRequired((threadId: string, requestId: string, toolName: string, toolInput: unknown, turnId: string) => {
        broadcastOrchestrationEvent({
          type: 'thread.approval-response-requested',
          occurredAt: nowIso(),
          payload: { threadId, turnId, requestId, toolName, toolInput },
        });
      });
    }
  }

  const broadcastGitStatus = async () => {
    if (gitSubscriptions.size === 0) return;
    const status = await getGitStatus(workspaceRoot);
    const nextJson = JSON.stringify(status);
    if (nextJson === lastGitStatusJson) return;
    lastGitStatusJson = nextJson;
    for (const sub of gitSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [status]));
    }
  };

  const ensureGitPolling = () => {
    if (gitPollTimer || gitSubscriptions.size === 0) return;
    gitPollTimer = setInterval(() => {
      void broadcastGitStatus();
    }, GIT_STATUS_POLL_MS);
  };

  const maybeStopGitPolling = () => {
    if (gitSubscriptions.size === 0 && gitPollTimer) {
      clearInterval(gitPollTimer);
      gitPollTimer = null;
    }
  };

  const broadcastOrchestrationEvent = (event: Record<string, unknown>) => {
    const payload = { ...event, sequence: ++sequence };
    for (const sub of orchestrationSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [payload]));
    }
  };

  const resolveThreadWorktreePath = (value: unknown) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
      return workspaceRoot;
    }
    return resolveWorkspacePath(workspaceRoot, value);
  };

  const buildThreadFromCommand = (
    threadId: string,
    command: Record<string, unknown>,
    existing?: OrchestrationThread,
  ): OrchestrationThread => {
    const createdAt =
      existing?.createdAt ??
      (typeof command.createdAt === 'string' && command.createdAt.length > 0
        ? command.createdAt
        : nowIso());
    const rawModelSelection = command.modelSelection as ModelSelection | undefined;

    return {
      ...(existing ?? defaultThreadTemplate),
      threadId,
      projectId:
        typeof command.projectId === 'string' && command.projectId.length > 0
          ? command.projectId
          : existing?.projectId ?? 'project-local',
      title:
        typeof command.title === 'string' && command.title.trim().length > 0
          ? command.title
          : existing?.title ?? 'Conversation',
      runtimeMode:
        (command.runtimeMode as OrchestrationThread['runtimeMode'] | undefined) ??
        existing?.runtimeMode ??
        defaultThreadTemplate.runtimeMode,
      interactionMode:
        (command.interactionMode as OrchestrationThread['interactionMode'] | undefined) ??
        existing?.interactionMode ??
        defaultThreadTemplate.interactionMode,
      branch:
        typeof command.branch === 'string'
          ? command.branch
          : existing?.branch ?? '',
      worktreePath:
        'worktreePath' in command
          ? resolveThreadWorktreePath(command.worktreePath)
          : existing?.worktreePath ?? workspaceRoot,
      modelSelection: rawModelSelection ?? existing?.modelSelection,
      archived: existing?.archived ?? false,
      createdAt,
      updatedAt: nowIso(),
    };
  };

  const addConnectionSubscription = (ws: WebSocket, requestId: string) => {
    const current = connectionSubscriptions.get(ws) ?? new Set<string>();
    current.add(requestId);
    connectionSubscriptions.set(ws, current);
  };

  const removeSubscriptionByRequestId = (requestId: string) => {
    terminalSubscriptions.delete(requestId);
    gitSubscriptions.delete(requestId);
    orchestrationSubscriptions.delete(requestId);
  };

  const cleanupSocket = (ws: WebSocket) => {
    const ids = connectionSubscriptions.get(ws);
    if (ids) {
      for (const requestId of ids) {
        removeSubscriptionByRequestId(requestId);
      }
      connectionSubscriptions.delete(ws);
    }
    maybeStopGitPolling();
  };

  const emitTerminalEvent = (event: Record<string, unknown>) => {
    for (const sub of terminalSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [event]));
    }
  };

  const createTerminalSession = (
    threadId: string,
    terminalId: string,
    cwdInput: string,
    cols?: number,
    rows?: number,
  ) => {
    const key = `${threadId}:${terminalId}`;
    const existing = terminalSessions.get(key);
    if (existing) return existing;

    const cwd = resolveWorkspacePath(workspaceRoot, cwdInput || '.');
    const shell = getShell();

    // Use a forward reference so the terminal callbacks can access `session`
    const session: TerminalSession = {
      threadId,
      terminalId,
      cwd,
      history: '',
      proc: null as any,
      status: 'running',
    };
    terminalSessions.set(key, session);

    // Bun.spawn with terminal option gives us a real PTY — interactive shell,
    // ANSI colors, prompt, readline, full terminal emulation.
    const proc = Bun.spawn([shell], {
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
      },
      terminal: {
        cols: cols ?? 80,
        rows: rows ?? 24,
        data(_terminal: any, chunk: Uint8Array) {
          const text = new TextDecoder().decode(chunk);
          session.history = truncateHistory(session.history + text);
          emitTerminalEvent({
            type: 'output',
            threadId,
            terminalId,
            data: text,
          });
        },
        exit(_terminal: any) {
          session.status = 'exited';
          emitTerminalEvent({
            type: 'exited',
            threadId,
            terminalId,
            exitCode: proc.exitCode ?? 0,
          });
        },
      },
    });

    session.proc = proc;
    return session;
  };

  const getSnapshot = async () => {
    const git = await getGitStatus(workspaceRoot);
    const threadList = Array.from(threads.values()).map((thread) => {
      const threadMessages = messages.get(thread.threadId) ?? [];
      return {
        ...thread,
        branch: git.branch,
        messages: threadMessages,
        conversation: {
          messages: threadMessages,
        },
        session: {
          pendingApprovals: [],
        },
      };
    });
    return {
      snapshotSequence: sequence,
      threads: threadList,
      projects: [
        {
          id: 'project-local',
          projectId: 'project-local',
          workspaceRoot,
          title: workspaceRoot.split('/').pop() ?? workspaceRoot,
        },
      ],
    };
  };

  const server = createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400).end('Bad Request');
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', cwd: workspaceRoot }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/ws-token') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== bearerToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid bearer token' }));
        return;
      }

      const wsToken = createToken('ws-stavi-');
      wsTokens.set(wsToken, {
        sessionId: 'local-session',
        expiresAt: Date.now() + DEFAULT_WS_TOKEN_TTL_MS,
      });

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          token: wsToken,
          expiresAt: new Date(Date.now() + DEFAULT_WS_TOKEN_TTL_MS).toISOString(),
        }),
      );
      return;
    }

    res.writeHead(404).end('Not found');
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    const wsToken = url.searchParams.get('wsToken') ?? '';
    const session = wsTokens.get(wsToken);
    if (!session || session.expiresAt < Date.now()) {
      socket.destroy();
      return;
    }
    wsTokens.delete(wsToken);

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('close', () => {
      cleanupSocket(ws);
    });

    ws.on('message', async (raw: Buffer) => {
      let request: RpcRequest;
      try {
        request = JSON.parse(raw.toString()) as RpcRequest;
      } catch {
        return;
      }

      const { id, tag, payload } = request;

      try {
        switch (tag) {
          case 'terminal.open': {
            const threadId = String(payload.threadId ?? '');
            const terminalId = String(payload.terminalId ?? 'default');
            const cwd = String(payload.cwd ?? '.');
            const cols = payload.cols ? Number(payload.cols) : undefined;
            const rows = payload.rows ? Number(payload.rows) : undefined;
            const session = createTerminalSession(threadId, terminalId, cwd, cols, rows);
            sendJson(ws, makeSuccess(id, {
              threadId,
              terminalId,
              history: session.history,
              status: session.status,
            }));
            break;
          }

          case 'terminal.write': {
            const threadId = String(payload.threadId ?? '');
            const terminalId = String(payload.terminalId ?? 'default');
            const data = String(payload.data ?? '');
            const session = terminalSessions.get(`${threadId}:${terminalId}`);
            if (!session) {
              sendJson(ws, makeFailure(id, `Terminal not found: ${threadId}`));
              break;
            }
            session.proc.terminal?.write(data);
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'terminal.resize': {
            const threadId = String(payload.threadId ?? '');
            const terminalId = String(payload.terminalId ?? 'default');
            const cols = Number(payload.cols ?? 80);
            const rows = Number(payload.rows ?? 24);
            const key = `${threadId}:${terminalId}`;
            const session = terminalSessions.get(key);
            if (session?.proc.terminal) {
              session.proc.terminal.resize(cols, rows);
            }
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'terminal.close': {
            const threadId = String(payload.threadId ?? '');
            const terminalId = String(payload.terminalId ?? 'default');
            const key = `${threadId}:${terminalId}`;
            const session = terminalSessions.get(key);
            if (session) {
              session.proc.kill('SIGTERM');
              terminalSessions.delete(key);
            }
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'projects.searchEntries':
          case 'fs.search': {
            const query = String(payload.query ?? payload.path ?? '*');
            const limit = Number(payload.limit ?? 200);
            const exactPath = resolveWorkspacePath(workspaceRoot, query);
            let content: string | undefined;
            if (existsSync(exactPath)) {
              try {
                content = readFileSync(exactPath, 'utf-8');
              } catch {
                content = undefined;
              }
            }
            const entries = await searchEntries(workspaceRoot, query, limit);
            sendJson(ws, makeSuccess(id, { entries, content }));
            break;
          }

          case 'fs.read': {
            const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
            const content = readFileSync(targetPath, 'utf-8');
            sendJson(ws, makeSuccess(id, { content }));
            break;
          }

          case 'projects.writeFile':
          case 'fs.write': {
            const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
            ensureDirFor(targetPath);
            writeFileSync(targetPath, String(payload.content ?? ''), 'utf-8');
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'fs.list': {
            const HIDDEN_DIRS = new Set(['.git', 'node_modules', '.turbo', 'dist', 'build', '.next', '.cache', 'Pods', '.gradle']);
            const relPath = String(payload.path ?? '.');
            const targetPath = resolveWorkspacePath(workspaceRoot, relPath);

            if (!existsSync(targetPath)) {
              sendJson(ws, makeFailure(id, `Directory not found: ${relPath}`));
              break;
            }

            try {
              const dirents = readdirSync(targetPath, { withFileTypes: true });
              const entries: Array<{
                name: string;
                type: 'file' | 'directory';
                size?: number;
              }> = [];

              for (const dirent of dirents) {
                // Skip hidden system dirs
                if (HIDDEN_DIRS.has(dirent.name)) continue;
                // Skip dotfiles starting with . except common config files
                if (dirent.name.startsWith('.') && dirent.name !== '.env' && dirent.name !== '.env.local') continue;

                const entryType = dirent.isDirectory() ? 'directory' : 'file';
                const entry: { name: string; type: 'file' | 'directory'; size?: number } = {
                  name: dirent.name,
                  type: entryType,
                };

                // Get file size for files (skip for directories to avoid overhead)
                if (entryType === 'file') {
                  try {
                    const stat = statSync(join(targetPath, dirent.name));
                    entry.size = stat.size;
                  } catch {
                    // Ignore stat errors
                  }
                }

                entries.push(entry);
              }

              // Sort: directories first, then files, both alphabetically
              entries.sort((a, b) => {
                if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
                return a.name.localeCompare(b.name);
              });

              sendJson(ws, makeSuccess(id, { path: relPath, entries }));
            } catch (err) {
              const errMsg = err instanceof Error ? err.message : 'Failed to list directory';
              sendJson(ws, makeFailure(id, errMsg));
            }
            break;
          }

          case 'git.refreshStatus':
          case 'git.status': {
            const status = await getGitStatus(workspaceRoot);
            lastGitStatusJson = JSON.stringify(status);
            for (const sub of gitSubscriptions.values()) {
              sendJson(sub.ws, makeChunk(sub.requestId, [status]));
            }
            sendJson(ws, makeSuccess(id, status));
            break;
          }

          case 'git.stage': {
            const paths = payload.paths as string[] | undefined;
            if (!paths || paths.length === 0) {
              sendJson(ws, makeFailure(id, 'No paths provided'));
              break;
            }
            await execFileAsync('git', ['add', '--', ...paths], { cwd: workspaceRoot });
            // Broadcast updated status
            void broadcastGitStatus();
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'git.unstage': {
            const paths = payload.paths as string[] | undefined;
            if (!paths || paths.length === 0) {
              sendJson(ws, makeFailure(id, 'No paths provided'));
              break;
            }
            await execFileAsync('git', ['restore', '--staged', '--', ...paths], { cwd: workspaceRoot });
            void broadcastGitStatus();
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'git.commit': {
            const message = String(payload.message ?? '');
            if (!message) {
              sendJson(ws, makeFailure(id, 'Commit message is required'));
              break;
            }
            const { stdout: commitOut } = await execFileAsync('git', ['commit', '-m', message], { cwd: workspaceRoot });
            void broadcastGitStatus();
            sendJson(ws, makeSuccess(id, { ok: true, output: commitOut }));
            break;
          }

          case 'git.diff': {
            const diffPath = payload.path as string | undefined;
            const staged = payload.staged as boolean | undefined;
            const args = ['diff'];
            if (staged) args.push('--staged');
            args.push('--stat', '--numstat');
            if (diffPath) args.push('--', diffPath);
            try {
              const { stdout: diffOut } = await execFileAsync('git', args, { cwd: workspaceRoot });
              sendJson(ws, makeSuccess(id, { diff: diffOut }));
            } catch {
              sendJson(ws, makeSuccess(id, { diff: '' }));
            }
            break;
          }

          case 'git.diffFile': {
            const filePath = String(payload.path ?? '');
            const staged = payload.staged as boolean | undefined;
            const args = ['diff'];
            if (staged) args.push('--staged');
            if (filePath) args.push('--', filePath);
            try {
              const { stdout: diffContent } = await execFileAsync('git', args, { cwd: workspaceRoot, maxBuffer: 2 * 1024 * 1024 });
              sendJson(ws, makeSuccess(id, { diff: diffContent }));
            } catch {
              sendJson(ws, makeSuccess(id, { diff: '' }));
            }
            break;
          }

          case 'git.log': {
            const limit = Number(payload.limit ?? 50);
            try {
              const { stdout: logOut } = await execFileAsync(
                'git',
                ['log', `--format=%H%x00%s%x00%an%x00%aI`, '-n', String(limit)],
                { cwd: workspaceRoot },
              );
              const commits = logOut
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                  const [hash, message, author, date] = line.split('\0');
                  return { hash, message, author, date };
                });
              sendJson(ws, makeSuccess(id, { commits }));
            } catch {
              sendJson(ws, makeSuccess(id, { commits: [] }));
            }
            break;
          }

          case 'git.branches': {
            try {
              const { stdout: branchOut } = await execFileAsync(
                'git',
                ['branch', '-a', '--format=%(refname:short)\t%(objectname:short)\t%(upstream:short)\t%(HEAD)'],
                { cwd: workspaceRoot },
              );
              const branches = branchOut
                .split('\n')
                .filter(Boolean)
                .map((line) => {
                  const [name, hash, upstream, head] = line.split('\t');
                  return { name, hash, upstream: upstream || null, current: head === '*' };
                });
              sendJson(ws, makeSuccess(id, { branches }));
            } catch {
              sendJson(ws, makeSuccess(id, { branches: [] }));
            }
            break;
          }

          case 'git.checkout': {
            const branch = String(payload.branch ?? '');
            const create = payload.create as boolean | undefined;
            if (!branch) {
              sendJson(ws, makeFailure(id, 'Branch name required'));
              break;
            }
            const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
            await execFileAsync('git', args, { cwd: workspaceRoot });
            void broadcastGitStatus();
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'git.push': {
            const force = payload.force as boolean | undefined;
            const args = ['push'];
            if (force) args.push('--force-with-lease');
            try {
              const { stdout: pushOut, stderr: pushErr } = await execFileAsync('git', args, { cwd: workspaceRoot });
              sendJson(ws, makeSuccess(id, { ok: true, output: pushOut || pushErr }));
            } catch (err) {
              sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Push failed'));
            }
            break;
          }

          case 'git.pull': {
            const rebase = payload.rebase as boolean | undefined;
            const args = ['pull'];
            if (rebase) args.push('--rebase');
            try {
              const { stdout: pullOut, stderr: pullErr } = await execFileAsync('git', args, { cwd: workspaceRoot });
              sendJson(ws, makeSuccess(id, { ok: true, output: pullOut || pullErr }));
            } catch (err) {
              sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Pull failed'));
            }
            break;
          }

          case 'git.discard': {
            const paths = payload.paths as string[] | undefined;
            if (!paths || paths.length === 0) {
              sendJson(ws, makeFailure(id, 'No paths provided'));
              break;
            }
            // For tracked files, checkout; for untracked, clean
            try {
              await execFileAsync('git', ['checkout', '--', ...paths], { cwd: workspaceRoot });
            } catch {
              // May fail for untracked files
            }
            try {
              await execFileAsync('git', ['clean', '-fd', '--', ...paths], { cwd: workspaceRoot });
            } catch {
              // May fail if already handled
            }
            void broadcastGitStatus();
            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'orchestration.getSnapshot': {
            sendJson(ws, makeSuccess(id, await getSnapshot()));
            break;
          }

          case 'orchestration.dispatchCommand': {
            const command = payload.command as Record<string, unknown>;
            const type = String(command?.type ?? '');
            const threadId = String(command?.threadId || '');

            if (type === 'thread.create') {
              if (!threadId) {
                sendJson(ws, makeFailure(id, 'threadId is required'));
                break;
              }
              const thread = buildThreadFromCommand(threadId, command);
              threads.set(threadId, thread);
              if (!messages.has(threadId)) messages.set(threadId, []);
              broadcastOrchestrationEvent({
                type: 'thread.created',
                occurredAt: nowIso(),
                payload: thread,
              });
              sendJson(ws, makeSuccess(id, { thread }));
              break;
            }

            if (type === 'thread.turn.start') {
              if (!threadId) {
                sendJson(ws, makeFailure(id, 'threadId is required'));
                break;
              }
              const thread = buildThreadFromCommand(threadId, command, threads.get(threadId));
              threads.set(threadId, thread);
              if (!messages.has(threadId)) messages.set(threadId, []);
              const msg = command.message as Record<string, unknown>;
              const userMessage: OrchestrationMessage = {
                messageId: String(msg.messageId ?? `msg-${Date.now()}`),
                threadId,
                role: 'user',
                text: String(msg.text ?? ''),
                createdAt: String(command.createdAt ?? nowIso()),
              };
              messages.set(threadId, [...(messages.get(threadId) ?? []), userMessage]);
              thread.updatedAt = nowIso();
              broadcastOrchestrationEvent({
                type: 'thread.message-sent',
                occurredAt: nowIso(),
                payload: userMessage,
              });

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

              // Resolve provider from model selection or use default
              const modelSelection = command.modelSelection as ModelSelection | undefined;
              const providerKind = modelSelection?.provider;
              const adapter = providerKind
                ? providerRegistry.getAdapter(providerKind)
                : providerRegistry.getDefaultAdapter();

              console.log(`[Server] thread.turn.start: provider=${providerKind ?? 'default'}, adapter=${adapter ? 'found' : 'null'}, isReady=${adapter?.isReady() ?? 'N/A'}, subscribers=${orchestrationSubscriptions.size}`);

              if (type === 'thread.turn.start') {
                if (command.runtimeMode) {
                  thread.runtimeMode = command.runtimeMode as OrchestrationThread['runtimeMode'];
                }
                if (command.interactionMode) {
                  thread.interactionMode = command.interactionMode as OrchestrationThread['interactionMode'];
                }
              }

              if (adapter && adapter.isReady()) {
                // Track which adapter is running this turn
                activeTurnAdapters.set(threadId, providerKind ?? adapter.provider);
                // Real AI provider streaming
                (async () => {
                  try {
                    let fullText = '';
                    const stream = adapter.sendTurn({
                      threadId,
                      text: userMessage.text,
                      cwd: thread.worktreePath ?? workspaceRoot,
                      modelSelection,
                      interactionMode: command.interactionMode as 'default' | 'plan' | undefined,
                      runtimeMode: thread.runtimeMode,
                    });

                    for await (const event of stream) {
                      switch (event.type) {
                        case 'text-delta': {
                          const delta = String(event.data.text ?? '');
                          fullText += delta;
                          // Broadcast streaming update with accumulated text
                          const streamingMsg: OrchestrationMessage = {
                            ...assistantStart,
                            text: fullText,
                            streaming: true,
                          };
                          const streamMsgs = (messages.get(threadId) ?? []).map((item) =>
                            item.messageId === assistantMessageId ? streamingMsg : item,
                          );
                          messages.set(threadId, streamMsgs);
                          broadcastOrchestrationEvent({
                            type: 'thread.message-sent',
                            occurredAt: nowIso(),
                            payload: streamingMsg,
                          });
                          break;
                        }

                        case 'thinking-delta': {
                          // Broadcast thinking activity
                          broadcastOrchestrationEvent({
                            type: 'thread.activity-appended',
                            occurredAt: nowIso(),
                            payload: {
                              threadId,
                              turnId,
                              type: 'reasoning',
                              text: String(event.data.text ?? ''),
                            },
                          });
                          break;
                        }

                        case 'tool-use-start': {
                          broadcastOrchestrationEvent({
                            type: 'thread.activity-appended',
                            occurredAt: nowIso(),
                            payload: {
                              threadId,
                              turnId,
                              type: 'tool-use',
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
                              threadId,
                              turnId,
                              type: 'tool-use',
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
                              threadId,
                              turnId,
                              type: 'tool-result',
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
                              threadId,
                              turnId,
                              requestId: String(event.data.requestId ?? ''),
                              toolName: String(event.data.toolName ?? ''),
                              toolInput: event.data.toolInput,
                            },
                          });
                          break;
                        }

                        case 'turn-complete': {
                          activeTurnAdapters.delete(threadId);
                          // Final message
                          const finalMessage: OrchestrationMessage = {
                            ...assistantStart,
                            text: fullText,
                            streaming: false,
                          };
                          const finalMsgs = (messages.get(threadId) ?? []).map((item) =>
                            item.messageId === assistantMessageId ? finalMessage : item,
                          );
                          messages.set(threadId, finalMsgs);
                          broadcastOrchestrationEvent({
                            type: 'thread.message-sent',
                            occurredAt: nowIso(),
                            payload: finalMessage,
                          });

                          // Broadcast usage if available
                          if (event.data.usage) {
                            broadcastOrchestrationEvent({
                              type: 'thread.token-usage',
                              occurredAt: nowIso(),
                              payload: {
                                threadId,
                                turnId,
                                usage: event.data.usage,
                              },
                            });
                          }
                          break;
                        }

                        case 'turn-error': {
                          activeTurnAdapters.delete(threadId);
                          const errorText = fullText
                            ? `${fullText}\n\n---\n\n_Error: ${event.data.error}_`
                            : `_Error: ${event.data.error}_`;
                          const errorMessage: OrchestrationMessage = {
                            ...assistantStart,
                            text: errorText,
                            streaming: false,
                          };
                          const errorMsgs = (messages.get(threadId) ?? []).map((item) =>
                            item.messageId === assistantMessageId ? errorMessage : item,
                          );
                          messages.set(threadId, errorMsgs);
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
                    const errorMsgs = (messages.get(threadId) ?? []).map((item) =>
                      item.messageId === assistantMessageId ? errorMessage : item,
                    );
                    messages.set(threadId, errorMsgs);
                    broadcastOrchestrationEvent({
                      type: 'thread.message-sent',
                      occurredAt: nowIso(),
                      payload: errorMessage,
                    });
                  }
                })();
              } else {
                // No provider available — fall back to placeholder
                setTimeout(() => {
                  const finalMessage: OrchestrationMessage = {
                    ...assistantStart,
                    text: createAssistantReply(userMessage.text, providerRegistry.getProviderInfos()),
                    streaming: false,
                  };
                  const next = (messages.get(threadId) ?? []).map((item) =>
                    item.messageId === assistantMessageId ? finalMessage : item,
                  );
                  messages.set(threadId, next);
                  broadcastOrchestrationEvent({
                    type: 'thread.message-sent',
                    occurredAt: nowIso(),
                    payload: finalMessage,
                  });
                }, 250);
              }
            }

            if (type === 'thread.turn.interrupt') {
              if (!threadId) {
                sendJson(ws, makeFailure(id, 'threadId is required'));
                break;
              }
              const activeKind = activeTurnAdapters.get(threadId);
              const adapter = activeKind
                ? providerRegistry.getAdapter(activeKind as any)
                : providerRegistry.getDefaultAdapter();
              if (adapter) {
                void adapter.interruptTurn(threadId);
              }
            }

            if (type === 'thread.approval.respond') {
              if (!threadId) {
                sendJson(ws, makeFailure(id, 'threadId is required'));
                break;
              }
              const requestId = String(command.requestId ?? '');
              const rawDecision = String(command.decision ?? 'accept');
              let decision: import('./providers/types').ApprovalDecision = 'accept';
              if (rawDecision === 'acceptForSession' || rawDecision === 'always-allow') {
                decision = 'always-allow';
              } else if (rawDecision === 'decline' || rawDecision === 'reject') {
                decision = 'reject';
              }
              const providerKind = (command.provider as string | undefined)
                ?? activeTurnAdapters.get(threadId);
              const adapter = providerKind
                ? providerRegistry.getAdapter(providerKind as any)
                : providerRegistry.getDefaultAdapter();
              if (adapter && requestId) {
                void adapter.respondToApproval(threadId, requestId, decision);
              }
            }

            sendJson(ws, makeSuccess(id, { ok: true }));
            break;
          }

          case 'server.getConfig': {
            sendJson(ws, makeSuccess(id, {
              cwd: workspaceRoot,
              providers: providerRegistry.getProviderInfos(),
            }));
            break;
          }

          case 'server.updateSettings': {
            const updates = payload as Record<string, unknown>;
            const settingsUpdate: Record<string, unknown> = {};
            if (typeof updates.anthropicApiKey === 'string') {
              settingsUpdate.anthropicApiKey = updates.anthropicApiKey;
            }
            if (typeof updates.defaultProvider === 'string') {
              settingsUpdate.defaultProvider = updates.defaultProvider;
            }
            if (typeof updates.defaultModel === 'string') {
              settingsUpdate.defaultModel = updates.defaultModel;
            }
            if (typeof updates.codexBinaryPath === 'string') {
              settingsUpdate.codexBinaryPath = updates.codexBinaryPath;
            }
            providerRegistry.updateSettings(settingsUpdate);

            // Re-initialize to pick up new keys
            await providerRegistry.refresh();

            sendJson(ws, makeSuccess(id, {
              ok: true,
              providers: providerRegistry.getProviderInfos(),
            }));
            break;
          }

          case 'server.getSettings': {
            const settings = providerRegistry.getSettings();
            // Mask the API key for security
            const masked = { ...settings };
            if (masked.anthropicApiKey) {
              const key = masked.anthropicApiKey;
              masked.anthropicApiKey = key.slice(0, 8) + '...' + key.slice(-4);
            }
            sendJson(ws, makeSuccess(id, masked));
            break;
          }

          case 'server.refreshProviders': {
            await providerRegistry.refresh();
            sendJson(ws, makeSuccess(id, {
              providers: providerRegistry.getProviderInfos(),
            }));
            break;
          }

          case 'subscribeTerminalEvents': {
            terminalSubscriptions.set(id, { ws, requestId: id, tag });
            addConnectionSubscription(ws, id);
            sendJson(ws, makeChunk(id, []));
            break;
          }

          case 'subscribeGitStatus': {
            gitSubscriptions.set(id, { ws, requestId: id, tag });
            addConnectionSubscription(ws, id);
            ensureGitPolling();
            sendJson(ws, makeChunk(id, [await getGitStatus(workspaceRoot)]));
            break;
          }

          case 'subscribeOrchestrationDomainEvents': {
            orchestrationSubscriptions.set(id, { ws, requestId: id, tag });
            addConnectionSubscription(ws, id);
            sendJson(ws, makeChunk(id, []));
            break;
          }

          default:
            sendJson(ws, makeFailure(id, `Unsupported RPC tag: ${tag}`));
            break;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown server error';
        sendJson(ws, makeFailure(id, message));
      }
    });
  });

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolvePromise());
  });

  writeRuntimeState(baseDir, host, port);

  return {
    bearerToken,
    port,
    host,
    stop: async () => {
      if (gitPollTimer) {
        clearInterval(gitPollTimer);
        gitPollTimer = null;
      }
      // Stop all AI provider sessions
      await providerRegistry.stopAll();
      for (const session of terminalSessions.values()) {
        session.proc.kill('SIGTERM');
      }
      terminalSessions.clear();
      await new Promise<void>((resolvePromise) => {
        wss.close(() => {
          server.close(() => resolvePromise());
        });
      });
      clearRuntimeState(baseDir);
    },
  };
}
