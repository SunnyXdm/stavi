# AI-Agent-Friendly Architecture Plan
_Written: 2026-04-13_

## The Core Problem

AI agents have context windows. Every file they read costs tokens. Every file over ~300 lines
means the agent either can't see the whole thing at once or burns its context budget on one file.
Every stringly-typed RPC call means the agent must grep across the whole codebase to understand
what parameters that call accepts.

**The rule we are optimizing for:**
Any AI agent working on any feature should be able to find, read, understand, and fix that feature
by reading at most 3 files, each under 300 lines.

---

## Current State: What's Wrong and Why

### File sizes (measured 2026-04-13)

| File | Lines | Problem |
|------|-------|---------|
| `packages/server-core/src/server.ts` | 1848 | All 55 RPC handlers + all in-memory state + all WebSocket logic in one file |
| `apps/mobile/src/plugins/core/ai/useOrchestration.ts` | 984 | Thread management + message state + tool calls + approvals + streaming — all mixed |
| `apps/mobile/src/plugins/core/git/index.tsx` | 884 | UI rendering + all git ops + git state + event subscription in one component |
| `apps/mobile/src/plugins/core/ai/index.tsx` | 839 | Chat UI + config sheets + setup flows + state wiring all mixed together |
| `apps/mobile/src/plugins/extra/processes/index.tsx` | 725 | All process management UI + spawn/kill logic |

### The RPC typing problem

```ts
// This is what every mobile RPC call looks like today:
const result = await staviClient.request<any>('git.checkout', { branch });
```

The string `'git.checkout'` is the only clue. The `<any>` cast is everywhere. An AI agent working
on git checkout must:
1. Grep the codebase for `'git.checkout'` to find the server handler
2. Read the server handler inside a 1848-line file
3. Grep for `'git.checkout'` in mobile to find the call site
4. Cross-reference manually to understand what payload the server expects

There are no types connecting the two sides.

### The discovery problem

To fix a git bug, an AI agent must already know to look in `server.ts` AND `core/git/index.tsx`.
Nothing in the folder structure tells you this. There is no way to navigate from "git feature"
to "these are all the files that implement it."

---

## Target State

### Hard file size limits

| File type | Max lines |
|-----------|-----------|
| Handler files (`handlers/*.ts`) | 300 |
| Hook files (`hooks/*.ts`) | 250 |
| Component files (`components/*.tsx`) | 200 |
| Type contract files (`types/*.ts`) | 150 |
| Index/wiring files (`index.ts/x`) | 100 |

These are enforced during the migration. If a file would exceed its limit, split it further.

### Target folder structure

