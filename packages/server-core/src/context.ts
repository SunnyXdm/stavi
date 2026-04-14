// ============================================================
// context.ts — ServerContext: all shared state + broadcast helpers
// ============================================================
// Created inside startStaviServer(), passed to every handler factory.

import type { WebSocket } from 'ws';
import type {
  ManagedProcess,
  OrchestrationMessage,
  OrchestrationThread,
  Subscription,
  TerminalSession,
} from './types';
import type { ProviderRegistry } from './providers/registry';
import type { ModelSelection } from './providers/types';
import {
  makeChunk,
  makeFailure,
  makeSuccess,
  nowIso,
  resolveWorkspacePath,
  sendJson,
  truncateHistory,
  getShell,
} from './utils';

// ----------------------------------------------------------
// Handler type
// ----------------------------------------------------------

export type RpcHandler = (
  ws: WebSocket,
  id: string,
  payload: Record<string, unknown>,
) => Promise<void>;

// ----------------------------------------------------------
// ServerContext
// ----------------------------------------------------------

export interface ServerContext {
  // Static config
  workspaceRoot: string;
  baseDir: string;

  // Mutable primitive state (boxed in object so mutations are shared)
  state: {
    sequence: number;
    lastGitStatusJson: string;
    managedProcessCounter: number;
    gitPollTimer: ReturnType<typeof setInterval> | null;
  };

  // State maps
  threads: Map<string, OrchestrationThread>;
  messages: Map<string, OrchestrationMessage[]>;
  managedProcesses: Map<string, ManagedProcess>;
  terminalSessions: Map<string, TerminalSession>;

  // Subscription maps (requestId → Subscription)
  terminalSubscriptions: Map<string, Subscription>;
  gitSubscriptions: Map<string, Subscription>;
  orchestrationSubscriptions: Map<string, Subscription>;
  processSubscriptions: Map<string, Subscription>;
  connectionSubscriptions: Map<WebSocket, Set<string>>;

  // Provider/AI
  activeTurnAdapters: Map<string, string>; // threadId → providerKind
  providerRegistry: ProviderRegistry;

  // Orchestration defaults
  defaultThreadTemplate: OrchestrationThread;

  // Broadcast helpers (each has its own subscriber set and fan-out logic)
  broadcastGitStatus: () => Promise<void>;
  broadcastOrchestrationEvent: (event: Record<string, unknown>) => void;
  emitTerminalEvent: (event: Record<string, unknown>) => void;
  emitProcessEvent: (event: Record<string, unknown>) => void;

  // Subscription lifecycle
  addConnectionSubscription: (ws: WebSocket, requestId: string) => void;
  ensureGitPolling: () => void;
  maybeStopGitPolling: () => void;

  // Orchestration helpers
  buildThreadFromCommand: (
    threadId: string,
    command: Record<string, unknown>,
    existing?: OrchestrationThread,
  ) => OrchestrationThread;
  getSnapshot: () => Promise<unknown>;

  // Process helpers
  spawnManagedProcess: (command: string, args: string[], cwd: string) => ManagedProcess;
  serializeManagedProcess: (p: ManagedProcess) => object;

  // Terminal helpers
  createTerminalSession: (
    threadId: string,
    terminalId: string,
    cwdInput: string,
    cols?: number,
    rows?: number,
  ) => TerminalSession;

  // RPC response helpers (re-exported so handlers don't need extra imports)
  sendJson: typeof sendJson;
  makeSuccess: typeof makeSuccess;
  makeFailure: typeof makeFailure;
  makeChunk: typeof makeChunk;
}

// ----------------------------------------------------------
// Factory — call once inside startStaviServer()
// ----------------------------------------------------------

