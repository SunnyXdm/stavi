Phase 0 verification (target: 5 minutes)

Prereq:
- Kill any running stavi server and any mobile app instance.

1. Health endpoint
   - Start the server: cd packages/server-core && bun src/server.ts
   - From the mobile app, view the server list and wait 5s.
   - PASS: each saved server shows "online" (green dot). FAIL: offline.

2. Claude multi-turn
   - Inside a workspace with a Claude AI tab, send: "remember my favorite color is teal"
   - Send: "what is my favorite color?"
   - PASS: response mentions teal. FAIL: model has no memory.

3. Instance thread bindings
   - Open AI tab, create a thread, send one message.
   - Kill the server. Restart the server.
   - Reconnect from mobile.
   - PASS: the AI panel shows an empty thread list (stale binding dropped), NOT a broken pointer to the old threadId. Confirm in Flipper/console: `getBoundThreadId` returns undefined.

4. Terminal subscription isolation
   - Open two terminal tabs in two different threads (tab A with threadId T1, tab B with T2).
   - In tab A run `echo hello-from-A`.
   - PASS: tab B's output area does NOT show "hello-from-A".

5. Terminal key collision
   - In a dev console, call `terminal.open({ terminalId: 'x' })` (no threadId).
   - PASS: server responds with Exit.Failure "threadId is required".

6. Directory rename
   - Run `grep -rn "plugins/core/" apps/mobile/src | grep -v node_modules`.
   - Run `grep -rn "plugins/extra/" apps/mobile/src | grep -v node_modules`.
   - PASS: both greps return zero matches.
   - Run `tsc --noEmit` from repo root.
   - PASS: zero errors.

7. Persistence migration
   - Before upgrade, ensure the test device has a persisted tab with pluginId="search".
   - Upgrade and relaunch.
   - PASS: tab's pluginId is rewritten to "workspace-search", the tab still opens.
