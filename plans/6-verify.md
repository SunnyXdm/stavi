Phase 6 verification

1. Start server with --relay wss://relay.example:8080.
2. Terminal prints a QR plus a copy/paste URL.
3. Mobile: Add Server → Pair via QR → scan.
4. Server section connects; tunnel icon visible.
5. Open a Session, send an AI message, verify the response streams.
6. Wireshark capture of the relay WebSocket shows only ciphertext (no plaintext JSON).
7. Kill mobile app. Restart. Resumes within 10 s (reconnect + re-handshake).
8. LAN mode (no --relay) still works — add a second server without QR, regular behavior.
