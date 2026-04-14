// ============================================================
// types.ts — All shared server-side type interfaces
// ============================================================

import type { WebSocket } from 'ws';
import type { OrchestrationThread } from '@stavi/shared';

// ----------------------------------------------------------
// RPC wire protocol
// ----------------------------------------------------------

export interface RpcRequest {
  _tag: 'Request';
  id: string;
  tag: string;
  payload: Record<string, unknown>;
}

export interface RpcChunk {
  _tag: 'Chunk';
  requestId: string;
  values: unknown[];
}

export interface RpcExit {
  _tag: 'Exit';
  requestId: string;
  exit:
    | { _tag: 'Success'; value?: unknown }
    | { _tag: 'Failure'; cause: { _tag: 'Fail'; error: { message: string } } };
}

// ----------------------------------------------------------
// Subscription tracking
// ----------------------------------------------------------

export interface Subscription {
  ws: WebSocket;
  requestId: string;
  tag: string;
  /** For terminal subscriptions: only emit events matching this threadId. */
  threadId?: string;
  /** For terminal subscriptions: if set, only emit events for this terminalId. */
  terminalId?: string;
}

// ----------------------------------------------------------
// Terminal
// ----------------------------------------------------------

export interface TerminalSession {
  threadId: string;
  terminalId: string;
  cwd: string;
  history: string;
  proc: any; // Bun.Subprocess with terminal
  status: 'running' | 'exited';
}

// ----------------------------------------------------------
// Managed processes
// ----------------------------------------------------------

export interface ManagedProcess {
  id: string;
  command: string;
  args: string[];
  cwd: string;
  pid: number;
  status: 'running' | 'exited' | 'killed';
  startTime: number;
  output: string;
  proc: any; // Bun.Subprocess
}

// ----------------------------------------------------------
// Git
// ----------------------------------------------------------

export interface GitStatusPayload {
  branch: string;
  ahead: number;
  behind: number;
  staged: Array<{ path: string; status: string }>;
  unstaged: Array<{ path: string; status: string }>;
  untracked: string[];
}

// ----------------------------------------------------------
// Orchestration
// ----------------------------------------------------------

export interface OrchestrationMessage {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId?: string;
  streaming?: boolean;
  createdAt: string;
}

export type { OrchestrationThread };

// ----------------------------------------------------------
// Sessions
// ----------------------------------------------------------

export type SessionStatus = 'idle' | 'running' | 'errored' | 'archived';
export type AgentRuntime = 'claude' | 'codex';

export interface Session {
  id: string;
  serverId: string;
  folder: string;
  title: string;
  agentRuntime: AgentRuntime;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  metadata?: Record<string, unknown>;
}

// ----------------------------------------------------------
// Server public interfaces
// ----------------------------------------------------------

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
