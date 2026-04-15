Phase 8a verification (target: 10 minutes)

Prereq:
- Server running: cd packages/server-core && bun src/server.ts
- Mobile app connected to server

1. Codex multi-turn
   - Create a new workspace (Codex runtime)
   - Open AI tab, send: "create a file called test.txt with the content 'hello'"
   - Wait for response + tool execution
   - Send: "now read test.txt and tell me what's in it"
   - PASS: response mentions "hello". FAIL: no response, hang, or error.

2. Codex rapid-fire
   - Send 3 messages in quick succession (don't wait for responses)
   - PASS: all 3 get responses (may queue). FAIL: hang after first.

3. Claude multi-turn
   - Create a new workspace (Claude runtime)
   - Send: "remember: my favorite color is indigo"
   - Send: "what is my favorite color?"
   - PASS: response mentions indigo. FAIL: no memory of first message.

4. Claude tool use
   - Send: "list the files in the current directory"
   - PASS: response shows file listing. FAIL: error or no tool execution.

5. Reconnect resilience
   - Kill the server mid-conversation. Restart.
   - Reconnect from mobile.
   - Send a new message.
   - PASS: new turn works. FAIL: stuck in 'running' state.
