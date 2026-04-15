// WHAT: ServerContext — all shared server state and helper references.
// WHY:  Single object passed to every handler factory; avoids prop-drilling.
// HOW:  createServerContext() assembles the context from submodules:
//       subscriptions.ts (broadcast/subscribe), process-spawn.ts (spawn helpers),
//       repositories (DB persistence), and inline orchestration helpers.
// SEE:  packages/server-core/src/subscriptions.ts,
//       packages/server-core/src/process-spawn.ts,
//       packages/server-core/src/server.ts

import type { WebSocket } from 'ws';
import type {
  ManagedProcess,
  OrchestrationMessage,
  OrchestrationThread,
  Subscription,
  TerminalSession,
} from './types';
import type { ProviderRegistry } from './providers/registry';
import { openDatabase } from './db';
import { SessionRepository } from './repositories/session-repo';
import { ThreadRepository } from './repositories/thread-repo';
import { MessageRepository } from './repositories/message-repo';
import { createSubscriptions } from './subscriptions';
import { createProcessHelpers } from './process-spawn';
import { createOrchestrationHelpers } from './orchestration-helpers';
import {
  makeChunk,
  makeFailure,
  makeSuccess,
  nowIso,
  sendJson,
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
  serverId: string;

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
  sessionSubscriptions: Map<string, Subscription>;
  connectionSubscriptions: Map<WebSocket, Set<string>>;

  // Provider/AI
  activeTurnAdapters: Map<string, string>; // threadId → providerKind
  providerRegistry: ProviderRegistry;

  // Orchestration defaults
  defaultThreadTemplate: OrchestrationThread;

  // Persistence
  db: import('bun:sqlite').Database;
  sessionRepo: import('./repositories/session-repo').SessionRepository;
  threadRepo: import('./repositories/thread-repo').ThreadRepository;
  messageRepo: import('./repositories/message-repo').MessageRepository;

  // Broadcast helpers
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
  serverId: string,
): ServerContext {
  const db = openDatabase(baseDir);
  const sessionRepo = new SessionRepository(db, serverId);
  const threadRepo = new ThreadRepository(db);
  const messageRepo = new MessageRepository(db);

  const threads = new Map<string, OrchestrationThread>();
  const messages = new Map<string, OrchestrationMessage[]>();
  const managedProcesses = new Map<string, ManagedProcess>();
  const terminalSessions = new Map<string, TerminalSession>();
  const activeTurnAdapters = new Map<string, string>();

  const state = {
    sequence: 0,
    lastGitStatusJson: '',
    managedProcessCounter: 0,
    gitPollTimer: null as ReturnType<typeof setInterval> | null,
  };

  const defaultThreadTemplate: OrchestrationThread = {
    threadId: 'thread-local',
    sessionId: 'session-local',
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

  // Warm caches from disk
  for (const thread of threadRepo.listAll()) {
    threads.set(thread.threadId, thread);
  }
  for (const thread of threads.values()) {
    const list = messageRepo.listMessagesForThread(thread.threadId);
    if (list.length > 0) messages.set(thread.threadId, list);
  }

  // -- Subscriptions submodule --
  // Pass state by reference — subscriptions module mutates state.sequence,
  // state.gitPollTimer, and state.lastGitStatusJson in place.
  const subs = createSubscriptions(state, getGitStatus, workspaceRoot);

  // -- Process helpers submodule --
  const { spawnManagedProcess, serializeManagedProcess, createTerminalSession } = createProcessHelpers(
    managedProcesses,
    terminalSessions,
    state,
    workspaceRoot,
    subs.helpers.emitProcessEvent,
    subs.helpers.emitTerminalEvent,
  );

  // -- Orchestration helpers submodule --
  const { buildThreadFromCommand, getSnapshot } = createOrchestrationHelpers(
    threads,
    messages,
    state,
    workspaceRoot,
    defaultThreadTemplate,
    getGitStatus,
  );

  // -- Terminal creation --
  // createTerminalSession is provided by createProcessHelpers in process-spawn.ts

  return {
    workspaceRoot,
    baseDir,
    serverId,
    state,
    db,
    sessionRepo,
    threadRepo,
    messageRepo,
    threads,
    messages,
    managedProcesses,
    terminalSessions,
    ...subs.maps,
    activeTurnAdapters,
    providerRegistry,
    defaultThreadTemplate,
    broadcastGitStatus: subs.broadcastGitStatus,
    ...subs.helpers,
    ensureGitPolling: subs.ensureGitPolling,
    maybeStopGitPolling: subs.maybeStopGitPolling,
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
