// ============================================================
// Terminal Types
// ============================================================

export interface TerminalSession {
  id: string;
  name: string;
  workingDir: string;
  status: 'running' | 'idle' | 'dead';
  createdAt: number;
  lastActivity: number;

  /** tmux session name (server-side, for persistence) */
  tmuxName?: string;

  /** Preview of recent output (stripped ANSI) */
  scrollbackPreview?: string;

  /** Terminal dimensions */
  cols: number;
  rows: number;
}

export interface TerminalTheme {
  background: string;
  foreground: string;
  cursor: string;
  selection: string;

  // ANSI 16 colors
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

// ============================================================
// Filesystem Types
// ============================================================

export interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  modifiedAt: number;
  permissions?: string;
}

// ============================================================
// Git Types
// ============================================================

export interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
}

export interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  oldPath?: string;
}

export interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

export interface GitDiff {
  path: string;
  hunks: GitDiffHunk[];
}

export interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

export interface GitDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

// ============================================================
// Process Types
// ============================================================

export interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpu: number;
  memory: number;
  user: string;
  startTime: string;
}

export interface PortInfo {
  port: number;
  pid: number;
  processName: string;
  protocol: 'tcp' | 'udp';
  state: 'listen' | 'established' | 'close_wait' | 'time_wait';
}

// ============================================================
// System Monitor Types
// ============================================================

export interface SystemInfo {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number; path: string };
  battery?: { level: number; charging: boolean };
  uptime: number;
  hostname: string;
  platform: string;
}

// ============================================================
// AI / Orchestration Types
// ============================================================

export type AIBackend = 'claude' | 'codex';

export interface AIThread {
  id: string;
  title: string;
  backend: AIBackend;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: 'idle' | 'running' | 'waiting_approval' | 'error';
}

export interface AIMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming: boolean;
  createdAt: number;
}

export interface AIActivity {
  id: string;
  threadId: string;
  turnId: string;
  type: 'tool_call' | 'file_edit' | 'command_run' | 'file_read' | 'search';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  data?: Record<string, unknown>;
}

export interface AIApprovalRequest {
  id: string;
  threadId: string;
  turnId: string;
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
}

export interface AICheckpoint {
  turnId: string;
  turnNumber: number;
  threadId: string;
  files: AICheckpointFile[];
  createdAt: number;
}

export interface AICheckpointFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}

// ============================================================
// Session Types
// ============================================================

export type SessionStatus = 'idle' | 'running' | 'errored' | 'archived';
export type AgentRuntime = 'claude' | 'codex';

export interface Session {
  id: string;
  serverId: string;
  folder: string;
  title: string;
  /** Phase 8c: becomes optional — defaults to 'claude' when not supplied.
   *  Acts as a workspace-level fallback for threads whose own agentRuntime is NULL. */
  agentRuntime: AgentRuntime;
  status: SessionStatus;
  createdAt: number;
  updatedAt: number;
  lastActiveAt: number;
  metadata?: Record<string, unknown>;
}

export interface OrchestrationThread {
  threadId: string;
  sessionId: string;
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath: string | null;
  /** Phase 8c: per-chat provider. NULL means inherit from parent session at turn-start time. */
  agentRuntime?: AgentRuntime;
  modelSelection?: {
    provider: string;
    modelId: string;
    thinking?: boolean;
    effort?: string;
    fastMode?: boolean;
    contextWindow?: string;
  };
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SessionWithThreads {
  session: Session;
  threads: OrchestrationThread[];
}
