# Phase 10 Remaining Roadmap

Written after Phase 10 steps 1–5 completed (security, error boundaries, AI bug fixes, plugin settings, theme system plumbing). This doc sequences every remaining item across plans 10, 11, and the theme migration debt incurred in step 5.

**Guiding principles:**
- **Finish things before starting new things.** No half-shipped features. Theme migration is the open loop from step 5 and goes first.
- **Dependencies drive order.** Skia terminal requires the server VT parser. Polish touches every component, so it goes after the theme sweep (avoid double-editing).
- **De-risk early.** Skia is the hardest thing left and has the most unknowns — tackle it before polish so schedule risk is visible.
- **Keep the diff reviewable.** Each phase is sized to land in one Sonnet session (~30–90 min of agent work, <1500 LoC diff).

---

## Phase Overview

| # | Phase | Blocks | Effort | Risk |
|---|-------|--------|--------|------|
| A1 | Theme migration sweep | Light-mode launch | 1–2 sessions | Low |
| A2 | Typed navigation + plugin consistency | Future refactors | 1 session | Low |
| A3 | `absoluteFillObject` bug fixes | Visual regressions | 15 min | Trivial |
| B  | Browser localhost proxy | User feature | 1 session | Medium |
| C1 | Server VT parser + dirty-row diffs | Skia terminal | 1 session | Medium |
| C2 | Skia terminal backend (iOS) | Terminal switcher | 2–3 sessions | **High** |
| C3 | Wire terminal backend switching | — | ½ session | Low |
| D  | Polish (haptics, pressables, keyboard) | — | 1 session | Low |
| E1 | AI resume cursor persistence | Server restart UX | 1 session | Medium |
| E2 | AskUserQuestion flow | AI feature parity | 1 session | Medium |

Total: ~10–13 Sonnet sessions.

**Deferred (not in this roadmap):**
- Native terminal backends (SwiftTerm/Termux) — deliberately skipped per user feedback
- `ExitPlanMode` / plan mode — nice-to-have, after AskUserQuestion
- TodoWrite interception — nice-to-have
- Rollback (undo turns) — nice-to-have
- NDJSON event tracing — debugging aid only

---

## Phase A1 — Theme Migration Sweep

**Goal:** Every component respects `useTheme()` so the Light/System toggle can be unhidden.

**Why now:** Phase 10 step 5 shipped the ThemeProvider but only migrated 5 files. The Light/System toggle is currently gated behind a dev flag (or should be). Either finish the migration or rip out the plumbing — the half state is the worst state.

### Scope — ~60 files in priority order

**P1 — First visible surface (must migrate):**
- `components/WorkspaceCard.tsx`
- `components/ServersSheet.tsx`
- `components/NewSessionFlow.tsx`
- `components/ReconnectToast.tsx`
- `components/PluginBottomBar.tsx`
- `components/SessionDrawer.tsx`
- `components/PluginRenderer.tsx`
- `components/ErrorBoundary.tsx`
- `navigation/WorkspaceScreen.tsx`
- `navigation/PairServerScreen.tsx`

**P2 — Core plugins:**
- `plugins/workspace/ai/` — panel, message list, input bar, approval UI, thread picker, runtime-mode selector (~8 files)
- `plugins/workspace/git/` — status, diff, log, branches (~5 files)
- `plugins/workspace/browser/` — URL bar, webview wrapper (~2 files)
- `plugins/workspace/editor/` and `plugins/workspace/terminal/` — these are WebView-hosted (see "WebView theming" below)

**P3 — Extra + shared plugins:**
- `plugins/shared/explorer/` (~3 files)
- `plugins/extra/processes|ports|monitor|system-search|tools/` (~8 files)

### Per-file migration steps

1. Imports: `import { colors, spacing, typography, radii } from '../theme'` → `import { useTheme } from '../theme'; import { spacing, typography, radii } from '../theme'` (only `colors` needs to be reactive; other tokens are theme-independent).
2. Inside the component: `const { colors } = useTheme();`
3. Static `StyleSheet.create({...})` at module scope → `const styles = useMemo(() => StyleSheet.create({...}), [colors]);` inside the component.
4. For files with sub-components sharing one styles object, pass `styles` down as a prop (the `SettingsRenderer` pattern from step 5).

