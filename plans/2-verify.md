Phase 2 verification

1. Cold start to SessionsHome
   - Launch app. PASS: SessionsHome is the first screen. ConnectScreen is not shown.

2. Add two servers
   - Tap "+" → Add Server → enter two sets of credentials (different hosts).
   - PASS: two server sections visible, both connecting then connected.

3. Create a Session
   - Tap "+", pick server 1, pick /tmp, title "demo", agent Claude, confirm.
   - PASS: WorkspaceScreen opens with sessionId.
   - Kill app, relaunch. PASS: session is still listed in SessionsHome.

4. Tools sheet from SessionsHome
   - Tap 🧰 on server 1's header.
   - PASS: ServerToolsSheet opens. Processes tab shows real data.

5. Tools sheet from Workspace
   - Open a session on server 1. Tap Tools in the bottom bar.
   - PASS: Same ServerToolsSheet, Processes already populated (no refetch).

6. Single subscription
   - Enable debug logs for WebSocket.
   - Open both Tools sheets (server 1 from home + workspace of server 1).
   - PASS: server log shows exactly one active subscribeProcessEvents subscription.
   - Close both. PASS: subscription torn down.

7. Plugin scope enforcement
   - Try tcl-calling `usePluginRegistry.getState().openTab('processes')`.
   - PASS: logs a rejection; no tab created.

8. Empty state
   - Forget all servers. PASS: empty state "Add your first server".
