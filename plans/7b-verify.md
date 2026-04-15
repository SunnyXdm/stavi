Phase 7b verification

1. Token value spot-check
   - Read tokens.ts. Verify:
     - bg.base === '#08090a'
     - accent.primary === '#5e6ad2'
     - fg.secondary === '#d0d6e0'
     - semantic.error === '#cf2d56'
     - radii.card === 10
     - fontSize.base === 16

2. Visual regression — accent color
   - Open SessionsHome. Active session row accent → indigo, not teal.
   - Open Workspace. Active bottom tab → indigo underline/tint.
   - AI plugin: send button → indigo.
   - PASS: no mint teal visible anywhere.

3. Visual regression — background depth
   - SessionsHome: app background is near-black (#08090a).
   - Server section cards are slightly lighter.
   - Session rows slightly lighter than section background.
   - PASS: clear 3-layer depth progression, darker than before.

4. Font check
   - Open AI plugin. Body text renders in Inter (not IBM Plex Sans).
   - Open Terminal. Monospace text renders in JetBrains Mono (or Berkeley Mono if installed).

5. Hardcoded color grep
   - grep -rn "#[0-9a-fA-F]\{3,8\}" apps/mobile/src --include="*.tsx" --include="*.ts" \
       | grep -v node_modules | grep -v theme/ | grep -v provider-brands | grep -v Icons.tsx \
       | grep -v assets/ | grep -v __tests__
   - PASS: zero hits (or only justified exceptions with inline comments).

6. NativeTerminal theme sync
   - Open a terminal. Type `ls --color`.
   - PASS: ANSI colors match colors.terminal.* in tokens.ts (visually — exact hex verification via screenshot if needed).

7. Provider brand colors
   - Open model picker (ModelPopover).
   - Claude provider dot → purple (#7C3AED).
   - PASS: dots are visually distinct, not from theme accent.

8. tsc --noEmit → zero errors.
9. Metro bundle → no errors.
10. App launches and navigates through SessionsHome → Workspace → AI → Terminal → Home without crash.