### Subtleties

- **WebView-hosted plugins** (`terminal`, `editor`, the `browser` preview): the React Native wrapper respects `useTheme()` (header bar, borders), but the WebView content (xterm.js, CodeMirror, browsed page) runs its own rendering. For xterm.js and CodeMirror, inject a theme object via `postMessage` on mount and when theme changes. Add a `theme` effect that calls `webview.current?.injectJavaScript(setTheme(palette))`. For the browser plugin's preview, we can't style third-party pages — leave it alone.
- **Inline style objects** using `colors.x`: if they're inside the component body they work after migration. If they're at module scope, hoist them inside the component.
- **The three `colors.*` references inside `StyleSheet.absoluteFillObject` usages** — fix those in Phase A3, not here.

### Verification

- Manual: toggle between Dark → Light → System on a device with system theme set to Light. Every screen must switch palettes cleanly. No black text on cream background; no cream text on black.
- Typecheck: `npx tsc --noEmit -p apps/mobile/tsconfig.json`.
- After migration passes: unhide the Light and System options in the theme picker.

### Deliverable prompt sketch

> Read `plans/13-roadmap.md` Phase A1. Migrate every file in the P1 and P2 lists to `useTheme()` + `useMemo(StyleSheet.create, [colors])`. For WebView-hosted plugins (terminal, editor), inject the theme palette via postMessage. Skip P3 in this pass. Verify typecheck. Report a short list of any file you had to structure differently from the step-5 pattern.

---

## Phase A2 — Typed Navigation + Plugin Consistency

**Goal:** Eliminate `NativeStackNavigationProp<any>` and normalize plugin registration.

### Tasks

**A2.1 — Typed navigation**
- Create `apps/mobile/src/navigation/types.ts` exporting `RootStackParamList`:
  ```ts
  export type RootStackParamList = {
    SessionsHome: undefined;
    PairServer: undefined;
    Workspace: { sessionId: string };
    Settings: undefined;
  };
  ```
- Replace every `NativeStackNavigationProp<any>` with `NativeStackNavigationProp<RootStackParamList, 'ScreenName'>`.
- Same for `RouteProp<RootStackParamList, 'Workspace'>` etc.
- Update the root `NativeStackNavigator<RootStackParamList>()` call.

**A2.2 — Plugin registration consistency**
- The `tools` plugin self-registers via `usePluginRegistry.getState().register()` at module scope. Migrate it to the explicit `register(plugin, plugin.component)` call in `plugins/load.ts`, matching every other plugin.

**A2.3 — Dependency audit**
- Run `npx depcheck apps/mobile` (or equivalent). Remove truly unused packages. Keep anything that's lazy-loaded or platform-specific even if it flags — comment on why.

