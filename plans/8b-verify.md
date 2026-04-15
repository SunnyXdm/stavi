Phase 8b verification (target: 5 minutes)

1. Grep audit
   - rg -i "session" apps/mobile/src/ --type tsx | grep -v import | grep -v route | grep -v store | grep -v sessionId
   - PASS: No user-visible strings say "session". FAIL: missed strings.

2. Grep audit (threads)
   - rg -i "thread" apps/mobile/src/ --type tsx | grep -v import | grep -v threadId | grep -v activeThread
   - PASS: No user-visible strings say "thread". FAIL: missed strings.

3. Visual check
   - Open app, navigate to home screen
   - PASS: header/cards say "Workspaces", not "Sessions"
   - Open a workspace, open AI tab
   - PASS: any thread-related UI says "Chat"

4. Type check: tsc --noEmit passes
