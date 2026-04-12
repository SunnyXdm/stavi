# Architecture

System design for the Stavi mobile IDE.

## Overview

Stavi is four components: a **server** that wraps AI, terminal, git, and filesystem operations; a **CLI** that launches the server; a **mobile app** that renders the UI; and an optional **relay** for remote access.

```
┌─────────────────────────────────────────────────────────────┐
│                    Developer's Machine                       │
│                                                              │
│  ┌────────────┐     ┌────────────────────────────────────┐  │
│  │ Stavi CLI  │────▶│         Stavi Server               │  │
│  │ (npx stavi │     │                                    │  │
│  │  serve)    │     │  HTTP :3773      WebSocket /ws     │  │
│  │            │     │  ┌────────┐      ┌─────────────┐  │  │
│  │ starts     │     │  │ Auth   │      │ JSON RPC    │  │  │
│  │ server,    │     │  │ REST   │      │ ~25 methods │  │  │
│  │ issues     │     │  └────────┘      │ 3 streams   │  │  │
│  │ tokens     │     │                  └──────┬──────┘  │  │
│  └────────────┘     │  ┌──────────────────────┼───────┐ │  │
│                     │  │ Bun PTY │  Provider  │ Git   │ │  │
│                     │  │ (terms) │  Registry  │ Ops   │ │  │
│                     │  │         │  ┌───────┐ │       │ │  │
│                     │  │         │  │Claude │ │       │ │  │
│                     │  │         │  │Codex  │ │       │ │  │
│                     │  │         │  └───────┘ │       │ │  │
│                     │  └──────────────────────────────┘ │  │
│                     └────────────────────────────────────┘  │
└────────────────────────────┬────────────────────────────────┘
                             │ WebSocket (LAN or relay)
┌────────────────────────────▼────────────────────────────────┐
│                     Stavi Mobile App                         │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                    StaviClient                        │   │
│  │  Auth: bearer → wsToken → ws://host:3773/ws          │   │
│  │  RPC:  Request → Chunk*/Exit                         │   │
│  │  Reconnect: exponential backoff, auto-resubscribe    │   │
│  └─────────────────────┬────────────────────────────────┘   │
│                        │                                     │
│  ┌─────────────────────▼────────────────────────────────┐   │
│  │              Plugin System (Zustand)                   │   │
│  │  ┌──────┐ ┌──────┐ ┌────────┐ ┌─────┐ ┌──────────┐  │   │
│  │  │  AI  │ │Editor│ │Terminal │ │ Git │ │ Explorer │  │   │
│  │  └──┬───┘ └──┬───┘ └───┬────┘ └──┬──┘ └────┬─────┘  │   │
│  │     │        │         │         │          │         │   │
│  │  Orchestr.  files   NativeView  stage/     search    │   │
│  │  + Config   RPC     (Termux)    commit/    RPC       │   │
│  │  + Provider          + iOS      push/pull            │   │
│  │  Streaming           (planned)                        │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐   │
│  │         Rendering (opacity-swap, never unmount)       │   │
│  │  Active panel: opacity 1, pointerEvents auto          │   │
│  │  Hidden panels: opacity 0, pointerEvents none         │   │
│  └──────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

## Components

### Stavi Server (`packages/server-core/`)

The heart of Stavi. A standalone Bun WebSocket server that manages:

**Terminals** — Real PTY sessions via `Bun.spawn([shell], { terminal: { cols, rows } })`. Each terminal keyed as `${threadId}:${terminalId}`. Supports multiple concurrent sessions with independent PTY processes.

**AI Providers** — `ProviderRegistry` manages `ClaudeAdapter` (Anthropic Messages API) and `CodexAdapter` (Codex CLI subprocess). Both implement the `ProviderAdapter` interface and produce `AsyncGenerator<ProviderEvent>` for streaming responses.

**Git** — 11 git operations backed by `Bun.spawn(['git', ...])`: status, stage, unstage, commit, diff, diffFile, log, branches, checkout, push, pull, discard.

**Filesystem** — File read/write, directory listing, ripgrep-powered search.

**Settings** — User preferences stored atomically in `~/.stavi/userdata/settings.json` (API keys, default provider/model, Codex binary path).

#### Provider System Architecture

```
ProviderRegistry
├── ClaudeAdapter
│   ├── @anthropic-ai/sdk (Anthropic.messages.stream())
│   ├── Extended thinking support (thinking: { type: 'enabled', budget_tokens })
│   ├── Per-thread conversation history (Map<threadId, ClaudeSession>)
│   └── Abort via AbortController
│
├── CodexAdapter
│   ├── codex app-server subprocess (Bun.spawn)
│   ├── JSON-RPC 2.0 over stdin/stdout (newline-delimited)
│   ├── Handshake: initialize → initialized → model/list → thread/start
│   ├── Approval handling (item/commandExecution/requestApproval → respond)
│   └── Event buffer → AsyncGenerator pattern
│
└── Settings (~/. stavi/userdata/settings.json)
    ├── anthropicApiKey (env var ANTHROPIC_API_KEY takes precedence)
    ├── defaultProvider, defaultModel
    └── codexBinaryPath (fallback: which codex)
