# Phase 8c Verification Script
# Agent Per-Chat — target: 10 minutes

## Prerequisites

- Server running: `cd packages/server-core && bun src/server.ts`
- Mobile app connected to server
- At least one provider installed and authenticated (Claude or Codex)

---

## 1. Migration runs on a fresh DB

```bash
# Delete the DB to simulate fresh install
rm -f ~/.stavi/userdata/stavi.db

# Start server — migration runner must apply 0001 then 0002
cd packages/server-core && bun src/server.ts
```

PASS: server starts without error.

```bash
# Verify schema
sqlite3 ~/.stavi/userdata/stavi.db ".schema threads"
```

PASS: output contains `agent_runtime TEXT DEFAULT NULL`.

```bash
# Verify _migrations table has both versions
sqlite3 ~/.stavi/userdata/stavi.db "SELECT version FROM _migrations ORDER BY version"
```

PASS: prints `1` then `2`.

---

## 2. Migration is idempotent (second run is a no-op)

```bash
# Stop and restart the server a second time
# (migrations runner skips already-applied versions)
cd packages/server-core && bun src/server.ts
```

PASS: server starts. `_migrations` still has exactly 2 rows.

---

## 3. Migration on an existing DB (upgrade path)

```bash
# Create a DB that already has migration 0001 applied (no agent_runtime column)
rm -f ~/.stavi/userdata/stavi.db
sqlite3 ~/.stavi/userdata/stavi.db < packages/server-core/src/db/migrations/0001_initial.sql
sqlite3 ~/.stavi/userdata/stavi.db "INSERT INTO _migrations VALUES (1, $(date +%s%3N))"

# Now start server — should apply 0002 only
cd packages/server-core && bun src/server.ts
```

PASS: server starts. `_migrations` has 2 rows. `threads` schema includes `agent_runtime`.

---

## 4. New workspace flow — no agent picker

- Open the mobile app
- Tap + to create a new workspace
- Navigate through: server → folder → title

PASS: Step 3 shows only the title input and a note about per-chat provider selection. No agent/provider chips.
PASS: Workspace is created. `session.agent_runtime = 'claude'` (server default).

```bash
sqlite3 ~/.stavi/userdata/stavi.db "SELECT id, title, agent_runtime FROM sessions ORDER BY created_at DESC LIMIT 1"
```

PASS: `agent_runtime` column shows `claude`.

---

## 5. Per-chat provider selection

- Open a workspace, open AI tab
- The composer shows a provider/model chip (e.g. "Claude · Sonnet")
- If two providers are installed+authenticated: tapping the chip shows the provider list
- Select Codex, then select a model
- Send: "say codex"
- PASS: Codex responds

```bash
# Check the thread's agent_runtime in the DB
sqlite3 ~/.stavi/userdata/stavi.db "SELECT id, title, agent_runtime FROM threads ORDER BY created_at DESC LIMIT 1"
```

PASS: `agent_runtime` column shows `codex`.

Check server logs for: `[Provider] Using adapter: codex`

---

## 6. Two chats, different providers

- In the same workspace, start a new chat (via the AI panel header or drawer)
- Switch provider to Claude in the composer
- Send: "say claude"
- PASS: Claude responds

- Switch back to the first chat (Codex)
- Send another message
- PASS: Codex still responds (thread retains its agentRuntime)

Server logs should show alternating `codex` and `claude` adapter usage.

---

## 7. Provider selector hidden with single provider

- Ensure only one provider is installed+authenticated on the server
- Open AI composer

PASS: The provider chip is visible (shows the provider name) but tapping it goes directly to the models list — no provider list shown.
PASS: No error or empty popover.

---

## 8. Backward compatibility — existing workspace with agentRuntime='codex'

```bash
# Manually set an existing workspace's agent_runtime to 'codex'
sqlite3 ~/.stavi/userdata/stavi.db "UPDATE sessions SET agent_runtime='codex' WHERE id='<your-session-id>'"
```

- Open that workspace in the mobile app
- Open AI tab WITHOUT touching the provider selector
- Send a message
- PASS: Server uses Codex (workspace-level fallback). Server log shows `codex` adapter.

```bash
# Verify the new thread has NULL agent_runtime (inherited at turn time)
sqlite3 ~/.stavi/userdata/stavi.db "SELECT id, agent_runtime FROM threads ORDER BY created_at DESC LIMIT 1"
```

PASS: `agent_runtime` is empty/NULL for the new thread.
PASS: Turn was still handled by the Codex adapter (session fallback worked).

---

## 9. TypeScript check

```bash
cd packages/server-core && npx tsc --noEmit; echo "exit: $?"
cd packages/shared && npx tsc --noEmit; echo "exit: $?"
cd apps/mobile && npx tsc --noEmit; echo "exit: $?"
```

PASS: all exit codes are 0.
