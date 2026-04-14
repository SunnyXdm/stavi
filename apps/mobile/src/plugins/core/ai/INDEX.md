# ai plugin (orchestration)

AI chat via Stavi's event-sourced orchestration system. Threads hold messages; turns drive streaming.

## Files

| File | Lines | What it owns |
|------|-------|--------------|
| `useOrchestration.ts` | 525 | Types, init/snapshot, subscription, event reducer (`processEventInner`) |
| `hooks/useOrchestrationActions.ts` | 160 | sendMessage, interruptTurn, respondToApproval, setActiveThread, updateSettings, refreshProviders |
| `utils/event-helpers.ts` | 106 | Pure mappers: server payload → AIMessage/AIPart |
| `utils/coalescer.ts` | 50 | RAF-batching setState utility for streaming events |
| `streaming.ts` | — | `applyMessageUpdate` — merges streaming message updates |
| `types.ts` | — | `AIMessage`, `AIPart` types |

## Data flow

```
server subscribeOrchestrationDomainEvents
  → processEvent (coalesced or immediate)
    → processEventInner (pure state reducer)
      → setState
```

Streaming events (`thread.message-sent` with `streaming:true`, `thread.activity-appended`) → coalesced via RAF.
All other events (thread lifecycle, approvals) → immediate setState.

## Key types

- `Thread` — runtime/interaction mode, model selection, worktreePath
- `Message` — legacy flat text (backward compat)
- `AIMessage` / `AIPart` — new structured parts model (text, reasoning, tool-call, tool-result)
- `ApprovalRequest` — pending tool approval from server

## RPC calls

| Action | RPC |
|--------|-----|
| Init config | `server.getConfig` |
| Init snapshot | `orchestration.getSnapshot` |
| Subscribe | `subscribeOrchestrationDomainEvents` |
| Create thread / send message / interrupt / approve | `orchestration.dispatchCommand` |
| Update settings | `server.updateSettings` |
| Refresh providers | `server.refreshProviders` |

## Known bugs (see plans/architecture-analysis.md)

1. `queryRuntime` not reset between turns → multi-turn conversations broken
2. CWD not passed to Claude adapter (always `'.'`)
3. `thread.created` event never broadcast from server