**A2.4 — Plugin manifest schema check**
- Read `packages/shared/src/plugin-types.ts`. Verify every registered plugin passes type-checking against `PluginDefinition`. Flag any fields that are optional in the type but effectively required at runtime (document, don't change).

### Verification

- Typecheck passes with no `any` in navigation calls (`grep -n "NavigationProp<any>" apps/mobile/src` should return nothing).
- App boots normally.

---

## Phase A3 — `absoluteFillObject` Fixes

**Goal:** Fix two pre-existing visual bugs from Phase 9.

### Scope

Grep for `StyleSheet.absoluteFillObject` in `apps/mobile/src`. There are two known instances (PluginBottomBar and SessionDrawer). Replace with `StyleSheet.absoluteFill`.

That's it. 15 minutes. Bundle with A2 in the same prompt if preferred.

---

## Phase B — Browser Localhost Proxy

**Goal:** User opens the Browser plugin, enters `localhost:3000`, and sees the dev server running on the **server's** machine — not the phone's.

### Design

Two modes depending on connection type:

**LAN mode** — direct HTTP proxy
- Server exposes `GET /proxy?url=<encoded>` on the existing Bun HTTP server.
- Authenticated via the existing bearer token (header or `?token=` param, same pattern as WS token issuance).
- Handler: validates `url` matches `^https?://(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(/.*)?$`, performs `fetch()`, streams body back with the upstream's `content-type` header.
- Mobile: URL bar detects `localhost:*` / `127.0.0.1:*` → rewrites to `http://<server>:<port>/proxy?url=<encoded>&token=<token>` → loads in WebView.
- **Limitation:** subresource requests from the loaded page (CSS, JS, XHR) don't get rewritten — they'll go to the phone's localhost and fail. To handle that, the proxy must rewrite HTML responses to replace `localhost:` / absolute-origin references. Real fix: **set `<base href="...proxy?url=...">`** and rewrite relative URLs only. Out of scope for v1; document the limitation.

**Relay mode** — tunneled HTTP over WS RPC
- New RPC tag `browser.proxy.request` with payload `{ url, method, headers, body? }` → streamed chunks `{ headers, status, bodyChunk }`.
- Mobile side uses a WebView with a custom URL scheme handler (`stavi-proxy://`) that routes through RN → WS → server → response.
- **Significant complexity.** Defer to a follow-up; v1 = LAN only, show a banner in relay mode: "Localhost proxy not yet supported in relay mode."

### Scope for this session

- LAN mode only.
- URL detection in Browser plugin URL bar.
- Banner in relay mode.
- Server proxy handler with URL allowlist + bearer auth.
- No HTML rewriting — user's first page load works, subresource failures are a known limitation.

### Verification

- Run `python3 -m http.server 8000` in any folder on the server machine.
- Open Browser plugin on phone, enter `localhost:8000` → directory listing appears.
- Try `localhost:8000/some-image.jpg` → image loads.
- Confirm allowlist rejects `localhost:8000/../../etc/passwd` and any non-localhost host.

---

## Phase C1 — Server VT Parser + Dirty-Row Diffs

**Goal:** Server maintains a headless terminal buffer per pty and emits compact cell diffs, so Skia and native terminal backends don't need to parse ANSI themselves.

### Design

- Add `xterm-headless` dependency to `packages/server-core`.
- Per `TerminalSession`, attach a `Terminal` instance from `xterm-headless`. Feed every pty data chunk into `term.write(bytes)`.
- After each write batch (debounced 16ms), compute dirty rows: compare the buffer's current state to the last-emitted snapshot. Emit a diff:
  ```ts
  type CellDiff = {
    row: number; // 0-indexed from top of visible viewport
    cells: Array<{ ch: string; fg?: number; bg?: number; flags?: number }>;
  };
  type TerminalFrame = {
    cols: number; rows: number;
    dirty: CellDiff[];
    cursor: { row: number; col: number; visible: boolean };
  };
  ```
- New subscription mode in `terminal.open`: `{ mode: 'raw' | 'cells' }`.
  - `raw` — existing behavior, stream bytes to WebView xterm.js (which parses itself).
  - `cells` — stream `TerminalFrame` chunks.
- `terminal.resize` updates both the pty and the headless Terminal's dimensions.

### Scope

- Handler changes in `packages/server-core/src/handlers/terminal.ts`.
- Shared types in `packages/shared/src/terminal.ts`.
- No mobile changes yet — Skia consumes this in Phase C2.

### Verification

- Open terminal in `raw` mode from mobile — works exactly as before.
- Unit test (or scratch script) that feeds `ls\n` into a headless terminal and verifies the emitted `CellDiff[]` matches the expected grid.

### Risks

- Diff computation must be fast — naive O(rows × cols) compare is fine for 80×24 but may need row hashing for 200×50 widescreens. Start naive; optimize if profiling shows it.
- Scrollback: xterm-headless maintains a buffer; need to decide whether to emit scrollback-changed events. v1: only emit visible viewport. Scrollback is client-side (the Skia component keeps its own history as it receives frames).

---

## Phase C2 — Skia Terminal Backend (iOS)

**Goal:** 60fps GPU-rendered terminal using `@shopify/react-native-skia`. iOS default; Android keeps xterm.js for now.

### The hard parts

1. **Font metrics** — monospace font, measure one cell (width × height) once at mount using `Skia.Font.getGlyphWidths`. Line height = font size × 1.2.
2. **Rendering** — `<Canvas>` with one `<Text>` or `<Glyphs>` per row. Recompute only dirty rows on each frame. Background rects per-cell for cells with a non-default bg color.
3. **Cursor** — separate animated `<Rect>` with opacity driver for blink.
4. **Input** — offscreen `<TextInput>` (opacity 0, pointerEvents auto). Focus on tap. `onChangeText` sends bytes to server; `onKeyPress` handles special keys (Enter → `\r`, Backspace → `\x7f`, arrows → escape sequences).
5. **Scroll** — `<GestureDetector>` with pan gesture. Scroll position is a `SharedValue<number>` that shifts the render origin. Scrollback buffer: client-side ring of ~2000 rows kept beyond the visible viewport.
6. **Selection** — long-press to enter selection mode, drag to extend, tap "Copy" action button. MVP can skip this and use the OS text selection via a fallback; document it.
7. **Paste** — handle via `Clipboard.getString()` on a paste button or long-press menu.

### Scope breakdown (multi-session)

**Session C2.1 — Rendering only (no input)**
- New component `SkiaTerminalView` that opens a terminal in `cells` mode, receives `TerminalFrame`s, renders static output.
- No input, no scroll, no selection. Cursor is rendered but doesn't blink.
- Deliverable: you can type in another device's terminal and see the output on the phone.

**Session C2.2 — Input + cursor**
- Offscreen `TextInput` piped to `terminal.write`.
- Cursor blink animation via Skia `SkiaAnimation`.
- Common special keys.

**Session C2.3 — Scroll + scrollback + paste**
- Pan gesture for scroll.
- Client-side scrollback ring buffer.
- Clipboard paste via a long-press action.

**Session C2.4 (optional) — Selection + copy**
- Can be deferred; many mobile terminals ship without it.

### Verification

- Side-by-side compare with WebView xterm.js: same output from `ls --color -la`.
- Profiling: Xcode Instruments — GPU frame time should stay <16ms during scrolling.

### Risk note

This is the single highest-risk phase. Budget generously. If Session C2.1 (rendering) doesn't produce something usable in one session, reassess whether Skia is the right investment vs. sticking with xterm.js on iOS too.

---

## Phase C3 — Wire Backend Switching

**Goal:** The `terminal.backend` plugin setting (already declared in Phase 10 step 4) actually switches between WebView and Skia.

### Scope

- `plugins/workspace/terminal/index.tsx`:
  ```tsx
  const backend = usePluginSetting<'webview' | 'skia' | 'native'>('terminal', 'backend');
  return backend === 'skia' && Platform.OS === 'ios'
    ? <SkiaTerminalView ... />
    : <XtermWebView ... />;
  ```
- Gate `'native'` behind a dev flag until native backends exist. Fall through to webview.
- Settings UI already exists — just verify the select shows the right options and the live switch works without a plugin reload (key the component on `backend` so it remounts cleanly).

---

## Phase D — Polish

**Goal:** The app feels indistinguishable from a native-first mobile IDE.

### Tasks

**D.1 — Haptics**
- Install `expo-haptics` (or `react-native-haptic-feedback` if we're non-Expo).
- `useHaptics()` hook → `.light()`, `.medium()`, `.selection()`.
- Fire on: session selection, plugin tab switch, button primary actions, approval accept/deny.

**D.2 — AnimatedPressable**
- New component wrapping `Pressable` with `Animated.Value` scale 1 → 0.97 on press-in, back on press-out. 80ms spring.
- Replace all `Pressable` usages on primary CTAs (add server, new workspace, send message, approve tool).

**D.3 — Keyboard handling**
- `KeyboardAvoidingView` wrapping AI chat input, NewSessionFlow inputs, server-add form, URL bar in browser plugin.
- Platform-aware: `behavior="padding"` iOS, `"height"` Android.
- `keyboardShouldPersistTaps="handled"` on all ScrollViews/FlatLists that contain TextInputs.

**D.4 — Loading states**
- Connection attempts show a spinner on the server tile.
- Session creation shows a progress state instead of freezing the button.
- Plugin-specific spinners (git status loading, AI thread loading) use a consistent `<Skeleton>` component (one simple shimmer).

**D.5 — Empty-state copy polish**
- Replace any "Loading..." or "No data" with specific, human copy.

### Verification

- Record a 30-second screen capture navigating through the app. Every button press should have haptic feedback. No janky transitions. Keyboard never covers the active input.

---

## Phase E1 — AI Resume Cursor Persistence

**Goal:** Server restart preserves the ability to continue AI conversations, not just view history.

### Design

- New migration `0003_thread_resume_cursor.sql`: `ALTER TABLE threads ADD COLUMN resume_cursor TEXT`.
- After every successful Claude turn (the `result` handler that sets `hasStarted = true`):
  ```ts
  const cursor = JSON.stringify({ sessionId: session.sessionId, lastAssistantUuid: resultMsg.uuid });
  await db.run('UPDATE threads SET resume_cursor = ? WHERE id = ?', [cursor, threadId]);
  ```
- On server boot, `createServerContext()` loads threads; thread objects now carry `resumeCursor` in memory.
- On `sendTurn`: if no in-memory `ClaudeSession` exists but the thread has a `resumeCursor`, reconstruct a lightweight session with `hasStarted = true` and `sessionId = cursor.sessionId`. The first call to `query()` will pass `resume: sessionId` and the SDK will rehydrate.
- Add a `rollback` path: if the SDK rejects the resume (session expired on Anthropic's side, rare), clear `resume_cursor` and start fresh.

**Codex equivalent:** Codex's session model is different — it uses a spawned subprocess and `providerThreadId`. v1: persist `providerThreadId` similarly. Actual resume behavior depends on what the Codex CLI supports; worst case we just track it without being able to use it, and document that Codex sessions don't survive server restart. (Check CLI docs in implementation.)

### Verification

- Start a Claude conversation, send a few turns.
- Kill the server (`Ctrl-C`), restart it.
- Send another turn in the same thread.
- Verify: the new turn's response references context from pre-restart turns.

---

## Phase E2 — AskUserQuestion Flow

**Goal:** When Claude's agent SDK invokes the `AskUserQuestion` tool, the phone shows a proper form, not a generic tool-approval dialog.

### Design

- `claude.ts` adapter: intercept `tool_use` events where `toolName === 'AskUserQuestion'`.
- Instead of routing through `approval-required`, emit a new event type `user-input-required` with the question schema (from the tool input).
- Server holds a `Deferred<UserInputResponse>` just like approvals.
- New RPC tag `orchestration.dispatchCommand` sub-type `thread.user-input.respond` carrying `{ requestId, answers }`.
- Mobile UI: new `UserInputPrompt` component replacing the approval UI for this specific tool. Renders the options (single / multi-select / text), Submit button → dispatch respond.
- Add to `AskUserQuestion` tool output: the answers the user chose, formatted for the model.

### Verification

- Ask Claude "what's my favorite color?" with system prompt that encourages it to clarify.
- Verify the tool invocation → UI renders the options → user taps → SDK continues with the answer.

---

## Sequencing Decision Points

Two ordering choices to make explicit:

**Q1: Do we migrate all P1+P2 theme files before unlocking light mode, or ship light mode incrementally?**
Recommendation: ship light mode only after P1+P2 is complete. Partial light mode is worse than no light mode. ~2 sessions of work.

**Q2: Do we ship Skia before or after the AI resume cursor?**
Skia is ~3 sessions of high-risk work. AI resume cursor is ~1 session of medium-risk work with high user value (nobody likes losing chat context on restart). Recommendation: **AI resume cursor first** (Phase E1 before C1/C2). It's the single biggest hidden gap vs. t3code and users will notice on the first restart.

### Revised ordering

1. **A1** theme migration sweep
2. **A2** typed navigation
3. **A3** absoluteFillObject fixes (bundle with A2)
4. **E1** AI resume cursor persistence *(promoted from later — highest hidden-gap user value)*
5. **B** browser localhost proxy *(high user value, independent)*
6. **C1** server VT parser
7. **C2** Skia terminal (multi-session)
8. **C3** wire backend switching
9. **D** polish pass
10. **E2** AskUserQuestion flow

---

## Go/no-go checkpoints

After each phase:
- Typecheck passes: `npx tsc --noEmit -p apps/mobile/tsconfig.json` and `-p packages/server-core/tsconfig.json`.
- App boots, home screen renders, at least one server connects, at least one plugin opens.
- Regression check: the phase-specific feature works end-to-end.

If any phase takes >1.5x its estimate, stop and reassess before starting the next one.