```

**ProviderAdapter interface:**
```typescript
interface ProviderAdapter {
  readonly provider: ProviderKind;       // 'claude' | 'codex'
  initialize(): Promise<boolean>;
  isReady(): boolean;
  getModels(): ModelInfo[];
  startSession(threadId: string, cwd: string): Promise<void>;
  sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent>;
  interruptTurn(threadId: string): Promise<void>;
  respondToApproval(threadId, requestId, decision): Promise<void>;
  stopSession(threadId: string): Promise<void>;
  stopAll(): Promise<void>;
}
```

**ProviderEvent types (streaming output):**
```
text-delta → text-done              (assistant response text)
thinking-delta → thinking-done      (extended thinking / reasoning)
tool-use-start → tool-use-delta → tool-use-done  (tool calls)
tool-result                         (tool execution results)
approval-required → approval-resolved
turn-start → turn-complete / turn-error
session-ready / session-error
```

**AI streaming data flow:**
```
User sends message
  → orchestration.dispatchCommand { type: 'thread.turn.start', ... }
  → server resolves provider from modelSelection
  → adapter.sendTurn() → AsyncGenerator<ProviderEvent>
  → for await (event of generator):
      text-delta      → broadcast thread.message-sent { streaming: true }
      thinking-delta  → broadcast thread.activity-appended { type: 'reasoning' }
      tool-use-start  → broadcast thread.activity-appended { type: 'tool-use' }
      tool-use-done   → broadcast thread.activity-appended { toolName, state: 'completed' }
      approval-req    → broadcast thread.approval-response-requested
      turn-complete   → broadcast thread.message-sent { streaming: false }
                      → broadcast thread.token-usage { inputTokens, outputTokens }
