Phase 7a verification

1. File size check
   - wc -l packages/server-core/src/context.ts → ≤300
   - wc -l apps/mobile/src/stores/stavi-client.ts → ≤400
   - wc -l packages/server-core/src/subscriptions.ts → exists, ≤200
   - wc -l apps/mobile/src/stores/rpc-engine.ts → exists, ≤300
   - tsc --noEmit → zero errors

2. SettingsScreen multi-server
   - Connect two servers. Open Settings.
   - PASS: both servers listed with status and disconnect buttons.
   - Disconnect server 1 from Settings. PASS: server 1 section shows "Disconnected".

3. Message write coalescing
   - Start a Claude turn that generates 20+ streaming tokens.
   - Check SQLite: SELECT COUNT(*) FROM messages WHERE thread_id = ?
   - PASS: message row count is small (1–3), not 20+. The final message text is complete.

4. Terminal error surface
   - Kill a running terminal's PTY process from the host.
   - PASS: terminal tab shows a red error banner with a Retry button.
   - Tap Retry. PASS: terminal reopens.

5. AI send error surface
   - Disconnect server mid-compose. Tap Send.
   - PASS: error banner appears above composer. Tap X to dismiss.

6. WorkspaceScreen loading
   - Navigate to a session. PASS: spinner visible during load, not blank screen.