```
packages/server-core/src/
  server.ts                     # Bootstrap only: WS, auth, dispatch loop (~80 lines)
  dispatch.ts                   # registerHandler() + dispatch() + HandlerContext (~60 lines)
  state.ts                      # In-memory state (threads, messages, processes maps) (~50 lines)
  handlers/
    terminal.ts                 # terminal.* RPCs (~200 lines)
    git.ts                      # git.* RPCs (~280 lines)
    orchestration.ts            # orchestration.* RPCs (~300 lines)
    process.ts                  # process.* RPCs (~200 lines)
    fs.ts                       # fs.* RPCs (~180 lines)
    system.ts                   # system.info, network, ports RPCs (~150 lines)
    search.ts                   # search.* RPCs (~100 lines)
  types/
    terminal.ts                 # TerminalResizeReq, TerminalSession, etc.
    git.ts                      # GitCheckoutReq, GitStatusPayload, etc.
    orchestration.ts            # Thread, Message, ToolCall, DispatchCommand, etc.
    process.ts                  # ManagedProcess, SpawnReq, etc.
    fs.ts                       # ReadFileReq, WriteFileReq, etc.
    system.ts                   # PortScanReq, SystemInfoResp, etc.
    search.ts                   # SearchReq, SearchResult
    index.ts                    # re-exports all of the above
  providers/
    (unchanged)

apps/mobile/src/plugins/
  load.ts                       # unchanged — static plugin registry is correct
  core/
    ai/
      index.tsx                 # thin: layout + compose hooks into UI (~100 lines)
      types.ts                  # unchanged
      streaming.ts              # unchanged
      hooks/
        useThreads.ts           # thread CRUD, active thread, subscription (~200 lines)
        useMessages.ts          # message list, streaming delta application (~220 lines)
        useToolCalls.ts         # tool call tracking, approval accept/reject (~200 lines)
        useModelConfig.ts       # provider/model selection, persistence (~150 lines)
      components/
        MessageBubble.tsx       # (exists, unchanged)
        ToolCallCard.tsx        # (exists, unchanged)
        ApprovalCard.tsx        # (exists, unchanged)
        Composer.tsx            # (exists, unchanged)
        Markdown.tsx            # (exists, unchanged)
        ModelPopover.tsx        # (exists, unchanged)
        ConfigSheet.tsx         # (exists, unchanged)
        ApiKeySetup.tsx         # (exists, unchanged)
        ProviderIcon.tsx        # (exists, unchanged)
    terminal/
      index.tsx                 # thin wrapper (~80 lines)
      hooks/
        useTerminal.ts          # session create/kill, I/O, history (~200 lines)
      components/
        TerminalView.tsx        # xterm webview rendering (~150 lines)
        TerminalToolbar.tsx     # (exists, unchanged)
    git/
      index.tsx                 # thin: compose sections (~80 lines)
      hooks/
        useGit.ts               # all git ops + state + event subscription (~280 lines)
      components/
        GitStatus.tsx           # staged/unstaged/untracked file lists (~150 lines)
        CommitPanel.tsx         # commit message input + action (~100 lines)
        BranchPanel.tsx         # branch list + checkout + create (~150 lines)
        DiffView.tsx            # diff display (~120 lines)
    editor/
      index.tsx                 # 368 lines — leave as-is unless actively working on it
    browser/
      index.tsx                 # small, leave as-is
  extra/
    processes/
      index.tsx                 # thin (~80 lines)
      hooks/
        useProcesses.ts         # spawn, kill, list, output polling (~200 lines)
      components/
        ProcessList.tsx         # list of running processes (~150 lines)
        ProcessCard.tsx         # single card: status, output tail, kill button (~120 lines)
        SpawnForm.tsx           # command + args + cwd input (~100 lines)
    monitor/                    # 328 lines — leave as-is (acceptable size)
    ports/                      # 256 lines — leave as-is
    search/                     # 255 lines — leave as-is
    explorer/                   # 267 lines — leave as-is
```

---

## Phase 1 — Split server.ts into handler files

**Scope:** `packages/server-core/src/` only. No Metro config changes. No mobile changes.
**Risk:** Low. Pure extraction — no logic changes.
**Impact:** Highest. Server is the single biggest offender (1848 lines).

### Step 1a — Create `state.ts`

Pull all in-memory state out of server.ts into a module so handlers can import it:

```ts
// state.ts
export const threads = new Map<string, Thread>();
export const messages = new Map<string, OrchestrationMessage[]>();
export const managedProcesses = new Map<string, ManagedProcess>();
```

### Step 1b — Create `dispatch.ts`

The handler registry replaces the giant switch-case:

```ts
// dispatch.ts
export interface HandlerContext {
  ws: WebSocket;
  workspaceRoot: string;
  sendJson: (ws: WebSocket, data: unknown) => void;
  broadcast: (data: unknown) => void;
  makeSuccess: (id: string, value: unknown) => RpcExit;
  makeFailure: (id: string, message: string) => RpcExit;
}

type Handler = (payload: Record<string, unknown>, ctx: HandlerContext) => Promise<unknown>;
const registry = new Map<string, Handler>();

export function registerHandler(tag: string, fn: Handler) {
  registry.set(tag, fn);
}

export async function dispatch(tag: string, payload: Record<string, unknown>, ctx: HandlerContext) {
  const handler = registry.get(tag);
  if (!handler) throw new Error(`Unknown RPC tag: ${tag}`);
  return handler(payload, ctx);
}
```

### Step 1c — Create each handler file

For each domain, extract all `case 'domain.*':` blocks from the switch-case. Pattern:

