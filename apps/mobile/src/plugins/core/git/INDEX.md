# git plugin

Git status, staging, commits, history, branches — all via server RPC.

## Files

| File | Lines | What it owns |
|------|-------|--------------|
| `index.tsx` | 407 | Tabs (Changes/History/Branches), file rows, push/pull buttons |
| `hooks/useGit.ts` | 218 | All state, subscription, stage/unstage/discard/commit/checkout/push/pull |
| `components/CommitSheet.tsx` | 186 | Bottom-sheet commit modal with staged file preview |

## Data flow

```
server subscribeGitStatus
  → useGit (state)
    → index.tsx (renders tabs)
      → CommitSheet (modal)
```

## RPC calls

| Action | RPC |
|--------|-----|
| Subscribe | `subscribeGitStatus` |
| Stage | `git.stage` |
| Unstage | `git.unstage` |
| Discard | `git.discard` |
| Commit | `git.commit` |
| Checkout | `git.checkout` |
| Push | `git.push` |
| Pull (rebase) | `git.pull` |
| History | `git.log` |
| Branches | `git.branches` |
| Refresh | `git.refreshStatus` |

## Derived state from useGit

`stagedFiles` · `unstagedFiles` · `untrackedFiles` — all slices of `status.files`
