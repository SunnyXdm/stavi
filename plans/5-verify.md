Phase 5 verification

1. Add two servers on different hosts. Both reach 'connected'.
2. Create Session A on server 1 and Session B on server 2.
3. SessionsHome shows both under their respective server headers.
4. Open A, navigate Home, open B, Home — both WebSockets remain connected.
5. Kill server 1. Server 1 section greys out. Server 2 section is unaffected.
6. Restart server 1. Section auto-reconnects within 5 s.
7. Try to add server 1 again under a different hostname.
   PASS: "already added" error; no duplicate server entry.
8. Cross-server leak audit:
   - In Session A, subscribe to its orchestration events.
   - Create a Thread in Session B.
   - PASS: Session A's subscriber receives ZERO events from B.