export function createServerContext(
  workspaceRoot: string,
  baseDir: string,
  providerRegistry: ProviderRegistry,
  getGitStatus: (cwd: string) => Promise<import('./types').GitStatusPayload>,
): ServerContext {
  const threads = new Map<string, OrchestrationThread>();
  const messages = new Map<string, OrchestrationMessage[]>();
  const managedProcesses = new Map<string, ManagedProcess>();
  const terminalSessions = new Map<string, TerminalSession>();
  const terminalSubscriptions = new Map<string, Subscription>();
  const gitSubscriptions = new Map<string, Subscription>();
  const orchestrationSubscriptions = new Map<string, Subscription>();
  const processSubscriptions = new Map<string, Subscription>();
  const connectionSubscriptions = new Map<WebSocket, Set<string>>();
  const activeTurnAdapters = new Map<string, string>();

  const state = {
    sequence: 0,
    lastGitStatusJson: '',
    managedProcessCounter: 0,
    gitPollTimer: null as ReturnType<typeof setInterval> | null,
  };

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

  // -- Broadcast helpers --

  const broadcastOrchestrationEvent = (event: Record<string, unknown>) => {
    const payload = { ...event, sequence: ++state.sequence };
    for (const sub of orchestrationSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [payload]));
    }
  };

  const broadcastGitStatus = async () => {
    if (gitSubscriptions.size === 0) return;
    const status = await getGitStatus(workspaceRoot);
    const nextJson = JSON.stringify(status);
    if (nextJson === state.lastGitStatusJson) return;
    state.lastGitStatusJson = nextJson;
    for (const sub of gitSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [status]));
    }
  };

  const emitTerminalEvent = (event: Record<string, unknown>) => {
    const eventThreadId = typeof event.threadId === 'string' ? event.threadId : undefined;
    const eventTerminalId = typeof event.terminalId === 'string' ? event.terminalId : undefined;
    for (const sub of terminalSubscriptions.values()) {
      // Subscriptions without a threadId filter receive nothing (no global broadcast).
      if (!sub.threadId) continue;
      if (sub.threadId !== eventThreadId) continue;
      if (sub.terminalId !== undefined && sub.terminalId !== eventTerminalId) continue;
      sendJson(sub.ws, makeChunk(sub.requestId, [event]));
    }
  };

  const emitProcessEvent = (event: Record<string, unknown>) => {
    for (const sub of processSubscriptions.values()) {
      sendJson(sub.ws, makeChunk(sub.requestId, [event]));
    }
  };

  // -- Git polling --

  const ensureGitPolling = () => {
    if (state.gitPollTimer || gitSubscriptions.size === 0) return;
    state.gitPollTimer = setInterval(() => void broadcastGitStatus(), 4000);
  };

  const maybeStopGitPolling = () => {
    if (gitSubscriptions.size === 0 && state.gitPollTimer) {
      clearInterval(state.gitPollTimer);
      state.gitPollTimer = null;
    }
  };

  // -- Subscription lifecycle --

  const addConnectionSubscription = (ws: WebSocket, requestId: string) => {
    const current = connectionSubscriptions.get(ws) ?? new Set<string>();
    current.add(requestId);
    connectionSubscriptions.set(ws, current);
  };

  // -- Orchestration helpers --

  const resolveThreadWorktreePath = (value: unknown): string => {
    if (typeof value !== 'string' || value.trim().length === 0) return workspaceRoot;
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
        typeof command.branch === 'string' ? command.branch : existing?.branch ?? '',
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

  const getSnapshot = async () => {
    const git = await getGitStatus(workspaceRoot);
    const threadList = Array.from(threads.values()).map((thread) => {
      const threadMessages = messages.get(thread.threadId) ?? [];
      return {
        ...thread,
        branch: git.branch,
        messages: threadMessages,
        conversation: { messages: threadMessages },
        session: { pendingApprovals: [] },
      };
    });
    return {
      snapshotSequence: state.sequence,
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

  // -- Process helpers --

  const serializeManagedProcess = (p: ManagedProcess) => ({
    id: p.id,
    command: p.command,
    args: p.args,
    cwd: p.cwd,
    pid: p.pid,
    status: p.status,
    startTime: p.startTime,
    output: p.output,
  });

  const spawnManagedProcess = (command: string, args: string[], cwd: string): ManagedProcess => {
    const id = `proc-${++state.managedProcessCounter}`;
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = [...parts.slice(1), ...args].filter(Boolean);
    const resolvedCwd = resolveWorkspacePath(workspaceRoot, cwd || '.');

    const managed: ManagedProcess = {
      id,
      command,
      args: cmdArgs,
      cwd: resolvedCwd,
      pid: 0,
      status: 'running',
      startTime: Date.now(),
      output: '',
      proc: null as any,
    };
    managedProcesses.set(id, managed);

    const proc = Bun.spawn([cmd, ...cmdArgs], {
      cwd: resolvedCwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      env: { ...process.env },
    });

    managed.proc = proc;
    managed.pid = proc.pid;

    const appendOutput = (text: string) => {
      managed.output = managed.output.length > 200_000
        ? managed.output.slice(-100_000) + text
        : managed.output + text;
      emitProcessEvent({ type: 'output', id, data: text });
    };

    (async () => {
      try {
        for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
          appendOutput(new TextDecoder().decode(chunk));
        }
      } catch { /* process ended */ }
    })();

    (async () => {
      try {
        for await (const chunk of proc.stderr as AsyncIterable<Uint8Array>) {
          appendOutput(new TextDecoder().decode(chunk));
        }
      } catch { /* process ended */ }
    })();

    (async () => {
      try {
        const exitCode = await proc.exited;
        managed.status = 'exited';
        emitProcessEvent({ type: 'exited', id, exitCode });
      } catch { /* ignore */ }
    })();

    emitProcessEvent({ type: 'started', id, process: serializeManagedProcess(managed) });
    return managed;
  };

  // -- Terminal creation --

  const createTerminalSession = (
    threadId: string,
    terminalId: string,
    cwdInput: string,
    cols?: number,
    rows?: number,
  ): TerminalSession => {
    if (!threadId) throw new Error('threadId is required');
    const key = `${threadId}:${terminalId}`;
    const existing = terminalSessions.get(key);
    if (existing) return existing;

    const cwd = resolveWorkspacePath(workspaceRoot, cwdInput || '.');
    const shell = getShell();

    const session: TerminalSession = {
      threadId,
      terminalId,
      cwd,
      history: '',
      proc: null as any,
      status: 'running',
    };
    terminalSessions.set(key, session);

    const proc = Bun.spawn([shell], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal: {
        cols: cols ?? 80,
        rows: rows ?? 24,
        data(_terminal: any, chunk: Uint8Array) {
          const text = new TextDecoder().decode(chunk);
          session.history = truncateHistory(session.history + text);
          emitTerminalEvent({ type: 'output', threadId, terminalId, data: text });
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

  return {
    workspaceRoot,
    baseDir,
    state,
    threads,
    messages,
    managedProcesses,
    terminalSessions,
    terminalSubscriptions,
    gitSubscriptions,
    orchestrationSubscriptions,
    processSubscriptions,
    connectionSubscriptions,
    activeTurnAdapters,
    providerRegistry,
    defaultThreadTemplate,
    broadcastGitStatus,
    broadcastOrchestrationEvent,
    emitTerminalEvent,
    emitProcessEvent,
    addConnectionSubscription,
    ensureGitPolling,
    maybeStopGitPolling,
    buildThreadFromCommand,
    getSnapshot,
    spawnManagedProcess,
    serializeManagedProcess,
    createTerminalSession,
    sendJson,
    makeSuccess,
    makeFailure,
    makeChunk,
  };
}