```

#### Server State

All state is **in-memory** (no database). Restarts clear everything:

| State | Structure | Lifetime |
|-------|-----------|----------|
| Terminal processes | `Map<string, BunProcess>` | Until closed or server stops |
| AI conversation history | `Map<threadId, ClaudeSession>` (Claude) | Until session stopped |
| Codex subprocess | Single long-lived `Bun.spawn` | Until adapter stopped |
| Thread messages | `Map<threadId, Message[]>` | Until server stops |
| AI messages (rich) | `Map<threadId, AIMessage[]>` | Until server stops |
| Activities | `Map<threadId, ThreadActivity[]>` | Until server stops |
| Pending approvals | `Map<threadId, ApprovalRequest[]>` | Until resolved |
| Git status cache | `lastGitStatus: string` | Polled every 4s |
| Provider registry | `ProviderRegistry` instance | Server lifetime |

### Stavi CLI (`apps/cli/`)

A thin Bun wrapper. Published to npm as `stavi`.

**Commands:**
- `stavi serve [--port n] [--host addr] [cwd]` — Starts the server, prints branded banner with address + token
- `stavi token` — Issues and prints a bearer token
- `stavi --help` — Usage info

**What it does under the hood:**
1. Imports `startStaviServer()` from `@stavi/server-core`
2. Resolves CWD, host, port (auto-scans for open port starting at 3773)
3. Creates `~/.stavi/` base directory
4. Starts the server directly (no subprocess)
5. Reads bearer token from `~/.stavi/userdata/credentials.json`
6. Prints a branded banner with connection details

### Stavi Mobile (`apps/mobile/`)

React Native 0.85.0 with New Architecture (Fabric + TurboModules) and Hermes.

#### Navigation Flow

```
ConnectScreen → [connect] → WorkspaceScreen
                                 │
                          PluginBottomBar
                          PluginRenderer (opacity-swap)
                                 │
                    ┌────┬───────┼───────┬─────┐
                    AI  Editor Terminal  Git  Explorer
```

- **ConnectScreen**: Lists saved connections, "Add Server" modal for manual host+port+token entry. In dev mode, shows "Connect to This Machine" button using auto-generated `dev-config.ts`.
- **WorkspaceScreen**: Plugin panels rendered via opacity-swap. Bottom bar for navigation.

#### Plugin System

All features are plugins. The registry is a Zustand store (`plugin-registry.ts`) with definitions and instances.

**Registration** (`plugins/load.ts`):
```
Core (4): ai, editor, terminal, git
Extra (5): explorer, search, processes, ports, monitor
```

**Rendering** — opacity-swap pattern:
- All mounted plugins stay in the DOM at all times
- Active plugin: `opacity: 1, pointerEvents: 'auto'`
- Inactive plugins: `opacity: 0, pointerEvents: 'none'`
- This preserves terminal state, WebView state, scroll positions

**Cross-plugin communication** — GPI (Global Plugin Interface):
- Proxy-based API gateway: `gPI.editor.openFile(path)`
- Looks up `definitions[pluginId].api()` and calls the method
- Type-safe via `GPIRegistry` interface from `@stavi/shared`

**Event bus** (`services/event-bus.ts`):
- Typed pub/sub with 22 event types
- Error isolation per handler
- 100-event history ring buffer
- Wildcard listener support

#### AI Plugin Architecture

The AI plugin is the most complex. It has several submodules:

```
plugins/core/ai/
├── index.tsx           — Plugin definition + AIPanel (FlashList chat UI)
├── types.ts            — AIPart model (TextPart, ReasoningPart, ToolPart, etc.)
├── useOrchestration.ts — React hook wrapping all orchestration RPCs
├── streaming.ts        — applyMessageUpdate(), message part accumulation
├── MessageBubble.tsx   — Per-message renderer (user vs assistant styling)
├── ApprovalCard.tsx    — Tool approval UI (accept/reject/always-allow)
├── Composer.tsx        — TextInput + model chip + mode toggle + access level
├── ConfigSheet.tsx     — Bottom sheet for provider/model/effort selection
├── ApiKeySetup.tsx     — API key entry modal for Claude
├── Markdown.tsx        — Markdown renderer for assistant messages
└── ToolCallCard.tsx    — Individual tool call display
```

**Message model:**
- `messages: Map<threadId, Message[]>` — Legacy flat text (for backward compat)
- `aiMessages: Map<threadId, AIMessage[]>` — Rich AIPart-based (new)
- Each `AIMessage` contains `parts: AIPart[]` where `AIPart` is a discriminated union:
  - `TextPart` — plain assistant text
  - `ReasoningPart` — extended thinking content
  - `ToolPart` — tool call with state, input, output
  - `ToolCallPart` / `ToolResultPart` — split tool call/result
  - `FileChangePart` — file modifications
  - `StepStartPart` / `StepFinishPart` — turn lifecycle markers

**Composer toolbar:**
- Model chip (opens ConfigSheet) — shows provider + model name
- Mode toggle: Chat / Plan
- Access chip: Supervised / Auto-accept / Full access (cycles on tap)
- Send/Stop button

**ConfigSheet:**
- Provider list from `server.getConfig` response (connected / needs API key / needs CLI)
- Model radio selection per provider with context window + thinking badge
- Effort selector: Low / Medium / High
- Thinking toggle (Claude models with `supportsThinking`)

#### StaviClient (`stores/stavi-client.ts`)

Lightweight RPC client that speaks Stavi's JSON RPC wire format.

**Connection lifecycle:**
```
disconnected → authenticating → connecting → connected
                                                 │
                                          (unexpected close)
                                                 │
                                          reconnecting ──→ (retry up to 7x)
