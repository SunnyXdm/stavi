# Stavi Protocol Reference

This document is the complete reference for the Stavi WebSocket RPC protocol as consumed by Stavi. It covers the wire format, auth flow, every namespace and method tag, subscription streams, event shapes, reconnection logic, the relay protocol, and the in-process GPI/event-bus layer.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Authentication Flow](#2-authentication-flow)
3. [WebSocket Connection](#3-websocket-connection)
4. [Wire Format](#4-wire-format)
   - 4.1 [Request (Client → Server)](#41-request-client--server)
   - 4.2 [Chunk (Server → Client, streaming)](#42-chunk-server--client-streaming)
   - 4.3 [Exit (Server → Client, final)](#43-exit-server--client-final)
5. [One-Shot RPC Methods](#5-one-shot-rpc-methods)
   - 5.1 [terminal.*](#51-terminal-namespace)
   - 5.2 [orchestration.*](#52-orchestration-namespace)
   - 5.3 [git.*](#53-git-namespace)
   - 5.4 [projects.*](#54-projects-namespace)
   - 5.5 [fs.*](#55-fs-namespace)
   - 5.6 [process.*](#56-process-namespace)
   - 5.7 [system.*](#57-system-namespace)
   - 5.8 [server.*](#58-server-namespace)
   - 5.9 [session.*](#59-session-namespace)
   - 5.10 [auth.*](#510-auth-namespace)
6. [Subscriptions (Streaming RPC)](#6-subscriptions-streaming-rpc)
   - 6.1 [subscribeTerminalEvents](#61-subscribeterminalevents)
   - 6.2 [subscribeOrchestrationDomainEvents](#62-subscribeorchestrationdomainevents)
   - 6.3 [subscribeGitStatus](#63-subscribegitstatusns-git-action-statusstream)
   - 6.4 [system.monitorStream](#64-systemmonitorstream)
   - 6.5 [subscribeSessions](#65-subscribesessions)
   - 6.6 [server.lifecycle](#66-serverlifecycle)
7. [Orchestration Domain Events (Detail)](#7-orchestration-domain-events-detail)
8. [Orchestration Commands (Dispatch Payloads)](#8-orchestration-commands-dispatch-payloads)
9. [Snapshot Format](#9-snapshot-format)
10. [Reconnection & Resilience](#10-reconnection--resilience)
11. [ID Generation](#11-id-generation)
12. [Relay Protocol](#12-relay-protocol)
13. [@stavi/protocol Package — RpcMessage Format](#13-staviprotocol-package--rpcmessage-format)
14. [@stavi/shared Domain Types](#14-stavishared-domain-types)
15. [GPI — Cross-Plugin Interface](#15-gpi--cross-plugin-interface)
16. [Plugin Event Bus](#16-plugin-event-bus)
17. [Connection Store States](#17-connection-store-states)
18. [Error Handling](#18-error-handling)

---

## 1. Overview

Stavi communicates with a running Stavi server over a single persistent WebSocket connection. The protocol is **Stavi's wire format** — a simple JSON framing layer with three message types: `Request`, `Chunk`, and `Exit`.

```
Mobile App                          Stavi Server
    │                                      │
    │── POST /api/auth/ws-token ──────────▶│  HTTP: get short-lived WS token
    │◀─ { token, expiresAt } ─────────────│
    │                                      │
    │── ws://<host>:<port>/ws?wsToken=…──▶│  WebSocket upgrade
    │                                      │
    │── { _tag:"Request", id, tag, … } ──▶│  One-shot or subscription open
    │◀─ { _tag:"Chunk", requestId, … } ───│  Zero or more streaming chunks
    │◀─ { _tag:"Exit",  requestId, … } ───│  Final result / subscription closed
```

Two connection modes are supported:

| Mode | Description |
|------|-------------|
| **LAN-direct** | Client connects directly to `<host>:<port>` on the local network |
| **Relay** | Client and server both connect to a Stavi Relay server; relay pipes binary frames between them (E2E encrypted, relay is zero-knowledge) |

---

## 2. Authentication Flow

### Step 1 — Exchange Bearer Token for a WS Token

```
POST <scheme>://<host>:<port>/api/auth/ws-token
Authorization: Bearer <bearerToken>
Content-Type: application/json
```

**Response (200 OK):**

```jsonc
{
  "token": "eyJ...",       // short-lived WS token (opaque string)
  "expiresAt": "2026-04-11T10:30:00.000Z"  // ISO-8601
}
```

**Error responses:**

| HTTP Status | Meaning |
|-------------|---------|
| `401` | Bearer token invalid or missing |
| `403` | Token valid but not authorized |
| `5xx` | Server error |

> **Token refresh:** The client proactively refreshes the WS token **30 seconds before** the reported `expiresAt`. On every reconnect attempt, the cached token is discarded and a fresh one is fetched.

### Step 2 — Open WebSocket with WS Token

```
ws://<host>:<port>/ws?wsToken=<token>
```

or with TLS:

```
wss://<host>:<port>/ws?wsToken=<token>
```

The `wsToken` query parameter is the short-lived token obtained in Step 1.

### StaviConnectionConfig (client-side config object)

```typescript
interface StaviConnectionConfig {
  host: string;       // e.g. "192.168.1.42"
  port: number;       // e.g. 3000
  bearerToken: string; // long-lived bearer token (persisted by the app)
  tls?: boolean;       // if true, use https/wss; default false
}
```

---

## 3. WebSocket Connection

| Property | Value |
|----------|-------|
| URL | `ws[s]://<host>:<port>/ws?wsToken=<token>` |
| Binary type | `arraybuffer` |
| Text encoding | UTF-8 JSON |
| Message framing | Each WebSocket message is one complete JSON object |

Messages may arrive as either string frames or binary `ArrayBuffer` frames; the client decodes binary frames with `TextDecoder` before JSON parsing.

---

## 4. Wire Format

### 4.1 Request (Client → Server)

Every message the client sends is a **Request**:

```typescript
interface RpcRequest {
  _tag: 'Request';
  id: string;                        // Correlation ID (generated client-side)
  tag: string;                       // RPC method tag, e.g. "terminal.open"
  payload: Record<string, unknown>;  // Method-specific arguments
}
```

Example:

```json
{
  "_tag": "Request",
  "id": "lchzg4k-1-a9f2rx",
  "tag": "terminal.open",
  "payload": {
    "threadId": "stavi-term-1",
    "terminalId": "default",
    "cwd": "/home/user/project",
    "cols": 80,
    "rows": 24
  }
}
```

### 4.2 Chunk (Server → Client, streaming)

The server sends zero or more **Chunk** messages for a given `requestId` before the final Exit. Used for subscriptions and streaming responses.

```typescript
interface RpcChunk {
  _tag: 'Chunk';
  requestId: string;   // Matches the id of the originating Request
  values: unknown[];   // Array of event objects emitted in this chunk
}
```

Example:

```json
{
  "_tag": "Chunk",
  "requestId": "lchzg4k-1-a9f2rx",
  "values": [
    { "type": "output", "threadId": "stavi-term-1", "data": "$ ls\r\n" }
  ]
}
```

> Each element of `values` is one event object. The server may batch multiple events into a single Chunk.

### 4.3 Exit (Server → Client, final)

Every Request receives exactly one **Exit** message, signalling completion or failure.

```typescript
interface RpcExit {
  _tag: 'Exit';
  requestId: string;
  exit: {
    _tag: 'Success' | 'Failure';
    value?: unknown;      // Present on Success — the return value
    cause?: {
      _tag: string;       // Effect error tag, e.g. "Fail", "Die"
      error?: unknown;    // The underlying error object
    };
  };
}
```

**Success example (one-shot request):**

```json
{
  "_tag": "Exit",
  "requestId": "lchzg4k-1-a9f2rx",
  "exit": {
    "_tag": "Success",
    "value": {
      "threadId": "stavi-term-1",
      "terminalId": "default",
      "history": "\x1b[?25h$ ",
      "status": "running"
    }
  }
}
```

**Failure example:**

```json
{
  "_tag": "Exit",
  "requestId": "lchzg4k-2-b7q1mn",
  "exit": {
    "_tag": "Failure",
    "cause": {
      "_tag": "Fail",
      "error": { "message": "Terminal not found: stavi-term-99" }
    }
  }
}
```

**Subscription Exit:**  
When a subscription stream ends (server closes it), an Exit is sent. If `exit._tag === "Failure"`, the subscription had an error. The client automatically re-sends the subscription with a new `id`.

---

## 5. One-Shot RPC Methods

One-shot requests send a Request, receive zero or more Chunks (rare for one-shots), and exactly one Exit containing the result.

The `tag` field in the Request uses the format `<namespace>.<action>`, where **namespace** is one of the registered namespaces.

Default request timeout: **30,000 ms**.

---

### 5.1 `terminal` Namespace

#### `terminal.open`

Opens (or attaches to) a terminal session on the server.

**Request payload:**

```typescript
{
  threadId: string;    // Client-assigned session identifier, e.g. "stavi-term-1"
  terminalId: string;  // Sub-terminal within the thread, e.g. "default"
  cwd?: string;        // Working directory, e.g. "/home/user/project" (default: ".")
  cols?: number;       // Terminal width in columns (default: 80)
  rows?: number;       // Terminal height in rows (default: 24)
}
```

**Response (`exit.value`):**

```typescript
{
  threadId: string;    // Echo of the threadId
  terminalId: string;  // Echo of the terminalId
  history: string;     // Scrollback history as raw terminal bytes (may include ANSI sequences)
  status: string;      // "running" | "exited" | "connecting"
}
```

---

#### `terminal.close`

Closes a terminal session on the server.

**Request payload:**

```typescript
{
  threadId: string;
  terminalId: string;
}
```

**Response:** `void` (Success with no value)

---

#### `terminal.write`

Sends keystrokes / stdin data to a running terminal.

**Request payload:**

```typescript
{
  threadId: string;
  data: string;   // Raw bytes to write (e.g. typed characters, escape sequences)
}
```

**Response:** `void`

---

#### `terminal.resize`

Notifies the server of a terminal dimension change (SIGWINCH).

**Request payload:**

```typescript
{
  threadId: string;
  cols: number;
  rows: number;
}
```

**Response:** `void`

---

#### Other `terminal.*` actions (defined in `NamespaceActions`)

| Tag | Purpose |
|-----|---------|
| `terminal.list` | List all active terminal sessions |
| `terminal.attach` | Attach to an existing session |
| `terminal.detach` | Detach from a session |
| `terminal.kill` | Force-kill a session |
| `terminal.scrollback` | Retrieve scrollback buffer |

---

### 5.2 `orchestration` Namespace

#### `orchestration.getSnapshot`

Fetches the current full state of the orchestration domain (all threads, projects, and their conversations).

**Request payload:** `{}` (empty)

**Response (`exit.value`):**

```typescript
{
  snapshotSequence: number;  // Monotonic sequence number of the snapshot
  threads: Array<{
    threadId: string;
    sessionId: string;
    projectId: string;
    title: string;
    runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
    interactionMode: 'default' | 'plan';
    branch: string;
    worktreePath: string | null;
    archived: boolean;
    createdAt: string;   // ISO-8601
    updatedAt: string;   // ISO-8601

    // Nested conversation data
    conversation?: {
      messages: Array<{
        messageId: string;
        role: 'user' | 'assistant';
        text: string;
        turnId?: string;
        createdAt: string;
      }>;
    };

    // Pending approvals from the active session
    session?: {
      pendingApprovals: Array<{
        requestId: string;
        toolName: string;
        toolInput: Record<string, unknown>;
      }>;
    };
  }>;
  projects: Array<unknown>;  // Project metadata (structure TBD by server)
}
```

---

#### `orchestration.dispatchCommand`

Dispatches a command to the orchestration system. Commands are the write side of the event-sourced domain.

**Request payload:**

```typescript
{
  command: OrchestrationCommand;  // See §8 for all command shapes
}
```

**Response:** `void` (the effect of the command is observed via `subscribeOrchestrationDomainEvents`)

---

#### Other `orchestration.*` actions (defined in `NamespaceActions`)

| Tag | Purpose |
|-----|---------|
| `orchestration.getTurnDiff` | Get file diff for a specific turn |
| `orchestration.getFullThreadDiff` | Get cumulative diff for a thread |
| `orchestration.replayEvents` | Replay events from a given sequence number |

---

### 5.3 `git` Namespace

All git commands are implemented via `Bun.spawn(['git', ...])` in the server's CWD. Buffer size for diff output is 2MB.

#### `git.status` / `git.refreshStatus`

Returns current git status. `refreshStatus` is an alias.

**Request payload:** `{}`

**Response (`exit.value`):**

```typescript
{
  branch: string;          // e.g. "main"
  ahead: number;           // commits ahead of upstream
  behind: number;          // commits behind upstream
  staged: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' }>;
  unstaged: Array<{ path: string; status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied' }>;
  untracked: string[];     // untracked file paths
}
```

---

#### `git.stage`

Stages files for commit.

**Request payload:**

```typescript
{
  paths: string[];   // file paths to stage, e.g. ["src/app.ts", "README.md"]
}
```

**Response:** `{ ok: true }`

**Implementation:** `git add -- ...paths`

---

#### `git.unstage`

Unstages files from the index.

**Request payload:**

```typescript
{
  paths: string[];   // file paths to unstage
}
```

**Response:** `{ ok: true }`

**Implementation:** `git restore --staged -- ...paths`

---

#### `git.commit`

Creates a git commit.

**Request payload:**

```typescript
{
  message: string;   // commit message
}
```

**Response:** `{ ok: true, output: string }`

**Implementation:** `git commit -m <message>`

---

#### `git.diff`

Returns diff summary statistics.

**Request payload:**

```typescript
{
  path?: string;     // specific file path (optional — omit for full working tree)
  staged?: boolean;  // if true, shows staged diff (--staged flag)
}
```

**Response:** `{ diff: string }`

**Implementation:** `git diff [--staged] --stat --numstat [-- path]`

---

#### `git.diffFile`

Returns full unified diff for a specific file.

**Request payload:**

```typescript
{
  path: string;      // file path
  staged?: boolean;  // if true, shows staged diff
}
```

**Response:** `{ diff: string }`

**Implementation:** `git diff [--staged] -- <path>` with 2MB max buffer

---

#### `git.log`

Returns commit history.

**Request payload:**

```typescript
{
  limit?: number;    // max commits to return (default: 50)
}
```

**Response:**

```typescript
{
  commits: Array<{
    hash: string;      // full SHA
    message: string;   // first line of commit message
    author: string;    // author name
    date: string;      // ISO-8601 date
  }>;
}
```

**Implementation:** `git log --format=%H%x00%s%x00%an%x00%aI -n <limit>`, parsed by splitting on `\0`

---

#### `git.branches`

Lists all branches (local and remote).

**Request payload:** `{}`

**Response:**

```typescript
{
  branches: Array<{
    name: string;       // branch name (e.g. "main", "remotes/origin/main")
    hash: string;       // short SHA
    upstream: string;   // upstream tracking branch (e.g. "origin/main")
    current: boolean;   // true if this is the current branch
  }>;
}
```

**Implementation:** `git branch -a --format=%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(HEAD)`

---

#### `git.checkout`

Checks out a branch (or creates + checks out a new branch).

**Request payload:**

```typescript
{
  branch: string;    // branch name to checkout
  create?: boolean;  // if true, creates the branch first (-b flag)
}
```

**Response:** `{ ok: true }`

**Implementation:** `git checkout [-b] <branch>`

---

#### `git.push`

Pushes commits to remote.

**Request payload:**

```typescript
{
  force?: boolean;   // if true, uses --force-with-lease (NOT --force)
}
```

**Response:** `{ ok: true, output: string }`

**Implementation:** `git push [--force-with-lease]`

---

#### `git.pull`

Pulls from remote.

**Request payload:**

```typescript
{
  rebase?: boolean;  // if true, uses --rebase
}
```

**Response:** `{ ok: true, output: string }`

**Implementation:** `git pull [--rebase]`

---

#### `git.discard`

Discards changes to tracked files and removes untracked files.

**Request payload:**

```typescript
{
  paths: string[];   // file paths to discard
}
```

**Response:** `{ ok: true }`

**Implementation:** Two-step: `git checkout -- ...paths` (restore tracked), then `git clean -fd -- ...paths` (remove untracked)

---

### 5.4 `projects` Namespace

> Note: In the codebase, these tags use the prefix `projects.` rather than the `fs.` namespace. They appear to be Stavi's project-aware file system layer.

#### `projects.searchEntries`

Searches for files/directories within the active project.

**Request payload:**

```typescript
{
  query: string;   // Search query or glob pattern (e.g. "*", "src/**/*.ts")
  limit?: number;  // Max results (e.g. 200)
}
```

**Response (`exit.value`):**

```typescript
{
  entries: Array<{
    name: string;   // Filename
    path: string;   // Relative path from project root
    type: string;   // "file" | "directory"
  }>;
  content?: string; // Present when searching for a specific file by path
}
```

---

#### `projects.writeFile`

Writes content to a file in the project.

**Request payload:**

```typescript
{
  path: string;     // Relative or absolute path
  content: string;  // Full file content
}
```

**Response:** `void`

---

### 5.5 `fs` Namespace

Full filesystem operations:

| Tag | Purpose |
|-----|---------|
| `fs.list` | List directory contents (see below for `showHidden` option) |
| `fs.read` | Read a file |
| `fs.write` | Write a file |
| `fs.create` | Create a new file or directory (Phase 4a) |
| `fs.rename` | Rename or move a file / directory (Phase 4a) |
| `fs.delete` | Delete a file or directory (Phase 4a) |
| `fs.search` | Search file contents (fuzzy + exact-path) |
| `fs.grep` | Full-text ripgrep search |

#### `fs.list` (updated — Phase 4a)

**Request payload:**

```typescript
{
  path: string;          // Absolute or relative path
  showHidden?: boolean;  // Default false. When true, HIDDEN_DIRS and dot-files
                         // are NOT filtered — shows .git, node_modules, etc.
}
```

**Response (`exit.value`):**

```typescript
{
  path: string;
  entries: Array<{
    name: string;
    type: 'file' | 'directory';
    size?: number;  // Present for files
  }>;
}
```

Entries are sorted: directories first, then files, both alphabetically.

---

#### `fs.create` (new — Phase 4a)

Creates a new file or directory. Rejects paths outside `workspaceRoot` and known Session folders (path-traversal guard).

**Request payload:**

```typescript
{
  path: string;                   // Absolute path
  type: 'file' | 'directory';
  content?: string;               // Initial content for files (default: empty)
}
```

**Response (`exit.value`):** `{ ok: true }`

---

#### `fs.rename` (updated — Phase 4a)

Renames or moves a file or directory. Rejects source/destination paths outside allowed roots.

**Request payload:**

```typescript
{
  from: string;   // Absolute source path
  to: string;     // Absolute destination path
}
```

**Response (`exit.value`):** `{ ok: true }`

---

#### `fs.delete` (updated — Phase 4a)

Deletes a file or directory. Rejects paths outside allowed roots.

**Request payload:**

```typescript
{
  path: string;
  recursive?: boolean;  // Required true to delete non-empty directories (default false)
}
```

**Response (`exit.value`):** `{ ok: true }`

---

#### Path-traversal guard (all mutating fs RPCs)

`fs.create`, `fs.rename`, and `fs.delete` validate that the target path falls within:
1. `ctx.workspaceRoot`, OR
2. A folder of any active (non-archived) Session in the database.

Requests that fail this check receive `Exit.Failure` with `"Path is outside allowed workspace roots"`.

---

### 5.6 `process` Namespace

| Tag | Purpose |
|-----|---------|
| `process.list` | List running processes |
| `process.kill` | Kill a process by PID |
| `process.ports` | List open ports |
| `process.killByPort` | Kill the process listening on a port |

---

### 5.7 `system` Namespace

| Tag | Purpose |
|-----|---------|
| `system.info` | Get static system info (CPU model, hostname, platform) |
| `system.monitor` | One-shot system metrics snapshot |

---

### 5.8 `server` Namespace

#### `server.getConfig`

Returns server configuration including CWD and available AI providers with their models.

**Request payload:** `{}`

**Response (`exit.value`):**

```typescript
{
  cwd: string;                     // Server's current working directory
  serverId: string;                // Stable server UUID from credentials.json
  providers: Array<{
    provider: 'claude' | 'codex';  // Provider identifier
    installed: boolean;            // true if the provider's requirements are met
    authenticated: boolean;        // true if API key / auth is configured
    ready: boolean;                // true if adapter.isReady()
    models: Array<{
      id: string;                  // e.g. "claude-sonnet-4-20250514"
      name: string;                // e.g. "Claude Sonnet 4"
      supportsThinking: boolean;   // extended thinking / reasoning support
      maxTokens: number;           // max output tokens
      contextWindow: number;       // context window size
      isDefault?: boolean;         // true for the default model of this provider
    }>;
  }>;
}
```

---

#### `server.getSettings`

Returns current user settings. API keys are masked for security.

**Request payload:** `{}`

**Response (`exit.value`):**

```typescript
{
  anthropicApiKey?: string;    // Masked: "sk-an...1234" (first 5 + last 4 chars)
  defaultProvider?: string;    // e.g. "claude"
  defaultModel?: string;      // e.g. "claude-sonnet-4-20250514"
  codexBinaryPath?: string;   // e.g. "/usr/local/bin/codex"
}
```

---

#### `server.updateSettings`

Updates user settings and persists to `~/.stavi/userdata/settings.json`. If the Anthropic API key is changed, the Claude adapter is re-initialized.

**Request payload:**

```typescript
{
  anthropicApiKey?: string;    // Full unmasked API key
  defaultProvider?: string;
  defaultModel?: string;
  codexBinaryPath?: string;
}
```

**Response:**

```typescript
{
  ok: true;
  providers: ProviderInfo[];   // Refreshed provider list (same shape as server.getConfig)
}
```

---

#### `server.refreshProviders`

Re-probes provider availability (re-checks API keys, re-runs `which codex`, re-initializes adapters).

**Request payload:** `{}`

**Response:**

```typescript
{
  providers: ProviderInfo[];   // Refreshed provider list
}
```

---

### 5.9 `session` Namespace

#### `session.create`

Creates a new Session.

**Request payload:**

```typescript
{
  folder: string;           // absolute folder path
  title?: string;           // default: "Workspace"
  agentRuntime?: 'claude' | 'codex';
}
```

**Response (`exit.value`):** `Session`

---

#### `session.list`

Lists sessions.

**Request payload:**

```typescript
{ includeArchived?: boolean }
```

**Response (`exit.value`):**

```typescript
{ sessions: Session[] }
```

---

#### `session.get`

Fetch one session + its threads.

**Request payload:**

```typescript
{ sessionId: string }
```

**Response (`exit.value`):**

```typescript
{ session: Session; threads: OrchestrationThread[] }
```

---

#### `session.rename`

Rename a session.

**Request payload:**

```typescript
{ sessionId: string; title: string }
```

**Response (`exit.value`):**

```typescript
{ session: Session }
```

---

#### `session.archive`

Archive a session (status='archived').

**Request payload:**

```typescript
{ sessionId: string }
```

**Response:** `{ ok: true }`

---

#### `session.delete`

Hard delete a session (cascades threads/messages).

**Request payload:**

```typescript
{ sessionId: string }
```

**Response:** `{ ok: true }`

---

#### `session.touch`

Update lastActiveAt (and optionally status via server internals).

**Request payload:**

```typescript
{ sessionId: string }
```

**Response:** `{ ok: true }`

---

### 5.10 `auth` Namespace

| Tag | Purpose |
|-----|---------|
| `auth.validate` | Validate a token |
| `auth.pair` | Pair a new device |
| `auth.revoke` | Revoke a session |
| `auth.listSessions` | List active sessions |

---

## 6. Subscriptions (Streaming RPC)

Subscriptions use the same Request message as one-shot calls. The server sends **Chunk** messages indefinitely (each containing one or more events) until the subscription ends with an **Exit**.

The client sends the Request once and registers an `onEvent` callback. On reconnect, all registered subscriptions are **automatically re-sent** with new request IDs.

To cancel a subscription, the client simply drops the local registration. There is no explicit unsubscribe message sent to the server.

---

### 6.1 `subscribeTerminalEvents`

Subscribes to all terminal events across all sessions.

**Request payload:** `{}`

**Chunk `values` element shape:**

```typescript
// type: "output" — new terminal output
{
  type: 'output';
  threadId: string;  // Which terminal session this is for
  data: string;      // Raw terminal bytes (may include ANSI/VT100 sequences)
}

// type: "started" — terminal session started or reset
{
  type: 'started';
  threadId: string;
  snapshot?: {
    history: string;  // Full scrollback at start time
  };
}

// type: "cleared" — screen was cleared
{
  type: 'cleared';
  threadId: string;
}

// type: "exited" — process in terminal exited
{
  type: 'exited';
  threadId: string;
  exitCode?: number;
}

// type: "restarted" — terminal session restarted
{
  type: 'restarted';
  threadId: string;
  snapshot?: {
    history: string;
  };
}
```

**Client filtering:** The subscription delivers events for ALL terminal sessions. Clients filter by `event.threadId` to route events to the correct terminal view.

---

### 6.2 `subscribeOrchestrationDomainEvents`

Subscribes to live orchestration domain events (all threads, all projects).

**Request payload:** `{}`

**Chunk `values` element shape:**

```typescript
{
  type: string;                    // Event type string, see §7
  sequence?: number;               // Monotonic sequence number (for replay)
  occurredAt?: string;             // ISO-8601 timestamp
  payload: Record<string, unknown>; // Event-specific data, see §7
}
```

See §7 for the full list of event types and their payload shapes.

---

### 6.3 `subscribeGitStatus` (ns: `git`, action: `statusStream`)

Subscribes to live git status updates for the active project.

**Request payload:** `{}`

**Chunk `values` element shape (the full status object):**

```typescript
{
  branch?: string;           // Current branch name
  head?: { name: string };   // Alternative branch name location
  ahead: number;             // Commits ahead of remote
  behind: number;            // Commits behind remote

  staged: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  }>;

  unstaged: Array<{
    path: string;
    status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  }>;

  untracked: Array<string | { path: string }>;  // Untracked file paths
}
```

> The `branch` field may appear as either `event.branch` or `event.head.name` depending on the server version.

---

### 6.4 `system.monitorStream`

Streams periodic system resource usage snapshots.

**Request payload:** `{}`

**Chunk `values` element shape:**

```typescript
{
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number };
  disk: { total: number; used: number; free: number; path: string };
  battery?: { level: number; charging: boolean };
  uptime: number;
  hostname: string;
  platform: string;
}
```

---

### 6.5 `subscribeSessions`

Subscribes to session CRUD events.

**Request payload:** `{}`

**Chunk `values` element shape:**

```typescript
{ type: 'created' | 'updated' | 'archived' | 'deleted'; session: Session }
```

---

### 6.6 `server.lifecycle`

Streams server lifecycle events (e.g. ready, shutdown, config reload).

**Request payload:** `{}`

**Chunk `values` element shape:** Server-defined (structure TBD).

---

## 7. Orchestration Domain Events (Detail)

These are the `type` values delivered via `subscribeOrchestrationDomainEvents`. Each event has a `payload` field with the data described below.

### Thread Lifecycle Events

#### `thread.created`

```typescript
payload: {
  threadId: string;
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath: string | null;
  createdAt: string;
  updatedAt: string;
}
```

#### `thread.deleted`

```typescript
payload: {
  threadId: string;
}
```

#### `thread.archived`

```typescript
payload: {
  threadId: string;
}
```

#### `thread.meta-updated`

```typescript
payload: {
  threadId: string;
  title?: string;      // New title (if changed)
  updatedAt: string;
}
```

### Message Events

#### `thread.message-sent`

Fired for both new messages and streaming text updates to an existing message. Clients should upsert on `messageId`.

```typescript
payload: {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;           // Full accumulated text (not a delta)
  turnId?: string;        // Which AI turn generated this message
  streaming?: boolean;    // true while the message is still being streamed
  createdAt: string;
}
```

### Activity Events

#### `thread.activity-appended`

Fired when a tool call, reasoning step, or other activity is appended to the thread during an AI turn.

```typescript
payload: {
  threadId: string;
  turnId: string;
  type: 'reasoning' | 'tool-use' | 'tool-result';
  text?: string;               // For reasoning: the thinking text
  toolName?: string;           // For tool-use/tool-result: name of the tool
  toolId?: string;             // Unique tool call ID
  input?: string;              // Tool input (JSON string)
  state?: 'running' | 'completed' | 'failed';  // Tool execution state
  result?: string;             // Tool execution result (for tool-result)
}
// Top-level event also has:
occurredAt: string;  // ISO-8601
```

#### `thread.token-usage`

Fired at the end of an AI turn with token consumption statistics.

```typescript
payload: {
  threadId: string;
  turnId: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}
```

### Approval Events

#### `thread.approval-response-requested`

Fired when a pending approval has been responded to (approved or rejected).

```typescript
payload: {
  threadId: string;
  requestId: string;
}
```

### Session Events

#### `thread.session-set`

Fired when the thread's session state changes (e.g. a new AI session starts, pending approvals change).

```typescript
payload: {
  threadId: string;
  // Session object structure is server-defined
}
```

---

## 8. Orchestration Commands (Dispatch Payloads)

All commands are dispatched via `orchestration.dispatchCommand` with `{ command: <CommandObject> }`.

### `thread.create` — Create a new thread

```typescript
{
  type: 'thread.create';
  commandId: string;
  threadId: string;
  sessionId: string;           // Required starting Phase 1
  projectId: string;
  title: string;
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  branch: string;
  worktreePath?: string | null;
  createdAt: string;           // ISO-8601
}
```

---

### `thread.turn.start` — Send a message / start an AI turn

```typescript
{
  type: 'thread.turn.start';
  commandId: string;           // Client-generated unique ID, e.g. "cmd-1744372800000-a2f"
  threadId: string;
  sessionId: string;           // Required starting Phase 1
  message: {
    messageId: string;         // Client-generated, used for optimistic UI
    role: 'user';
    text: string;
    attachments: [];           // Currently always empty array
  };
  runtimeMode: 'approval-required' | 'auto-accept-edits' | 'full-access';
  interactionMode: 'default' | 'plan';
  modelSelection?: {          // Optional — omit to use server default
    provider: 'claude' | 'codex';
    modelId: string;           // e.g. "claude-sonnet-4-20250514"
    thinking?: boolean;        // Enable extended thinking (Claude only)
    thinkingBudget?: number;   // Thinking budget in tokens (default: 10000)
    effort?: 'low' | 'medium' | 'high';  // Reasoning effort
  };
  createdAt: string;           // ISO-8601
}
```

**Server behavior:**
1. Resolves provider adapter from `modelSelection.provider` (or default)
2. Calls `adapter.sendTurn({ threadId, text, modelSelection, interactionMode })`
3. Iterates the `AsyncGenerator<ProviderEvent>` stream
4. For each event, broadcasts an orchestration domain event:
   - `text-delta` → `thread.message-sent { streaming: true, text: <accumulated> }`
   - `thinking-delta` → `thread.activity-appended { type: 'reasoning', text }`
   - `tool-use-start` → `thread.activity-appended { type: 'tool-use', toolName, toolId }`
   - `tool-use-done` → `thread.activity-appended { type: 'tool-result', toolName, result }`
   - `approval-required` → `thread.approval-response-requested { requestId, toolName, toolInput }`
   - `turn-complete` → `thread.message-sent { streaming: false }` + `thread.token-usage`
5. If no provider available → falls back to placeholder response

### `thread.turn.interrupt` — Interrupt a running AI turn

```typescript
{
  type: 'thread.turn.interrupt';
  commandId: string;
  threadId: string;
  sessionId: string;           // Required starting Phase 1
  createdAt: string;           // ISO-8601
}
```

**Server behavior:** Calls `adapter.interruptTurn(threadId)` which:
- Claude: triggers `abortController.abort()` on the streaming request
- Codex: sends JSON-RPC `turn/interrupt` to the subprocess

### `thread.approval.respond` — Respond to a tool approval request

```typescript
{
  type: 'thread.approval.respond';
  commandId: string;
  threadId: string;
  sessionId: string;           // Required starting Phase 1
  requestId: string;           // The approval request ID from the event
  decision: 'accept' | 'reject' | 'always-allow';
  createdAt: string;           // ISO-8601
}
```

**Server behavior:** Calls `adapter.respondToApproval(threadId, requestId, decision)`:
- Claude: no-op (Claude direct API has no tool approval gates)
- Codex: sends JSON-RPC response with `{ decision: 'accept' | 'acceptForSession' | 'decline' }` to the pending request ID. `always-allow` maps to `acceptForSession`.

---

## 9. Snapshot Format

`orchestration.getSnapshot` returns the full current state. The `snapshotSequence` field marks the event sequence up to which the snapshot is current. After subscribing to `subscribeOrchestrationDomainEvents`, clients should ignore events with `sequence <= snapshotSequence` to avoid double-applying already-included state.

```
snapshotSequence = N
  └─ All events 0..N are reflected in the snapshot
  └─ Live subscription starts delivering events from N+1 onwards
```

---

## 10. Reconnection & Resilience

The `StaviClient` implements automatic reconnection with **exponential backoff**.

### Reconnect Schedule

| Attempt | Delay |
|---------|-------|
| 1 | 1 s |
| 2 | 2 s |
| 3 | 4 s |
| 4 | 8 s |
| 5 | 16 s |
| 6 | 32 s |
| 7 (max) | 64 s |

After 7 failed attempts, the client transitions to `disconnected` state with error `"Max reconnect attempts reached"`.

### Reconnect Behavior

1. Discard the cached WS token (it may have expired).
2. Re-fetch a new WS token from `/api/auth/ws-token`.
3. Open a new WebSocket.
4. Re-send all `registeredSubscriptions` with fresh request IDs.
5. Pending one-shot requests that were in-flight are **rejected** with `"Connection closed"`.

### Reconnect Triggering Conditions

| Condition | Action |
|-----------|--------|
| `ws.onclose` with `!event.wasClean` | Reconnect |
| `ws.onclose` with `event.wasClean` (not intentional) | Transition to `disconnected` |
| `disconnect()` called explicitly | Set `isIntentionalClose = true`, no reconnect |

---

## 11. ID Generation

Client-side request IDs are generated with a collision-resistant scheme (no crypto dependency):

```
<base36 timestamp> - <base36 monotonic counter> - <6 char random base36>
```

Example: `lchzg4k-1-a9f2rx`

Orchestration `commandId` and `messageId` use a similar pattern:

```
cmd-<unix ms>-<4 char random base36>
msg-<unix ms>-<4 char random base36>
```

---

## 12. Relay Protocol

The Stavi Relay is a **zero-knowledge binary frame forwarder**. It cannot read or decrypt any RPC content — it only routes encrypted WebSocket frames between a paired server and mobile client.

### Relay Endpoints

| Endpoint | Protocol | Purpose |
|----------|----------|---------|
| `ws[s]://<relay-host>:<port>/room/:roomId?role=server\|mobile&token=xxx` | WebSocket | Connect to a relay room |
| `GET http://<relay-host>:<port>/health` | HTTP | Health check |

**Default port:** `9022` (configurable via `STAVI_RELAY_PORT` env var)  
**Default host bind:** `0.0.0.0` (configurable via `STAVI_RELAY_HOST` env var)

### URL Parameters

| Parameter | Values | Required | Description |
|-----------|--------|----------|-------------|
| `role` | `server` \| `mobile` | Yes | Which slot this connection fills in the room |
| `token` | string | Yes | Room authentication token |

### Room Lifecycle

1. **Room creation:** The first WebSocket to connect to `/room/:roomId` creates the room.
2. **Peer notification:** When the second peer connects, both sides receive:
   ```json
   { "type": "peer_connected" }
   ```
3. **Frame forwarding:** All subsequent messages are forwarded as-is to the other peer (no parsing, no interpretation — pure pipe).
4. **Peer disconnect:** The remaining peer receives:
   ```json
   { "type": "peer_disconnected" }
   ```
5. **Grace period:** After one side disconnects, the relay waits **60 seconds** for it to reconnect before tearing down the room.
6. **Room destruction:** When both sides are gone (or grace period expires), the room is deleted and remaining connections are closed with code `4001`.

### Relay Close Codes

| Code | Meaning |
|------|---------|
| `4000` | Slot already occupied (duplicate `role` connection) |
| `4001` | Peer disconnected (grace period expired) |

### Health Check Response

```json
{
  "status": "ok",
  "rooms": 3,
  "uptime": 1234.56
}
```

### Pairing Payload

When mobile first pairs with a server (QR code or manual entry), the server provides a `PairingPayload`:

```typescript
interface PairingPayload {
  relay?: string;            // Relay server URL (empty = LAN-direct only)
  roomId: string;            // Room ID for relay routing
  serverPublicKey: string;   // Server's static X25519 public key (base64) for E2E
  token: string;             // One-time auth token
  lanHost?: string;          // Server's LAN IP address (for direct connection)
  port: number;              // Server's port
}
```

---

## 13. `@stavi/protocol` Package — RpcMessage Format

The `@stavi/protocol` package (`packages/protocol/`) defines an **alternative namespaced message format** used internally and potentially by relay-aware code. This format differs from the Effect RPC wire format used by T3 directly.

### RpcMessage (protocol package format)

```typescript
interface RpcMessage {
  v: 1;                              // Protocol version (always 1)
  id: string;                        // Correlation ID, e.g. "msg_1744372800000_1"
  ns: RpcNamespace;                  // Namespace
  action: string;                    // Action within namespace
  payload: Record<string, unknown>;  // Arguments
}
```

### RpcResponse (protocol package format)

```typescript
interface RpcResponse extends RpcMessage {
  ok: boolean;
  error?: {
    code: string;
    message: string;
  };
}
```

### SubscriptionMessage (protocol package format)

```typescript
interface SubscriptionMessage {
  v: 1;
  ns: RpcNamespace;
  action: string;
  payload: Record<string, unknown>;
  seq: number;  // Monotonic sequence number for replay on reconnect
}
```

### RpcNamespace values

```typescript
type RpcNamespace =
  | 'orchestration'
  | 'terminal'
  | 'fs'
  | 'git'
  | 'process'
  | 'system'
  | 'server'
  | 'auth';
```

### Message Constructors

```typescript
// Create a request message
createRpcMessage(ns: RpcNamespace, action: string, payload?: Record<string, unknown>): RpcMessage

// Create a response message
createRpcResponse(
  request: RpcMessage,
  ok: boolean,
  payload?: Record<string, unknown>,
  error?: { code: string; message: string }
): RpcResponse

// Type guards
isRpcResponse(msg: RpcMessage): msg is RpcResponse
isSubscriptionMessage(msg: unknown): msg is SubscriptionMessage
```

### Full Namespace → Action Map

```typescript
const NamespaceActions = {
  terminal:      ['open','close','write','resize','list','attach','detach','kill','scrollback'],
  fs:            ['list','read','write','delete','rename','move','mkdir','stat','search'],
  git:           ['status','diff','log','stage','unstage','commit','push','pull','branches','checkout','createBranch'],
  orchestration: ['getSnapshot','dispatchCommand','getTurnDiff','getFullThreadDiff','replayEvents'],
  process:       ['list','kill','ports','killByPort'],
  system:        ['info','monitor'],
  server:        ['getConfig','getSettings','updateSettings','refreshProviders'],
  auth:          ['validate','pair','revoke','listSessions'],
}
```

### Named Subscription Streams

```typescript
const Subscriptions = {
  TERMINAL_EVENTS:       { ns: 'terminal',      action: 'events' },
  ORCHESTRATION_EVENTS:  { ns: 'orchestration', action: 'events' },
  GIT_STATUS:            { ns: 'git',           action: 'statusStream' },
  SYSTEM_MONITOR:        { ns: 'system',        action: 'monitorStream' },
  SERVER_LIFECYCLE:      { ns: 'server',        action: 'lifecycle' },
}
```

---

## 14. `@stavi/shared` Domain Types

The `@stavi/shared` package (`packages/shared/`) defines canonical TypeScript types for all domain objects used across the protocol.

### Terminal

```typescript
interface TerminalSession {
  id: string;
  name: string;
  workingDir: string;
  status: 'running' | 'idle' | 'dead';
  createdAt: number;       // Unix ms
  lastActivity: number;    // Unix ms
  tmuxName?: string;       // Server-side tmux session name
  scrollbackPreview?: string;
  cols: number;
  rows: number;
}
```

### Filesystem

```typescript
interface FsEntry {
  name: string;
  path: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;            // Bytes
  modifiedAt: number;      // Unix ms
  permissions?: string;    // e.g. "rwxr-xr-x"
}
```

### Git

```typescript
interface GitStatus {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitFileChange[];
  unstaged: GitFileChange[];
  untracked: string[];
}

interface GitFileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'copied';
  oldPath?: string;  // Present for renamed files
}

interface GitLogEntry {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
}

interface GitDiff {
  path: string;
  hunks: GitDiffHunk[];
}

interface GitDiffHunk {
  header: string;
  lines: GitDiffLine[];
}

interface GitDiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}
```

### Processes & Ports

```typescript
interface ProcessInfo {
  pid: number;
  name: string;
  command: string;
  cpu: number;       // Percent
  memory: number;    // Bytes
  user: string;
  startTime: string;
}

interface PortInfo {
  port: number;
  pid: number;
  processName: string;
  protocol: 'tcp' | 'udp';
  state: 'listen' | 'established' | 'close_wait' | 'time_wait';
}
```

### System

```typescript
interface SystemInfo {
  cpu: { usage: number; cores: number; model: string };
  memory: { total: number; used: number; free: number };  // Bytes
  disk: { total: number; used: number; free: number; path: string };
  battery?: { level: number; charging: boolean };
  uptime: number;    // Seconds
  hostname: string;
  platform: string;
}
```

### AI / Orchestration

```typescript
type AIBackend = 'claude' | 'codex';

interface AIThread {
  id: string;
  title: string;
  backend: AIBackend;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
  status: 'idle' | 'running' | 'waiting_approval' | 'error';
}

interface AIMessage {
  id: string;
  threadId: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
  streaming: boolean;
  createdAt: number;
}

interface AIActivity {
  id: string;
  threadId: string;
  turnId: string;
  type: 'tool_call' | 'file_edit' | 'command_run' | 'file_read' | 'search';
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: number;
  data?: Record<string, unknown>;
}

interface AIApprovalRequest {
  id: string;
  threadId: string;
  turnId: string;
  tool: string;
  description: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'approved' | 'denied';
}

interface AICheckpoint {
  turnId: string;
  turnNumber: number;
  threadId: string;
  files: AICheckpointFile[];
  createdAt: number;
}

interface AICheckpointFile {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  additions: number;
  deletions: number;
}
```

---

## 15. GPI — Cross-Plugin Interface

GPI (Global Plugin Interface) is Stavi's **in-process** typed cross-plugin call bus. It is not transmitted over the network — it is a Proxy-based dispatch within the mobile app that routes method calls to the registered plugin's `api()` factory.

```
gPI.editor.openFile('/src/app.tsx')
     │
     └─ Proxy looks up 'editor' in plugin registry
        └─ Calls editorPlugin.api()
           └─ Returns EditorPluginAPI implementation
              └─ Calls .openFile('/src/app.tsx')
```

### GPI Interfaces

```typescript
interface TerminalPluginAPI {
  createSession(workingDir?: string): Promise<{ sessionId: string }>;
  attachSession(sessionId: string): Promise<void>;
  sendInput(sessionId: string, data: string): void;
  listSessions(): Promise<Array<{ id: string; name: string; workingDir: string }>>;
}

interface EditorPluginAPI {
  openFile(path: string, line?: number): Promise<void>;
  saveFile(path: string): Promise<void>;
  getCurrentFile(): string | null;
}

interface AIPluginAPI {
  sendMessage(text: string, threadId?: string): Promise<{ threadId: string; turnId: string }>;
  interruptTurn(threadId: string, turnId: string): Promise<void>;
  respondToApproval(threadId: string, requestId: string, decision: 'allow' | 'deny'): Promise<void>;
  listThreads(): Promise<Array<{ id: string; title: string }>>;
}

interface GitPluginAPI {
  getStatus(): Promise<{ branch: string; staged: string[]; unstaged: string[]; untracked: string[] }>;
  stage(paths: string[]): Promise<void>;
  commit(message: string): Promise<{ hash: string }>;
  diff(path?: string): Promise<string>;
}

interface ExplorerPluginAPI {
  listDirectory(path: string): Promise<Array<{ name: string; type: 'file' | 'directory'; size: number }>>;
  navigateTo(path: string): Promise<void>;
}

interface SearchPluginAPI {
  search(
    query: string,
    options?: { glob?: string; caseSensitive?: boolean }
  ): Promise<Array<{ path: string; line: number; text: string }>>;
}
```

### Plugin Permissions

Third-party plugins declare permissions in their `PluginDefinition`:

```typescript
type PluginPermission =
  | 'terminal:read'   | 'terminal:write'
  | 'fs:read'         | 'fs:write'
  | 'network'
  | 'ai:query'
  | 'git:read'        | 'git:write'
  | 'clipboard'
  | 'notifications'
  | 'system:read';
```

---

## 16. Plugin Event Bus

The in-process event bus (`eventBus`) enables decoupled communication between plugins without going through the server. Events are typed via `PluginEventPayloads`.

### Well-Known Event Names

```typescript
const PluginEvents = {
  // Terminal
  TERMINAL_SESSION_CREATED:  'terminal:session:created',
  TERMINAL_SESSION_DIED:     'terminal:session:died',
  TERMINAL_SESSION_ATTACHED: 'terminal:session:attached',
  TERMINAL_OUTPUT:           'terminal:output',

  // Editor
  FILE_OPENED:  'editor:file:opened',
  FILE_SAVED:   'editor:file:saved',
  FILE_CHANGED: 'editor:file:changed',
  FILE_CLOSED:  'editor:file:closed',

  // Git
  GIT_STATUS_CHANGED: 'git:status:changed',
  GIT_BRANCH_CHANGED: 'git:branch:changed',
  GIT_COMMIT:         'git:commit',

  // AI
  AI_TURN_STARTED:       'ai:turn:started',
  AI_TURN_COMPLETED:     'ai:turn:completed',
  AI_TURN_INTERRUPTED:   'ai:turn:interrupted',
  AI_APPROVAL_REQUESTED: 'ai:approval:requested',
  AI_ACTIVITY:           'ai:activity',

  // Navigation
  NAVIGATE_TO_FILE:     'nav:file',
  NAVIGATE_TO_TERMINAL: 'nav:terminal',
  NAVIGATE_TO_AI:       'nav:ai',

  // Plugin lifecycle
  PLUGIN_ACTIVATED:   'plugin:activated',
  PLUGIN_DEACTIVATED: 'plugin:deactivated',

  // Return-when-done
  RETURN_WHEN_DONE_REGISTERED: 'ui:return:registered',
  RETURN_WHEN_DONE_TRIGGERED:  'ui:return:triggered',

  // Editor cross-plugin events (Phase 4a)
  EDITOR_OPEN_FILE:   'editor.openFile',
  TERMINAL_OPEN_HERE: 'terminal.openHere',
}
```

### Event Payloads

```typescript
interface PluginEventPayloads {
  'terminal:session:created':  { sessionId: string; workingDir: string; name?: string };
  'terminal:session:died':     { sessionId: string; exitCode?: number };
  'terminal:session:attached': { sessionId: string };
  'terminal:output':           { sessionId: string; data: string; seq: number };

  'editor:file:opened':  { path: string; language: string };
  'editor:file:saved':   { path: string };
  'editor:file:changed': { path: string; dirty: boolean };
  'editor:file:closed':  { path: string };

  'git:status:changed': { branch: string; staged: number; unstaged: number; untracked: number };
  'git:branch:changed': { from: string; to: string };
  'git:commit':         { hash: string; message: string };

  'ai:turn:started':        { threadId: string; turnId: string; backend: string };
  'ai:turn:completed':      { threadId: string; turnId: string; backend: string };
  'ai:turn:interrupted':    { threadId: string; turnId: string };
  'ai:approval:requested':  { threadId: string; requestId: string; tool: string; description: string };
  'ai:activity':            { threadId: string; type: string; description: string };

  'nav:file':     { path: string; line?: number; column?: number };
  'nav:terminal': { sessionId?: string };
  'nav:ai':       { threadId?: string };

  'plugin:activated':   { pluginId: string; instanceId: string };
  'plugin:deactivated': { pluginId: string; instanceId: string };

  'ui:return:registered': { sourcePluginId: string; targetPluginId: string };
  'ui:return:triggered':  { sourcePluginId: string; targetPluginId: string };

  // Cross-plugin editor/terminal events (Phase 4a)
  'editor.openFile':  { sessionId: string; path: string; line?: number; column?: number };
  'terminal.openHere': { sessionId: string; cwd: string };
}
```

### Event Bus API

```typescript
// Subscribe to a typed event; returns unsubscribe function
eventBus.on(event: string, callback): () => void

// Emit a typed event
eventBus.emit(event: string, data: unknown): void

// Subscribe to ALL events (for debugging)
eventBus.onAny(callback: ({ event, data }) => void): () => void

// Get recent event history (last 100 events)
eventBus.getHistory(): Array<{ event: string; data: unknown; timestamp: number }>
```

---

## 17. Connection Store States

The connection store (`useConnectionStore`) tracks the full lifecycle of a connection:

| State | Description |
|-------|-------------|
| `idle` | Initial state, no connection attempted |
| `authenticating` | Fetching WS token from `/api/auth/ws-token` |
| `connecting` | WebSocket handshake in progress |
| `connected` | Fully connected and ready for RPC |
| `reconnecting` | Lost connection, retry in progress |
| `error` | Failed with an error message |
| `disconnected` | Intentionally disconnected |

### SavedConnection (persisted to AsyncStorage)

```typescript
interface SavedConnection {
  id: string;              // "conn_<timestamp>_<random>" — local identifier
  name: string;            // User-assigned label
  host: string;
  port: number;
  bearerToken: string;
  tls?: boolean;
  createdAt: number;       // Unix ms
  lastConnectedAt?: number; // Unix ms
  serverId?: string;       // Bound after first connect via server.getConfig.serverId.
                           // Used for dedup: two addresses with the same serverId
                           // refer to the same daemon (Phase 5 merge behavior).
}
```

`SavedConnection` is now the canonical shape in `@stavi/shared` (`packages/shared/src/transport-types.ts`), re-exported from `apps/mobile/src/stores/connection.ts`. The old `@stavi/shared` shape (`label`/`config`/`serverPublicKey`) was removed in Phase 5 — no server-side consumers existed.

**Dedup behavior (Phase 5):** On `addServer`, the mobile app pre-flights `server.getConfig` to learn the remote `serverId`. If an existing `SavedConnection` already has the same `serverId`:
- Same host+port → rejects with "already added".
- Different host+port (e.g., `192.168.1.5:8022` vs `macbook.local:8022`) → merges: updates address on the existing entry, preserves `lastConnectedAt`.

---

## 18. Error Handling

### RPC Request Errors

| Condition | Error |
|-----------|-------|
| Not connected | `Error("Not connected (state: <state>)")` |
| Timeout (30s default) | `Error("RPC timeout: <tag> (30000ms)")` |
| Connection closed mid-request | `Error("Connection closed")` |
| Server returns `Failure` exit | `Error(<JSON stringified error cause>)` |
| Client intentionally disconnects | `Error("Client disconnected")` (all pending) |

### Subscription Errors

- When a subscription receives a `Failure` Exit, `onError` is called with the error.
- The client then automatically re-sends the subscription with a new request ID if the WebSocket is still open.

### Auth Errors

- Non-`200` response from `/api/auth/ws-token` throws: `Error("Auth failed (<status>): <body>")`
- WebSocket closes before open: `Error("WebSocket closed before open (code: <code>)")`
- WebSocket fails to connect: `Error("WebSocket connection failed")`

### Relay Error Close Codes

| Code | Client action |
|------|--------------|
| `4000` | Do not reconnect (duplicate slot — programming error) |
| `4001` | Reconnect (peer disconnected and grace period expired) |

---

*Generated from source: `apps/mobile/src/stores/t3-client.ts`, `apps/mobile/src/stores/connection.ts`, `apps/mobile/src/plugins/core/terminal/index.tsx`, `apps/mobile/src/plugins/core/ai/useOrchestration.ts`, `apps/mobile/src/plugins/core/git/index.tsx`, `apps/mobile/src/plugins/core/editor/index.tsx`, `apps/mobile/src/plugins/extra/explorer/index.tsx`, `packages/protocol/src/index.ts`, `packages/shared/src/`, `apps/relay/src/index.ts`*