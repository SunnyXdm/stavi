# server-core

Bun WebSocket RPC server. Single dispatch loop → handler factories per domain.

## Files

| File | Lines | What it owns |
|------|-------|--------------|
| `server.ts` | 278 | Entry: creates context, wires handlers, HTTP health + WS auth, dispatch loop |
| `context.ts` | 450 | `ServerContext` — all shared state (Maps, subscriptions) + broadcast/emit functions + process/terminal factories |
| `types.ts` | 136 | Shared types: RpcRequest, TerminalSession, ManagedProcess, OrchestrationThread, etc. |
| `utils.ts` | 239 | Pure utilities: execFileAsync, getGitStatus, sendJson, makeChunk/Success/Failure, searchEntries |

## Handlers

Each exports `create*Handlers(ctx: ServerContext): Record<string, RpcHandler>`. Server spreads them all.

| File | Lines | RPCs |
|------|-------|------|
| `handlers/git.ts` | 198 | `git.*` + `subscribeGitStatus` |
| `handlers/terminal.ts` | 69 | `terminal.*` + `subscribeTerminalEvents` |
| `handlers/fs.ts` | 175 | `fs.*` + `projects.writeFile/searchEntries` |
| `handlers/system.ts` | 104 | `system.processes/ports/stats` |
| `handlers/process.ts` | 81 | `process.*` + `subscribeProcessEvents` |
| `handlers/server-config.ts` | 49 | `server.getConfig/getSettings/updateSettings/refreshProviders` |
| `handlers/orchestration/index.ts` | 103 | `orchestration.*` + `subscribeOrchestrationDomainEvents` + thread commands |
| `handlers/orchestration/turn-start.ts` | 251 | `handleTurnStart()` — full AI streaming loop |

## Pattern

```
server.ts
  createServerContext(options) → ctx
  createGitHandlers(ctx)
  createTerminalHandlers(ctx)
  ... (spread into handlers dict)
  WS message → handlers[tag](ws, id, payload)
```

## Adding a new RPC

1. Add handler to the relevant `handlers/*.ts` file
2. It's automatically registered — no changes to `server.ts`