```ts
// handlers/git.ts
import { registerHandler } from '../dispatch';
import { threads } from '../state';   // if this handler needs shared state
import { execFileAsync } from '../utils';

export function registerGitHandlers() {
  registerHandler('git.status', async (payload, ctx) => {
    // exact logic from the case block, verbatim
  });

  registerHandler('git.checkout', async (payload, ctx) => {
    const branch = String(payload.branch ?? '');
    const create = payload.create as boolean | undefined;
    // ...
  });

  // all other git.* handlers
}
```

Handler files by domain:
- `handlers/terminal.ts` — terminal.create, terminal.resize, terminal.input, terminal.kill, terminal.list
- `handlers/git.ts` — git.status, git.stage, git.unstage, git.commit, git.diff, git.diffFile, git.log, git.branches, git.checkout, git.push, git.pull, git.discard, git.refreshStatus
- `handlers/orchestration.ts` — orchestration.getSnapshot, orchestration.dispatchCommand (the large one)
- `handlers/process.ts` — process.spawn, process.kill, process.list, process.getOutput
- `handlers/fs.ts` — fs.readFile, fs.writeFile, fs.readDir, fs.stat, fs.rename, fs.delete
- `handlers/system.ts` — system.info, network interfaces, port scanning
- `handlers/search.ts` — search.files, search.content

### Step 1d — Slim server.ts

After extraction, server.ts becomes:

```ts
// server.ts (~80 lines)
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';
import { dispatch, type HandlerContext } from './dispatch';
import { registerTerminalHandlers } from './handlers/terminal';
import { registerGitHandlers } from './handlers/git';
import { registerOrchestrationHandlers } from './handlers/orchestration';
import { registerProcessHandlers } from './handlers/process';
import { registerFsHandlers } from './handlers/fs';
import { registerSystemHandlers } from './handlers/system';
import { registerSearchHandlers } from './handlers/search';

// Register all handlers
registerTerminalHandlers();
registerGitHandlers();
registerOrchestrationHandlers();
registerProcessHandlers();
registerFsHandlers();
registerSystemHandlers();
registerSearchHandlers();

// WS setup, auth, and the message loop:
// on message: parse → dispatch(tag, payload, ctx) → sendJson result
```

### Phase 1 verification

```bash
bun run packages/server-core/src/server.ts
# Then manually:
# 1. Open terminal in app → send a command → see output
# 2. Git status loads in git plugin
# 3. AI query runs end to end
```

---

## Phase 2 — Typed RPC contracts

**Scope:** `packages/server-core/src/types/` (new) + mobile call sites updated.
**Risk:** Low. Types are additive. No runtime changes.
**Impact:** High for AI agents. They can read one types file to understand an entire domain's interface.

### Step 2a — Create types files

One file per domain. Example for git:

```ts
// packages/server-core/src/types/git.ts

// Requests
export interface GitCheckoutReq { branch: string; create?: boolean; }
export interface GitCommitReq { message: string; }
export interface GitStageReq { paths: string[]; }
export interface GitUnstageReq { paths: string[]; }
export interface GitDiffReq { path?: string; staged?: boolean; }
export interface GitDiffFileReq { path: string; staged?: boolean; }
export interface GitLogReq { limit?: number; }
export interface GitPushReq { force?: boolean; }
export interface GitPullReq { rebase?: boolean; }
export interface GitDiscardReq { paths: string[]; }

// Response shapes
export interface GitStatusEntry { path: string; status: string; }
export interface GitStatusPayload {
  branch: string;
  ahead: number;
  behind: number;
  staged: GitStatusEntry[];
  unstaged: GitStatusEntry[];
  untracked: string[];
}
export interface GitCommit { hash: string; message: string; author: string; date: string; }
export interface GitBranch { name: string; hash: string; upstream: string | null; current: boolean; }
```

All domains get the same treatment. Re-export everything from `types/index.ts`.

### Step 2b — Wire types into handlers

```ts
// handlers/git.ts
import type { GitCheckoutReq, GitCheckoutResp } from '../types/git';

registerHandler('git.checkout', async (payload, ctx) => {
  const { branch, create } = payload as GitCheckoutReq;
  // TypeScript now catches typos in field names
});
```

