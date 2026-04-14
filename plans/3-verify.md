Phase 3 verification

1. No folder picker in plugins
   - Create Session A on /tmp/foo. Open AI tab.
   - PASS: AI panel shows a composer immediately, no DirectoryPicker modal.

2. First Thread lazy-create
   - Send "hi". Confirm server logs a thread.create with sessionId=<A>.
   - PASS.

3. Terminal default cwd
   - Open Terminal tab, run `pwd`.
   - PASS: prints /tmp/foo.

4. Home without disconnect
   - Drawer → Home. SessionsHome shows A in session list; WebSocket stays connected (status dot stays green).
   - PASS.

5. Per-Session tabs
   - Open Session A. Close the Editor tab.
   - Home, open Session B. PASS: Editor tab is present on B.
   - Home, reopen A. PASS: A's Editor tab is still closed.

6. Hardware back (Android)
   - In Workspace, press device back.
   - PASS: navigates to SessionsHome, does NOT exit the app.

7. Grep audit
   - grep -rn "DirectoryPicker" apps/mobile/src
   - PASS: only NewSessionFlow.tsx references it.

8. Deep-link to archived session
   - Manually archive Session A server-side. Navigate to Workspace?sessionId=<A>.
   - PASS: error screen with "Back to Home" button.
