Phase 1 verification

1. Empty DB on first boot
   - Delete ~/.stavi/userdata/stavi.db.
   - Start server. Confirm file is created and the _migrations table has one row (version=1).

2. session.create round-trip
   - Use a scratch ws client to send session.create { folder: '/tmp', title: 'demo' }.
   - PASS: response is a Session with non-empty id, serverId matches credentials.json, status='idle'.

3. Persistence
   - Kill the server. Restart it.
   - Send session.list {}.
   - PASS: previous session is returned.

4. Empty Threads list
   - session.get { sessionId: <id> } → { session, threads: [] }.
   - PASS: threads is []. No default Thread auto-created.

5. Create Thread via orchestration
   - Send orchestration.dispatchCommand { command: { type:'thread.create', sessionId: <id>, projectId, title, runtimeMode, interactionMode, branch, worktreePath } }.
   - Restart server.
   - session.get { sessionId: <id> } → threads has one entry.
   - PASS.

6. Cascade delete
   - session.delete { sessionId }. Restart server. thread-repo.getThread(oldId) → undefined.
   - PASS.

7. session.touch updates lastActiveAt
   - Record lastActiveAt. Wait 1s. session.touch. lastActiveAt increased.

8. Migration idempotency
   - Re-run the server twice. _migrations still has exactly one row for version=1.