```

**Auth flow:**
1. `POST /api/auth/ws-token` with `Authorization: Bearer <token>` → `{ token: wsToken, expiresAt }`
2. Connect `ws://<host>:<port>/ws?wsToken=<wsToken>`
3. Token refreshed 30s before expiry

**Message types:**
- Client → Server: `{ _tag: "Request", id, tag, payload }`
- Server → Client: `{ _tag: "Chunk", requestId, values }` (streaming)
- Server → Client: `{ _tag: "Exit", requestId, exit: { _tag: "Success"|"Failure", value?, cause? } }`

**Subscription auto-recovery:**
- All registered subscriptions are stored
- On reconnect: re-authenticate, then re-send all subscription requests with new IDs
- If a subscription stream exits (server-side), it's automatically re-sent

#### Connection Store (`stores/connection.ts`)

Zustand store wrapping `staviClient`:
- Syncs StaviClient state changes to Zustand for React reactivity
- Persists `savedConnections[]` to AsyncStorage
- Exposes `connect(savedConnection)`, `disconnect()`, `saveConnection()`, `removeSavedConnection()`

#### Native Terminal (Android)

Fabric-based native terminal using Termux TerminalView + TerminalEmulator.

**Component hierarchy:**
```
NativeTerminal.tsx (JS, Fabric codegen Commands)
    │
    ▼
NativeTerminalViewNativeComponent.ts (codegen spec)
    │
    ▼
NativeTerminalViewManager.kt (Fabric ViewManager)
    │
    ▼
NativeTerminalView.kt (Termux TerminalView wrapper)
    │
    ▼
TerminalView / TerminalSession / TerminalEmulator (Termux libs)
```

**Data flow:**
```
Server output:
  Stavi Server (PTY output) → subscribeTerminalEvents → StaviClient → terminal plugin
  → Commands.write(ref, data) → NativeTerminalView.writeOutput()
  → emulator.append(bytes) → terminalView.onScreenUpdated()

User input:
  Keyboard → onCodePoint/onKeyDown → emitInput(data)
  → Fabric event → onTerminalInput callback → terminal plugin
  → staviClient.request('terminal.write', { threadId, data })
```

#### iOS Terminal (Planned)

Currently uses `IOSTerminalFallback` — a `ScrollView` + `Text` that displays raw PTY output. No ANSI parsing. Plan is to integrate SwiftTerm native view to match Android's Termux-based approach.

#### Git Plugin

Three-tab layout with full mutation support:

**Tab: Changes**
- Staged section (green) — per-file unstage (−) button, bulk "Unstage all"
- Changed section (yellow) — per-file stage (+) and discard (undo) buttons, bulk "Stage all"
- Untracked section (gray) — per-file stage (+) button
- Commit bar appears when staged files exist → opens CommitSheet modal

**Tab: History**
- `git.log` → vertical commit list with dot timeline, hash, message, author, relative date