### Step 2c — Wire types into mobile call sites

The mobile `staviClient.request<T>(tag, payload)` already accepts a type parameter. Use it:

```ts
// Before:
const result = await staviClient.request<any>('git.checkout', { branch });

// After:
import type { GitCheckoutReq, GitCheckoutResp } from '../../../../../../../packages/server-core/src/types/git';
const result = await staviClient.request<GitCheckoutResp>(
  'git.checkout',
  { branch } satisfies GitCheckoutReq
);
```

The `satisfies` keyword catches wrong payload shapes at compile time. The `<GitCheckoutResp>` type
makes the result typed too.

**On import paths:** The relative path is long. If this becomes a problem, add an alias in
`metro.config.js` (e.g. `@stavi/types → ../../packages/server-core/src/types`) and update
`tsconfig.json` paths to match. Do this only if the verbosity is actually painful — it is not
a blocker.

### Phase 2 verification

```bash
npx tsc --noEmit   # in apps/mobile — should find zero new errors
# Grep for remaining <any> casts in RPC calls — should be minimal or zero
grep -r "request<any>" apps/mobile/src/plugins
```

---

## Phase 3 — Split large mobile plugin files

**Priority order (biggest impact first):**

### 3a — Split `core/ai/useOrchestration.ts` (984 lines)

This is the most important split. The file currently owns four distinct concerns.

**`hooks/useThreads.ts`** — thread CRUD and active thread selection
- `createThread`, `archiveThread`, `listThreads`
- `activeThreadId` state and setter
- Subscription to `thread.created`, `thread.updated`, `thread.archived` events
- ~200 lines

**`hooks/useMessages.ts`** — message state and streaming
- Message list per thread
- Streaming delta application via `applyMessageUpdate` from `streaming.ts`
- `sendMessage` (wraps `orchestration.dispatchCommand` with `thread.turn.start`)
- Subscription to `thread.message-sent`, `thread.message-updated` events
- ~220 lines

**`hooks/useToolCalls.ts`** — tool calls and approvals
- Tool call accumulation from `thread.activity-appended` events
- Approval accept / reject RPC calls
- `pendingApprovals` derived state
- ~200 lines

**`hooks/useModelConfig.ts`** — provider and model selection
- `modelSelection` state (provider, modelId, thinking, effort, etc.)
- Provider selection popover state
- Persistence (AsyncStorage or similar)
- ~150 lines

**`ai/index.tsx`** after split:
```tsx
export function AIPlugin() {
  const threads = useThreads();
  const messages = useMessages(threads.activeThreadId);
  const toolCalls = useToolCalls(threads.activeThreadId);
  const modelConfig = useModelConfig();
  return (
    <AILayout
      threads={threads}
      messages={messages}
      toolCalls={toolCalls}
      modelConfig={modelConfig}
    />
  );
}
```

### 3b — Split `core/git/index.tsx` (884 lines)

**`hooks/useGit.ts`** — all git operations and state
- All `staviClient.request('git.*')` calls as async functions
- Git status state + `git.status-changed` subscription
- Loading states per operation
- ~280 lines

**`components/GitStatus.tsx`** — staged/unstaged/untracked file lists
- Checkbox lists, stage/unstage actions
- ~150 lines

**`components/CommitPanel.tsx`** — commit message + button
- Controlled input, calls `useGit().commit(message)`
- ~100 lines

**`components/BranchPanel.tsx`** — branch list + checkout + create
- Branch list display, current branch indicator, checkout action, create branch flow
- ~150 lines

**`components/DiffView.tsx`** — diff display
- Unified diff renderer
- ~120 lines

**`git/index.tsx`** after split:
```tsx
export function GitPlugin() {
  const git = useGit();
  return (
    <View>
      <BranchPanel git={git} />
      <GitStatus git={git} />
      <CommitPanel git={git} />
    </View>
  );
}
```

### 3c — Split `extra/processes/index.tsx` (725 lines)

