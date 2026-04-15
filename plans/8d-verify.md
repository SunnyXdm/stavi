Phase 8d verification (target: 5 minutes)

Prereq:
- At least two servers saved with some workspaces each.
- App running and connected to at least one server.

1. Flat list
   - Open app with 2+ servers connected, each with workspaces
   - PASS: all workspaces appear in one flat list sorted by recency (most recent at top)
   - FAIL: grouped by server / sections visible

2. Workspace card anatomy
   - Inspect any card in the list
   - PASS: card shows title (large), folder path (secondary), server name + relative time (tertiary)
   - PASS: a status dot is visible left of the title
   - FAIL: missing any tier

3. Server management via Servers button
   - Tap "Servers" button in the header
   - PASS: sheet slides up showing all saved servers with status dots
   - PASS: can connect/disconnect from the sheet (tap Connect or Disconnect)
   - PASS: sheet has an "Add Server" button at the bottom

4. Search
   - Type a workspace name (or part of a folder path) in the search bar
   - PASS: list filters in real-time to matching workspaces
   - Clear the search bar
   - PASS: full list returns

5. Empty state — no workspaces
   - Use a fresh install or remove all sessions from all servers
   - PASS: shows "No workspaces yet. Create one to get started." with a "New Workspace" button
   - FAIL: blank screen or crash

6. Empty state — no servers
   - Forget all servers (via Servers sheet)
   - PASS: screen shows "Add a server to get started" with an "Add Server" button
   - FAIL: crash or wrong message

7. Offline workspaces
   - Disconnect one server (via Servers sheet or kill daemon)
   - PASS: that server's workspaces still appear in the flat list
   - PASS: those cards are visibly dimmed and show an "(offline)" badge
   - FAIL: workspaces disappear

8. Long-press action sheet
   - Long-press any workspace card
   - PASS: action sheet appears with Archive and Delete options
   - PASS: Cancel dismisses without action

9. Navigation
   - Tap a workspace card
   - PASS: navigates to WorkspaceScreen with correct sessionId

10. Pull-to-refresh
    - Pull down on the list
    - PASS: refresh indicator appears; sessions-store re-fetches from all connected servers

11. ReconnectToast
    - Kill a connected server, wait for disconnect, restart it
    - PASS: "Reconnected to <server>" toast appears briefly at the bottom of the screen

12. Header buttons
    - PASS: "Servers" button opens ServersSheet
    - PASS: folder+ icon (new workspace) opens NewSessionFlow
    - PASS: gear icon navigates to Settings

13. tsc --noEmit audit
    - cd apps/mobile && npx tsc --noEmit; echo "exit: $?"
    - PASS: exit 0
    - Run the same for packages/server-core, packages/shared, packages/crypto,
      packages/protocol, apps/cli, apps/relay
    - PASS: all exit 0

14. Zero hardcoded visual values
    - grep -n "['\"]#[0-9a-fA-F]" apps/mobile/src/components/WorkspaceCard.tsx \
        apps/mobile/src/components/ServersSheet.tsx \
        apps/mobile/src/navigation/SessionsHomeScreen.tsx
    - PASS: no output (zero matches)