**Tab: Branches**
- Branch list with "Current" badge, tap-to-checkout

**CommitSheet modal:**
- Branch name display with main-branch warning
- Staged file list with status badges
- Commit message TextInput
- Commit button

**Header bar:** Pull (↓), Push (↑), Refresh buttons + branch name + ahead/behind indicators

### Stavi Relay (`apps/relay/`)

Bun WebSocket relay for remote access (when mobile isn't on the same LAN as the server).

**Design:**
- Zero-knowledge: forwards binary frames without parsing
- Room-based: server + mobile pair per room ID
- 60-second grace period on disconnect (allows reconnect)
- Health endpoint at `/health` with room count + uptime

**Connection URL:** `ws://<relay>:9022/room/<roomId>?role=server|mobile&token=xxx`

### Shared Packages

All three packages are **raw TypeScript** — no build step. Consumers import directly from `src/index.ts`.

**`@stavi/shared`** — Type definitions for:
- Plugin system (PluginDefinition, PluginPanelProps, PluginAPI, etc.)
- Plugin events (22 typed event constants + payload map)
- GPI cross-plugin APIs (TerminalPluginAPI, EditorPluginAPI, AIPluginAPI, GitPluginAPI, etc.)
- Transport types (ConnectionState, ConnectionConfig, RpcMessage, etc.)
- Domain types (TerminalSession, GitStatus, AIThread, AIMessage, ProcessInfo, etc.)

**`@stavi/protocol`** — RPC message constructors:
- `createRpcMessage(ns, action, payload)` → `{ v:1, id, ns, action, payload }`
- `createRpcResponse(request, ok, payload?, error?)` → response with same ID
- `isRpcResponse()`, `isSubscriptionMessage()` — type guards
- `NamespaceActions` — valid actions per namespace
- `Subscriptions` — streaming subscription names

**`@stavi/crypto`** — Noise NK encryption primitives:
- Types: `NoiseKeypair`, `NoiseSession`, `CryptoPrimitives`
- Frame format: 2-byte magic "ST" + version + type + nonce + payload
- Helpers: `buildFrame()`, `parseFrameHeader()`, `nonceFromCounter()`
- No platform implementation — apps provide their own `CryptoPrimitives` (react-native-quick-crypto for mobile)
- **Note:** The crypto system is not currently used in the active server — the server uses plain HTTP+WS with bearer tokens. This is infrastructure for future E2E encryption.

### Server-Core Package (`packages/server-core/`)

The server is also a shared package (consumed as raw TypeScript by the CLI):

**Public exports from `packages/server-core/src/index.ts`:**
```typescript
export { startStaviServer, StaviServerConfig } from './server';
export { ProviderKind, ProviderInfo, ModelInfo, ModelSelection, StaviSettings } from './providers/types';
```

**Dependencies:**
- `@anthropic-ai/sdk` ^0.39.0 — Claude Messages API streaming
- `ws` ^8.18.3 — WebSocket server

## Key Patterns

### Monorepo Dependency Graph

```
apps/cli ──────▶ @stavi/server-core ──▶ @anthropic-ai/sdk
                                       ──▶ ws

apps/relay ─────┐
apps/mobile ────┤──▶ @stavi/shared
                ├──▶ @stavi/protocol ──▶ @stavi/shared
                └──▶ @stavi/crypto
```

### React Version Pinning

React Native 0.85.0 bundles `react-native-renderer` built against React 19.2.3. Using any other React version causes a fatal crash. Two mechanisms enforce this:

1. **Root `package.json` resolutions:** `"react": "19.2.3"` — forces Yarn to install exactly this version everywhere
2. **Metro `resolveRequest` hook:** Intercepts all `react` and `react-native` imports and pins them to app-local `node_modules/` copies, preventing Metro from resolving to hoisted duplicates

### Plugin Panel Lifecycle

```
Register → (user taps tab) → Mount (lazy, first visit only) → Show/Hide (opacity)
```

- Panels are never unmounted after first mount (preserves state)
- Show = `opacity: 1, pointerEvents: 'auto'`
- Hide = `opacity: 0, pointerEvents: 'none'`
- Terminal sessions, WebView instances, and scroll positions all survive tab switches

### AI Provider Config Flow

```
1. Server reads ANTHROPIC_API_KEY from env OR ~/.stavi/userdata/settings.json
2. Server probes `which codex` for Codex CLI availability
3. server.getConfig returns providers array:
   [
     { provider: 'claude', installed: true, authenticated: !!apiKey, models: [...] },
     { provider: 'codex', installed: hasBinary, authenticated: codexAuth, models: [...] }
   ]
4. Mobile reads providers on connect → populates ConfigSheet model picker
5. No API key for Claude → show ApiKeySetup modal
6. Codex not installed → provider shown as "Install CLI" in ConfigSheet
7. User selects model → stored in component state
8. On send: modelSelection { provider, modelId, thinking, effort } passed in RPC
9. Server resolves adapter from modelSelection.provider → adapter.sendTurn()
```

### Settings Persistence

| Data | Storage | Path/Key |
|------|---------|----------|
| Bearer token | JSON file | `~/.stavi/userdata/credentials.json` |
| Server runtime (pid, port) | JSON file | `~/.stavi/userdata/server-runtime.json` |
| AI provider settings | JSON file | `~/.stavi/userdata/settings.json` |
| Saved connections (mobile) | AsyncStorage | `stavi-connection` |
| Plugin tab state (mobile) | AsyncStorage | `stavi-plugin-registry` |

All server-side file writes are **atomic** (write to `.tmp`, then `rename`).

### Internal Rules (Undocumented Conventions)

These patterns exist across the codebase but aren't formally documented elsewhere:

1. **Module-level state for plugin persistence** — Terminal refs, editor file state, and subscription unsubscribes live in module-level `Map` objects outside React to survive opacity-swap renders. This is intentional, not a hack.

2. **Dual message model** — Both `messages` (flat text) and `aiMessages` (AIPart-based) exist in parallel. The flat model is for backward compatibility; the AIPart model is the source of truth for rendering.

3. **Streaming accumulation** — `thread.message-sent` events with `streaming: true` carry the full accumulated text (not deltas). The client upserts by `messageId`. This means the server buffers the complete message and broadcasts it on each delta — simple but wasteful at scale.

4. **Git polling, not watching** — Git status is polled every 4 seconds while subscribers exist. No `fs.watch` or inotify. The poll is skipped if the JSON output hasn't changed since last check.

5. **Provider fallback chain** — If the user has no model selection, the server tries: `settings.defaultProvider` → first ready Claude adapter → first ready Codex adapter → placeholder echo response.

6. **Approval flow is provider-specific** — Claude (direct API) doesn't have tool approval gates, so `respondToApproval()` is a no-op. Codex uses JSON-RPC request/response pairs for approval. The mobile UI surfaces the same approval card regardless of provider.

7. **FlashList quirks** — `@shopify/flash-list` v2.3.1 removed `estimatedItemSize`. Refs must be typed as `any`, not `FlashList<T>` (value-not-type TS error).

8. **Bun terminal option** — The server uses `Bun.spawn([shell], { terminal: { cols, rows } })` for native PTY support. This is Bun-specific — Node.js requires `node-pty` for the same functionality.

9. **AsyncGenerator for streaming** — Both `ClaudeAdapter` and `CodexAdapter` use `async *sendTurn()` generators. The server iterates with `for await (const event of generator)` and broadcasts each event. This makes interruption clean — the generator's `return()` is called.

10. **Thread ≠ Terminal session** — A "thread" in orchestration is an AI conversation. A terminal session is separate. They share a `threadId` namespace but are independent concepts. An AI thread can have zero or many terminal sessions.