**`hooks/useProcesses.ts`** — spawn, kill, list, output
- All `staviClient.request('process.*')` calls
- Process list state + polling for output
- ~200 lines

**`components/ProcessList.tsx`** — list of running processes
- ~150 lines

**`components/ProcessCard.tsx`** — single process: status badge, output tail, kill button
- ~120 lines

**`components/SpawnForm.tsx`** — command + args + cwd input
- ~100 lines

### 3d — Slim `core/ai/index.tsx` (839 lines)

After 3a extracts the hooks, index.tsx should be mostly layout. Any remaining inline components
(e.g. anonymous styled views, inline list renderers) get moved to named files in `components/`.
Target: ≤ 100 lines.

### 3e — Split `core/terminal/index.tsx` (461 lines)

- `hooks/useTerminal.ts` — session create/resize/kill, I/O relay (~200 lines)
- `components/TerminalView.tsx` — xterm WebView rendering (~150 lines)
- `index.tsx` — thin wiring (~80 lines)

---

## What Not To Do

**1. Do not move files out of `apps/mobile/src/plugins/`**
Metro requires explicit watchFolders for any source outside apps/mobile. Moving plugin code out
adds build config complexity with zero functional gain. The current location is fine.

**2. Do not create a dynamic plugin loader**
Static imports in `load.ts` are explicit, type-safe, and work with Metro's static analysis.
Dynamic `require()` or `import()` inside Metro breaks tree shaking and is harder to type.

**3. Do not add a domain-level RPC client layer**
`staviClient.request('git.checkout', payload)` is already the right abstraction. Do not create
`gitClient.checkout(branch)` wrapper objects. The string tag + typed payload is readable and
discoverable. Another layer just adds indirection.

**4. Do not split files under 300 lines preemptively**
`monitor`, `ports`, `search`, `explorer` are 255–328 lines. They are fine as-is. Split a file
when you are actually working in it and it exceeds the budget, not before.

**5. Do not create cross-plugin hooks**
Each plugin's hooks are internal to that plugin. Cross-plugin calls go through the existing
plugin GPI system, not through imported hooks.

**6. Do not introduce a new state management library**
Zustand is in use and works. Do not add Redux, Jotai, Recoil, or anything else.

**7. Do not change the RPC protocol wire format**
The `{ _tag, id, tag, payload }` format works and both sides speak it. Do not redesign the
transport while also restructuring the files — that is two changes at once and will be hard to
debug.

---

## Verification Checklist

Run after each phase, not just at the end.

### After Phase 1 (server split)
- [ ] `bun run packages/server-core/src/server.ts` starts without errors
- [ ] `bun typecheck` (or `tsc --noEmit`) passes in server-core
- [ ] Manual: open terminal, run a command, see output
- [ ] Manual: git status loads in git plugin
- [ ] Manual: AI query runs end to end (Claude or Codex)
- [ ] Manual: spawn a managed process, see output, kill it
- [ ] No handler file in `handlers/` exceeds 300 lines

### After Phase 2 (typed RPCs)
- [ ] `npx tsc --noEmit` passes in apps/mobile
- [ ] `grep -r "request<any>" apps/mobile/src/plugins` returns empty or near-empty
- [ ] Types file exists for every domain in `packages/server-core/src/types/`
- [ ] All handler files use typed payload casts (not `payload.x as any`)

### After Phase 3 (mobile splits)
- [ ] No hook file exceeds 250 lines
- [ ] No component file exceeds 200 lines
- [ ] No index.tsx exceeds 100 lines
- [ ] AI plugin fully functional: threads, messages, streaming, tool calls, approvals
- [ ] Git plugin fully functional: status, stage, commit, branch, diff
- [ ] Processes plugin fully functional: spawn, kill, output
- [ ] Terminal fully functional: create session, send input, see output

---

## Execution Order

Do these in order. Each phase is independently verifiable.

```
Phase 1 → verify → Phase 2 → verify → Phase 3a → verify → 3b → verify → 3c → verify → 3d → 3e
```

Do not batch phases. Verify after each. If a smoke test fails, fix it before moving on.
The entire point is that at no point should the app be broken.
