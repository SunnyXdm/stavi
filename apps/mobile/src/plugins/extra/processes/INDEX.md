# processes plugin

Spawn and monitor long-running shell processes on the server.

## Files

| File | Lines | What it owns |
|------|-------|--------------|
| `index.tsx` | 195 | Compositor: list view, uptime ticker, routing to detail/form |
| `hooks/useProcesses.ts` | 106 | All state + server subscription + spawn/kill/clearOutput/remove |
| `components/SpawnForm.tsx` | 137 | 3-field form (command, path, args) |
| `components/ProcessDetail.tsx` | 144 | Detail view: output scroll, kill confirm dialog |

## Data flow

```
server subscribeProcessEvents
  → useProcesses (state)
    → index.tsx (routing)
      → ProcessDetail | SpawnForm
```

## RPC calls

| Action | RPC |
|--------|-----|
| Subscribe | `subscribeProcessEvents` |
| Spawn | `process.spawn` |
| Kill | `process.kill` |
| Clear output | `process.clearOutput` |
| Remove | `process.remove` |

## Event types from server

`snapshot` · `started` · `output` · `exited` · `killed` · `outputCleared` · `removed`
