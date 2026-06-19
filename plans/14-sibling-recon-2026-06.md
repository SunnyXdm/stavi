# Sibling Repo Recon — June 11, 2026

Survey of the four reference repos (all updated since stavi's last commit on 2026-04-28),
plus a fresh audit of stavi's own "Known Bugs" list. Six parallel explorers; findings
verified against actual diffs/code, file:line refs included.

## TL;DR

1. **Stavi's April bug list was stale**: 12 of 15 "known bugs" are already fixed in current
   code (including resume-cursor persistence — roadmap item E1 is DONE despite 13-roadmap.md
   listing it as pending). The 3 remaining stale-client/reconnect bugs were fixed 2026-06-11.
2. **Highest-value ports** (in order): litter's stale-approval handling, t3code's
   richer turn states (`completed/failed/interrupted/cancelled`), t3code's session idle
   reaper, muxy's reconnect backoff-with-jitter + terminal write batching, litter's
   event-boundary preservation.

---

## t3code (last commit 2026-06-10) — upstream of our server code

- **Turn lifecycle**: unexpected stream end emits `turn.aborted`; provider-reported errors
  emit `turn.completed` with `state=failed` + `errorMessage`. Four-way turn state
  (`completed/failed/interrupted/cancelled`) vs stavi's two-way (complete/error).
  `packages/contracts/src/providerRuntime.ts:72-73,362-370,722-734`.
  → **PORT**: richer turn states; stavi already distinguishes error vs complete but not
  interrupted vs failed (plans/11 noted this too).
- **Resume persistence**: `ProviderSessionDirectory.upsert()` →
  `provider_session_runtime` table (threadId, providerName, providerInstanceId, adapterKey,
  status, resumeCursor, runtimePayload, lastSeenAt); rehydrated on boot by
  `ProviderInstanceRegistryHydration`. `apps/server/src/provider/Layers/ProviderSessionDirectory.ts:48-149`.
  → Stavi has the **cursor** half (thread-repo.ts); t3code also persists runtime payload +
  status and merges via `mergeRuntimePayload()`. Optional upgrade.
- **Session reaping**: `ProviderSessionReaper.ts:16-138` — sweep every 5 min, stop sessions
  idle ≥30 min, skip any with an `activeTurnId`. → **PORT** (stavi only stops on
  disconnect/shutdown; a wedged client leaks sessions until then).
- **Turn/session-status coupling**: `settledTurnStateForSessionStatus()`
  (orchestration/projector.ts:35-62) prevents session exit from masking a completed turn.
- **Hardening**: every endpoint authed; per-RPC scope map (`RPC_REQUIRED_SCOPE`, ws.ts);
  30-day session TTL / 5-min ws-token TTL with revocation tracking (auth/SessionStore.ts).
  → Stavi's equivalents exist but are simpler; scope-per-RPC is a nice middle step.
- **Recent commits worth reading before any server sync**: 57f6bf7e (turn fold projection
  fix), ae7e88b0 (codex app-server protocol sync + service tiers + provider startup),
  0baf1986 (git-status polling churn).

## litter (last commit 2026-05-30) — hard-won mobile streaming correctness

- **Stale approval responses** (`56dab4d`): 3 layers — (1) UI tracks `submittingRequestId`,
  disables buttons in flight, shows transport-aware error text; (2) helper distinguishes
  transport-disconnect errors (prompt retry) from real errors; (3) backend clears pending
  mutation **only if the local_request_id matches** so a stale failure can't clobber a newer
  request. `rust-bridge/.../store/reducer.rs:1394-1405`, `ApprovalOverlay.kt:66-90`.
  → **PORT (HIGH)**: stavi's approval flow has no in-flight tracking; a reconnect mid-approval
  can double-submit or strand the overlay.
- **Event-boundary preservation** (`700a2ec`): when coalescing item updates, NEVER merge
  across tool-lifecycle boundaries (status/exit_code/progress/agent-state changes force a
  separate event); plain text deltas still coalesce. `app_store.rs:867-912`.
  → **PORT (MEDIUM)**: relevant if/when stavi batches events in event-reducer.ts.
- **Model-picker resilience** (`abee3ac`): collect-and-continue across runtimes; failed
  runtime's models backfilled from cache, deduped by (runtime, modelId). `ffi/client.rs:1031-1107`.
  → **PORT (MEDIUM)**: don't fail the whole picker because one provider is down.
- **Realtime resume design**: `realtime_resume_session.md` — resume tool takes optional
  thread_id, handoff router reuses existing session.

## muxy mobile (last commit 2026-06-11) — closest architecture

- **Reconnect stack**: `AppStateBinder` (disconnect on background, reconnect on active with
  grace delay) + `BackoffScheduler` (exp backoff base 500ms cap 30s ±30% jitter, reset on
  success). `src/transport/AppStateBinder.ts`, `src/transport/reconnect.ts`.
  → **PORT (HIGH)**: stavi's relay reconnect is timer-based; jittered backoff is strictly better.
- **Terminal write batching**: xterm.js writes queued and flushed per requestAnimationFrame
  (`TerminalWebView.tsx:54-91`). → **PORT (HIGH, cheap)**: stavi's WebView terminal writes
  per-message today.
- **Terminal explosion fix (#54)**: debounce takeover ~80ms until size stabilizes
  (`pendingTakeoverSize`), min dims 20x4, snapshot-vs-incremental feed paths, buffer output
  during takeover and replay after snapshot (`SNAPSHOT_WAIT_MS=1500`).
  → Reference for stavi's terminal backend work (plans C1-C3).
- **Mouse-reporting scroll (#52)**: when TUI enables mouse mode, install pan recognizer and
  synthesize wheel events (buttons 4/5) quantized per row. iOS-native but the approach maps
  to xterm.js too.
- **Theme sync (#53)**: server broadcasts theme event (fg/bg/palette), client caches last
  theme persistently, derives dark/light via luminance. → matches stavi's server-is-brain
  model; candidate for theme phase.
- **Protocol**: request/response with correlation IDs + 15s timeout + typed error codes
  (401/408), separate event broadcast channel; demo/mock backend for testing.
- **SSH (#55)**: Citadel (NIO async Swift), TOFU host keys in keychain, creds in keychain.
  Relevant to stavi-vision's SSH differentiator.

## lunel (last commit 2026-05-14) — mostly i18n, one gem

- **"dope reconnect" (`6c3eb1f`, May 7)**: plugins register optional
  `onReconnectRefreshSession(id)` / `onReconnectRefreshAll()` hooks; on reconnect the
  workspace fans out — terminal resizes PTY, AI clears transient state and refetches
  messages + per-session busy/idle status (`getStatuses()` API) to reconcile streaming UI.
  → **PORT (HIGH)**: stavi has `onReconnect` listeners in connection.ts but no per-plugin
  refresh contract. This is the systematic version of the stale-client fixes applied today.
- Everything else since April is i18n (14+ languages) + an InfoSheet gesture fix (PR #29:
  GestureDetector only on the drag handle, not the whole sheet).
- Skia terminal unchanged: spans grouped by color/attr per row, 24fps cap, JetBrains Mono.

---

## What was done today (2026-06-11)

- Fixed the 3 verified stale-client/reconnect bugs with reactive Zustand selectors:
  `useOrchestration.ts` (client), `git/hooks/useGit.ts` (connectionState + client + effect
  deps), `explorer/index.tsx` (client).
- Added `typecheck` script to apps/mobile (tsc --noEmit passes clean; server-core also clean).
- Rewrote CLAUDE.md "Known Bugs" to current reality (12/15 were already fixed; roadmap E1
  resume-cursor persistence is already implemented — 13-roadmap.md is stale on this).
- Removed graphify integration (hooks, settings, CLAUDE.md section, graphify-out/).

### UI session (verified live on emulator, API 35)

- **AnimatedPressable structural fix**: caller `style` sat on an outer Animated.View while
  children rendered inside an unstyled inner Pressable — row/align/padding layout never
  reached the children. Cards collapsed to icon-width with dead tap areas. Now uses
  `Animated.createAnimatedComponent(Pressable)` so style + children share one node.
  This affected EVERY AnimatedPressable call site.
- **Horizontal ScrollView flexGrow bug, twice**: RN ScrollView defaults to `flexGrow: 1`;
  the home connections rail and DirectoryPicker breadcrumb both stretched to swallow all
  free vertical space (giant server card / dead zone above the folder list). Fixed with
  `style={{flexGrow: 0}}`. Grep for other horizontal ScrollViews before adding new ones.
- **Home redesign**: compact server cards (hostname sans `.local`, mono IP, live session
  count), dashed "Add server" tile — ServersSheet was otherwise UNREACHABLE once a first
  server existed; session cards (accent-tinted icon tile, title, mono path,
  `server · time` meta, green active pill).
- **Wired session archive/delete**: home long-press handlers were silent no-ops; now call
  `session.archive`/`session.delete` RPCs + refresh. Verified delete end-to-end.
- **NewSessionFlow/DirectoryPicker polish**: drag handle, hostname chips, `.`-title guard.
- **LogBox dev noise**: codegen NativeTerminalView warning + StaviClient transient WS
  errors were popping toasts directly over bottom-sheet action buttons; now ignored in
  index.js (the client-side console.error → console.warn cleanup is a better long-term fix).

## Session 2 (2026-06-11 evening): models + multi-server fixes

User-reported: "codex doesn't have 5.5", "claude doesn't show latest", "older connected
servers are gone". All three root-caused, fixed, and verified live on the emulator.

### Model discovery (t3code parity)
- **Claude** (`providers/claude.ts`): replaced the stale 3-model catalog with t3code's
  current 7-model BUILT_IN_MODELS (Fable 5, Opus 4.8/4.7/4.6/4.5, Sonnet 4.6 default,
  Haiku 4.5), gated by a `claude --version` probe at adapter init (min versions: fable-5
  ≥2.1.169, opus-4-8 ≥2.1.154, opus-4-7 ≥2.1.111 — t3code's exact thresholds; unknown
  version → full list so the picker is never empty). Ported `normalizeClaudeCliEffort`
  (ultrathink → prompt-injected, ultracode/xhigh → max under SDK 0.2.104, sonnet max →
  high). NOTE: t3code never queries the SDK for models; the agent-sdk's
  `supportedModels()` exists but t3code uses version-gated static catalogs — we mirror that.
- **Codex** (`providers/codex.ts`): discovery was a SILENT NO-OP — codex-cli ≥0.13x returns
  `{data, nextCursor}` but the code checked `Array.isArray(result)`, and even when it
  worked it INTERSECTED discovered models with the stale static list, so new models could
  never appear. Now: paginated `model/list` is the source of truth (t3code parity), full
  capability mapping (supportedReasoningEfforts/defaultReasoningEffort/serviceTiers→fastMode,
  hidden filtered), boot-time background probe via a short-lived `codex app-server`
  handshake (previously models only refreshed when the first session spawned), and the
  static list (updated to gpt-5.5 era) is offline fallback only.
- Verified via `server.getConfig` RPC and in the composer picker: Claude shows all 7,
  Codex shows GPT-5.5 (default) / 5.4 / 5.4-Mini live from the binary.

### "Servers disappear" (two-layer bug, reproduced live)
1. `connection.ts addServer`: serverId comes from `~/.stavi/credentials.json`, which is
   SHARED by every server instance on a machine — two daemons on different ports report
   the same serverId, and the dedup-merge silently overwrote the older server's address.
   Fix: merge only on same serverId AND same port (the real "same daemon, new hostname"
   case); different port → separate entry.
2. `stavi-client.ts connect()`: a cached unexpired wsToken from a previous address was
   presented to the new server, which rejected the WS upgrade ("WebSocket connection
   failed"). Fix: clear wsToken on explicit connect().
- Home rail now shows `host:port` so same-machine servers are distinguishable.

### Server crash fix
- `server.ts` upgrade handler: a malformed WS upgrade made ws's `abortHandshake` throw
  under Bun (missing `http.STATUS_CODES`) and KILLED THE WHOLE SERVER (observed live).
  Wrapped in try/catch → socket.destroy().

### Root causes deliberately NOT changed (server-side follow-ups)
- **Shared `~/.stavi` baseDir is the deeper disease**: same serverId, same bearer token,
  and the SAME SQLite for every instance on a machine — sessions created on server A
  appear on server B (observed: terminal "Failed to open session" for a folder that only
  exists in A's workspace). Proper fix: per-instance baseDir (e.g.
  `~/.stavi/instances/<project-hash>/`) like t3code's per-instance identity. Touches
  pairing/relay, so deferred.
- t3code patterns still worth porting: 5-min model refresh timer + `server.refreshProviders`
  RPC, provider snapshot disk cache (last-known models at boot), `providerStatuses` push
  events instead of getConfig-only.

## Session 3 (2026-06-11 night): workspace UI — lunel parity + broken-plugin fixes

Recon: lunel workspace = Drawer navigator + ONE header per panel (safeTop+44, hamburger +
title + optional accessory) + 6-item bottom bar; AI sessions/new-chat live ONLY in the
drawer (search + pencil); panels keep mounted (absolute + opacity:0); SessionRegistry
context with in-place callback mutation to avoid drawer re-renders.

Fixed (all verified live on emulator):
- **Drawer "didn't open"**: SessionDrawer's closed-state edge-swipe strip (30dp, zIndex 10,
  FULL height) sat over the hamburger — RN hit-testing stops at the topmost view, so taps
  on the left half of the button died silently. Strip now starts below the header.
- **Double header on AI**: removed the panel's "AI Chat + New Chat" bar (drawer already has
  search + New Chat — lunel pattern). 44px returned to the conversation.
- **hideHeader TDZ bug**: WorkspaceScreen's selector read `sessionId` before its
  declaration — Hermes doesn't enforce TDZ so it silently evaluated undefined, meaning
  hideHeader could never work (and would crash on a TDZ-enforcing engine). Declaration moved.
- **Stale drawer content**: session-registry `unregister` was never called by anything;
  AI + terminal panels now unregister on unmount.
- **Terminal retry was a trap**: the ErrorView retry re-ran terminal.open but never
  re-subscribed to subscribeTerminalEvents → recovered terminal rendered but received no
  output. Retry now discards the errored session and goes through createSession.
- **gitApi GPI crash**: `result.branch` deref after optional-chained request (undefined
  when no client) — now throws 'No server connected' instead.
- **FileTree permanent-empty**: mounted-while-disconnected never retried; now reloads the
  root reactively when the connection reaches 'connected'.
- CLAUDE.md stale note about tools self-registration corrected (it was migrated).

Litter "drawable UI" = their **Pet overlay**: draggable + pinch-to-resize floating cat
sprite (WebP spritesheet) showing live agent status (idle/running/review-needed) with a
speech bubble; persisted position/scale; Android variant uses SYSTEM_ALERT_WINDOW
("Display over other apps") + a LifecycleService adding a ComposeView to WindowManager so
it floats over EVERY app. In-app version is straightforward in RN (root portal +
RNGH Gesture.Pan/Pinch/Tap + reanimated shared values + zustand persist); the
over-other-apps variant needs a native Android module + permission + foreground service.

Still open (workspace UI):
- Terminal: module-level refs/subscriptions shared across ALL panel instances; disconnect
  cleanup wipes other servers' subscriptions; `serverCwd` vestige never assigned;
  terminal.resize error against foreign-cwd threads ("null is not an object" toast).
- PluginHeader multi-instance tab strip + '+' button are dead code (openTab only reuses).
- 'Tabs' bottom item is a More-Tools launcher, not an open-tabs list; extra plugins have
  no close affordance once opened.
- Browser: proxy URL embeds bearerToken as query param (leak risk); browserApi.navigate
  is a stub; default page google.com instead of anything workspace-aware.
- GPI fallbacks (ai/git/terminal api.ts) still use savedConnections[0] — serverId should
  flow through GPI calls.
- useProcesses.ts is dead code with non-reactive reads — delete or fix.

## Session 4 (2026-06-11 late): "Claude Code doesn't work" — root cause + fix

Symptom: sending to Claude returned "Error: Claude Code native binary not found at
/Users/sunny/.local/bin/claude... options.pathToClaudeCodeExecutable".

Root cause: the SDK (0.2.104) emits that message for ANY spawn ENOENT — including when
the **cwd doesn't exist**. The session's folder (`apps`) didn't exist on the server the
session was bound to (cross-server session via shared ~/.stavi SQLite; sessionsById is
last-hydrate-wins, so the same session row flips binding between local servers). The
binary path was fine (symlink → versioned native binary, spawns correctly).

Adapter wiring matches t3code (they pass pathToClaudeCodeExecutable identically,
ClaudeAdapter.ts:3451). The parity gap is the DATA layer: t3code's per-instance identity
makes cross-server sessions impossible, so an invalid cwd can't reach the adapter.

Fixed: cwd existence guards in BOTH adapters (claude.ts sendTurn yields turnError
"Session folder does not exist on this server: <path>"; codex.ts startSession throws the
same) so users get the real reason. Verified live: Claude Sonnet 4.6 replied end-to-end
in the app on the correct server ("say hi in exactly three words" → "Hi there, friend!").

This strengthens the case for the per-instance baseDir fix (top server-side follow-up).

## Session 5 (2026-06-12): home-rooted folder picker + local/proxied QR pairing

### Folder picker now browses the user's HOME (cross-platform)
- New `fs.listDirs` RPC (handlers/fs.ts): browse-only, rooted at `os.homedir()`
  (macOS /Users/x, Linux /home/x, Windows C:\Users\x), directories only, never above
  home, hidden/system dirs filtered. Returns `{path, home, parent, entries}` (absolute
  paths; `parent` saves the client from path math).
- `session.create` now validates via `resolveSessionFolder()` (handlers/session.ts):
  accepts `~`/`~/x`/absolute-under-home/relative-under-workspaceRoot, REQUIRES the folder
  to exist (kills the misleading spawn-ENOENT class at the source), stores absolute.
- DirectoryPicker rewritten on fs.listDirs: opens at `~`, breadcrumb `~ / projects / …`,
  tildified path preview, parent-based back nav, absolute paths flow into session.folder
  → thread worktreePath → terminal/AI cwd (verified live: created a workspace for
  ~/projects/claude-code-remote/t3code while the server ran in the stavi repo; terminal
  prompt opened at `~/projects/claude-code-remote/t3code main`).

### CLI: local/proxied choice + QR for BOTH modes
- `stavi serve` on a TTY without --local/--relay now asks:
  "1) Local — same Wi-Fi, LAN address  2) Proxied — relay tunnel" (default local;
  relay URL prompt defaults to wss://relay.stavi.app / $STAVI_RELAY). Non-TTY (scripts,
  services) defaults to local with no prompt. New `--local` flag skips the prompt.
- Local banner now prints a scannable QR: base64url PairingPayload with EMPTY
  relay/serverPublicKey/roomId + `lanHost` (e.g. 192.168.1.8) + port + token — the same
  envelope the app's PairServerScreen already decodes; empty relay fields select the
  direct-LAN path (scanner now normalizes '' → undefined so connectServer can't
  mis-route to relay mode). Payload round-trip verified against the app's decode logic.
- NewSessionFlow server chips now show `hostname :port` (same machine, several servers).

### QR scanner entry point (was unreachable)
AddServerSheet rendered its "Pair via QR" button as a SIBLING of AddServerModal — but RN
Modals are separate native windows on Android, so the button was permanently hidden
underneath ("rendered outside the modal so it's always visible" was exactly backwards).
Fixed: AddServerModal now takes an `onPairQr` prop and renders "Scan QR code instead"
inside the modal below Connect. Verified live: Add server → Add Server → Scan QR code
instead → camera permission → scanner viewfinder.

Open follow-ups from this session: Windows path handling in fs.listDirs is best-effort
(sep-aware) but untested on a real Windows server.

## Session 6 (2026-06-12): adopted 3 libraries from the bookmarks space

Installed via yarn (NOT npm — repo uses yarn-classic `nohoist` for react-native;
npm rehoisted and deleted apps/mobile/node_modules/@react-native, breaking Gradle).

- **@notifee/react-native** — local notifications for agent events. `services/notifications.ts`
  fires on approval / user-input / turn-done / turn-error from useOrchestration's
  processEvent; no-ops while foregrounded (chat already shows it). Gradle gotcha: notifee
  ships its `app.notifee:core` AAR as a local maven repo inside the package — with
  `RepositoriesMode.PREFER_SETTINGS` the repo MUST be added in settings.gradle
  dependencyResolutionManagement (project-level allprojects{} is ignored). Verified LIVE:
  sent a turn, backgrounded, "Stavi — Agent finished — PONG" appeared in the shade
  (channel=agent-events, importance HIGH).
  - Design bug found + fixed: permission was requested lazily on first event, but events
    fire when backgrounded where the Android 13+ POST_NOTIFICATIONS dialog can't appear →
    added `primeNotifications()` called on workspace (orchestration) mount, foreground.
- **react-native-edge-to-edge** — replaced all 4 `StatusBar` usages in WorkspaceScreen
  with `<SystemBars style=.../>`; API 35 enforces edge-to-edge so this is the correct
  primitive (status bar icons now sit flush at the top, verified).
- **react-native-actions-sheet** — migrated NewSessionFlow off raw Modal +
  KeyboardAvoidingView to `<ActionSheet>` (gesture dismiss, backdrop, keyboard handling
  for free). First migration; ServersSheet / DirectoryPicker / model picker are the next
  candidates (kills the hand-rolled-sheet bug class — buried QR button, gesture conflicts).

Not yet adopted from the "worth evaluating" list: legend-list (chat list perf),
react-scan (dev re-render profiler), compressor (image attachments when we add them).

## Session 7 (2026-06-12): editor file-tree fix + branding + cleanup

- **"t3code"/"Stavi Apps" cards**: NOT branding — test sessions created earlier (named
  after the folders they pointed at). Deleted. Confirmed zero t3code/lunel/litter/muxy
  references anywhere in apps/mobile/src (only internal plans/ docs mention them).
- **Home title "Workspaces" → "Stavi"** (both header variants).
- **Editor file tree FIXED (root cause = same bug class as the hamburger)**: SessionDrawer's
  closed-state edge-swipe-to-open strip was a full-height 30dp View at zIndex 10 over the
  whole workspace. The editor's file-tree toggle (top-left) sat under it; the strip's
  PanResponder doesn't claim a tap, but being on top it blocked the tap from reaching the
  button behind. The editor was unusable (couldn't open the tree → couldn't open files).
  Fix: removed the edge-swipe-to-open catcher entirely (hamburger is the open affordance;
  re-add edge-swipe later via RNGH at navigator level, which lets taps through). Verified
  live: tree opens, package.json opens in CodeMirror with syntax highlighting.
- Editor confirmed working: CodeMirror 6 in WebView, ~11 languages, ONE dark theme
  (staviTheme/oneDark). Light theme plumbed via `setTheme` bridge but not applied; no
  theme picker. (Editor-theme picker = approved future work.)

Approved-but-not-yet-built: editor theme picker (litter-style), first-run/welcome screen,
animations & icons polish. Plus open product/architecture questions (bundle size, browser
traffic routing, desktop-mode/mouse/devtools for the browser) being assessed before adding
weight — user's hard constraint is "don't make the app too big."

## Session 8 (2026-06-12): editor theme picker (litter-style) — DONE

- Editor WebView (`assets/editor/`): added `thememirror` (tiny, ~13KB into bundle.js, ZERO
  native size), built a `THEMES` registry in src/theme.ts (Stavi Dark default + Dracula,
  Tomorrow, Cobalt, Cool Glow, Espresso + 3 light: Ayu, Solarized Light, Rosé Pine Dawn),
  added a `themeCompartment` so index.ts swaps themes at runtime, and wired bridge.ts
  setTheme → `stavi:setTheme` event → compartment reconfigure + page-bg match.
- RN side: editor plugin now declares a `theme` select setting (Settings → Editor →
  Appearance, auto-rendered by SettingsRenderer); EditorSurface reads it via
  `usePluginSetting('editor','theme')` and sends the id (replaced the old hardcoded
  dark/light send).
- Editor bundle.js is an Android asset (`assets.srcDirs += ['../../assets']`) → required an
  APK rebuild to ship; the RN side is Metro-live.
- Verified live: Settings → Editor → picked Dracula → editor repainted in Dracula colors
  (purple-navy bg, yellow strings, pink keywords).
- Known rough edge (pre-existing, not theme-related): navigating to Settings and back blanks
  the editor WebView until a file is reopened (Workspace screen unmounts on nav). Separate fix.

Remaining approved (all JS / Metro-live, no APK rebuild): welcome/first-run screen,
animations & icons polish, browser desktop-mode + eruda devtools.

## Session 9 (2026-06-12): deep plugin audit + fixes

Ran a 4-agent audit (terminal, git, dummy-buttons+sidebar, icons). Headlines:
- **Git is genuinely solid** — all 15 actions (status sub, stage/unstage/discard/commit/
  pull/push/checkout, log, diff, branches, 3 tabs) verified end-to-end, ZERO broken/dummy.
- **Terminal Ctrl**: Ctrl+C/Ctrl+D worked (send \x03/\x04) but there was NO general Ctrl
  modifier. Added a sticky **Ctrl** toggle to TerminalToolbar (arms → next char sent as
  `char & 0x1f`, then disarms); applied in handleInput. Works for soft-keyboard letters too
  because the WebView's xterm `onData` routes all input through handleInput. (Skia backend
  hardware-keyboard Ctrl still a gap — iOS beta, deferred.)
- **Sidebar/drawer** (user's model): added `supportsSessions` flag to PluginDefinition.
  AI + Terminal set it (search + list + New). Editor/Git/Browser/Explorer don't → drawer now
  shows just the plugin name (no useless "No sessions for this tool" placeholder).
- **Dummy buttons fixed**: editor `format` action (dead type + empty handler) removed;
  browser `navigate` GPI (empty stub, no callers) removed; AI markdown copy button now
  actually copies via `@react-native-clipboard/clipboard` (was a lying "Copied!" no-op).
- **Provider icons**: replaced the hand-drawn Claude/Codex approximations in ai/ProviderIcon
  with the REAL Anthropic spark + OpenAI marks (ported from t3code, inline react-native-svg,
  zero native size). Used in ModelPopover + Composer.
- **Folder-name prefill**: NewSessionFlow now prefills the workspace title with the picked
  folder's basename (overridable). Editor tabs already showed filenames; titles already
  derived from folder — both confirmed correct by the audit.
- Clipboard is the only new native dep → one APK rebuild. Everything else is Metro-live.

Still deferred (not yet built): welcome/first-run screen, animations & icons polish, browser
desktop-mode + eruda devtools, the Tabs rename/multi-tab decision. Coming-soon provider rows
(Cursor/OpenCode/Gemini) left as honestly-labeled placeholders (not dummy buttons).

## Session 10 (2026-06-12): QR fix + server-UX restructure + light/dark fixes

- **QR "not a Stavi code" — FIXED**: PairServerScreen `_decodePairingPayload` required
  relay-only fields (roomId + serverPublicKey), so it rejected every LOCAL QR. Now accepts
  both shapes (local: token+lanHost+port; relay: token+relay+room+key), rejects junk.
  Verified by running real payloads through the decoder.
- **Single add-server button**: home dashed tile + empty-state button now open
  AddServerModal DIRECTLY (was tile → ServersSheet → another "Add Server" button). Verified
  live: tile → Add Server form with "Scan QR code instead".
- **Long-press server card → actions** (Reconnect/Disconnect, Rename, Remove) — ActionSheet
  on iOS, Alert on Android, plus a themed Rename modal. Verified live: renamed a server to
  "Home Mac" and the card updated.
- **Server name defaults to hostname** (connection.ts addServer: `name || hostname ||
  host:port`); AddServerModal stops force-defaulting to host:port. Card now shows the
  editable `name` (was showing hostname, which hid renames).
- **Settings declutter**: removed the per-server `ServerSection` flat list; Settings now has
  one "Servers — N added · M connected →" row opening ServersSheet. Verified via UI dump.
- **Light/dark "weird" — FIXED** (was wired correctly; 3 components broke it):
  ProcessDetail.tsx + SpawnForm.tsx imported the static dark `colors` in module-scope
  StyleSheets → migrated to `useTheme()` + useMemo(createStyles). ErrorBoundary moved INSIDE
  ThemeProvider (themed fallback for child crashes) with dark hardcoded fallbacks (matching
  the dark default) for the rare ThemeProvider-crash case. Dark mode verified rendering clean.

Demo-repo recon (enzomanuelmangano/demos, wcandillon) done — recommended lightweight
patterns (animated tab-bar pill indicator, gesture bottom sheets, swipe-row actions,
cross-fade plugin transitions) all doable with installed reanimated/gesture-handler/skia, no
new deps. NOT yet implemented — that's the animation-polish pass. Also pending: editor
settings live text-preview.

## Suggested next ports (priority order)

1. Lunel-style per-plugin reconnect refresh contract (`onReconnectRefreshSession`) wired to
   the existing `onReconnect` listener — terminal resize + AI message/status refetch.
2. Litter-style approval in-flight tracking (request-id scoped, transport-aware errors).
3. muxy rAF write batching in the terminal WebView (small, immediate jank win).
4. t3code session idle reaper (5-min sweep, 30-min idle, skip active turns).
5. muxy backoff-with-jitter for relay reconnect.
6. t3code 4-state turn lifecycle (interrupted vs failed) — touches protocol + reducer.

---

## Session 11 (2026-06-12) — production polish batch

A large user-requested batch. All changes typecheck clean (server-core, shared, mobile).
Server-core changes (gitignore + slash commands) need a `bun dev` restart to take effect;
the new app icon + editor bundle need a native APK rebuild; JS changes are Metro-reloadable.

### Correctness fixes
- **Restore last AI thread** (Bug 4 finished): `ai-bindings-store` persists a per-workspace
  `lastActive` map (AsyncStorage). `useOrchestrationActions.setActiveThread` records it;
  `useOrchestration` mount selection now falls back bound → lastActive → most-recent →
  null, so reopening the AI tab lands on your last chat, not a blank.
- **Terminal Ctrl bar hidden by keyboard** — wrapped the terminal panel in
  `KeyboardAvoidingView` (behavior height/padding, offset = bottomBarHeight), mirroring the
  AI composer. Edge-to-edge suppresses Android adjustResize, so the bar needed explicit
  avoidance.
- **Model picker didn't close on select** — `ModelPopover` ModelsContent now calls
  `onClose()` after `onSelect` (every other section already did). Tap-outside already worked
  via the absoluteFill Pressable.

### Features
- **Coming-soon provider icons** — real Cursor (cube), OpenCode (notched frame), Gemini
  (4-point spark) SVGs added to `ProviderIcon.tsx`; ModelPopover's COMING_SOON list now
  renders them instead of first-letter chips. Rasterized + eyeballed.
- **.gitignore respect in explorer** — `fs.list` (server-core) now layers `.gitignore` from
  the project root down to the listed dir via the `ignore` package (new dep), gated behind
  `!showHidden`. Bounded to the containing allowed root (workspaceRoot or session folder).
  Verified against ~/projects/stavi-playground: node_modules/dist/*.log hidden, src/
  package.json shown, showHidden reveals all. Mirrors lunel's walk; lunel only did it in
  search/grep, we do it in the per-dir listing the explorer actually uses.
- **/compact + slash commands** — the gap was real (composer had NO slash UI; ProviderInfo
  had no slashCommands). Server: claude.ts captures the SDK `init.slash_commands`, seeds
  well-known defaults (compact/clear/context), exposes via `getSlashCommands()` →
  registry → ProviderInfo. Client: composer shows a `/`-triggered menu (built from the
  active provider's slashCommands), inserts `/cmd ` on tap; the agent interprets it on send
  (t3code's text-dispatch model — provider slash commands are NOT a special RPC).
- **Editor theme live preview + 8 more themes** — added a `preview` color palette to the
  generic select-option type (shared) so SettingsRenderer renders a live syntax-highlighted
  snippet per option. Editor now ships all 16 thememirror themes (added amy, barf, bespin,
  birds-of-paradise, boys-and-girls, clouds, noctis-lilac, smoothy) + stavi-dark; bundle.js
  rebuilt via `node build.mjs`.
- **Browser tabs** — rewrote the browser plugin with a tab model: tab strip (new/close),
  per-tab WebView kept mounted (display-swapped) to preserve history/scroll, URL bar + nav
  controls scoped to the active tab. Proxy/relay rewrite logic preserved.
- **Splash + welcome** — `SplashScreen` (moon logo + wordmark) shown until connection +
  app-prefs stores hydrate (also fixes the cold-start blank-home flash). First-run
  `WelcomeScreen` (gated by persisted `hasOnboarded`) with branding + feature rows + Get
  Started. New reusable `MoonLogo` SVG (crescent via even-odd carve + sparkle).
- **Bottom-sheet unification** — built `components/sheets/AppSheets.tsx`: registered
  `app-action-menu` + `app-confirm` sheets (react-native-actions-sheet SheetManager) with
  promise-based `showActionMenu` / `showConfirm` / `showAlert` helpers; `SheetProvider`
  wraps the app. Converted all menus/confirms/error-alerts (SessionsHome server menu,
  WorkspaceCard, ServersSheet, useGit, CommitSheet, FileTree, EditorSurface, explorer,
  ProcessDetail, AddServerSheet, PairServerScreen) off OS Alert/ActionSheetIOS. No
  functional ActionSheetIOS left. Intentionally NOT converted: 3 transient "copied"/toast
  info popups (FileTreeMenus, EntryMetaSheet, SearchResults' iOS fallback) — those want a
  toast, not a sheet; a future generic toast component should absorb them.

### Still pending
- Native APK rebuild + `bun dev` restart to land server-core + icon + bundle changes.
- Optional: generic Toast component to replace the 3 remaining info Alert.alert sites.

---

## Session 12 (2026-06-12) — recon-driven production batch (keyboard, slash parity, permissions, streaming, UX)

Driven by a 6-agent recon workflow (keyboard math, t3code slash pipeline, SDK ground truth +
live probe, lunel streaming, permissions audit, UX items) + a 2-phase adversarial review
workflow over the diff (1 confirmed finding, fixed; 1 rejected). All three packages
typecheck; APK rebuilt; verified live on emulator against a temp server.

### Keyboard (root cause + fix)
- ROOT CAUSE: react-native-edge-to-edge disables decor-fits → Android ignores adjustResize;
  RN KAV was sole compensator and BOTH panels passed bottom-side geometry as
  keyboardVerticalOffset (must be top-side: insets.top + header). Terminal under-compensated
  by T−B−12 (half-hidden bar); AI over-compensated by 56+B−T (the gap).
- FIX: adopted react-native-keyboard-controller 1.21 (lunel ^1.18 + t3code 1.21 both ship it;
  edge-to-edge README recommends it). `useKeyboardPanelStyle(bottomBarHeight)` hook:
  reanimated pad = max(0, K − bottomBarHeight), identical to lunel ai/Panel.tsx:3625.
  KeyboardProvider in App.tsx. Terminal/AI/system-search panels now Reanimated.View with
  animated paddingBottom (KAV deleted). Browser KAV deleted (URL bar is top-anchored).
- Emulator IME runs in floating hardware-keyboard mode (no insets) → pad stays 0, layout
  clean; full-height-IME geometry verified by derivation only — CHECK ON REAL DEVICE.

### Slash commands (t3code parity)
- Server: boot-time capability probe (never-yielding AsyncGenerator prompt + abortController,
  persistSession:false, allowedTools:[], settingSources user/project/local, 8s timeout) →
  initializationResult().commands = rich {name, description, argumentHint}. Disk cache
  ~/.stavi/userdata/claude-capabilities.json seeded by registry at boot. Live: **36 commands**
  discovered (incl. custom project skills). Init-message names still merged as backfill.
  Curated seed trimmed to compact/context/cost (probe is ground truth; /clear etc. come from
  the probe when the CLI supports them via query).
- Mobile composer: line-prefix cursor-aware trigger (/^\/(\S*)$/ on current line up to cursor,
  via onSelectionChange), tiered ranking (name exact/prefix/boundary/includes/fuzzy +
  description), built-ins /model /plan /default (model → picker; plan/default → mode switch;
  also intercepted when SENT standalone), Built-in/Provider sections on empty query,
  argumentHint inline in mono, `/name ` insertion with trailing-space dedup. Verified live:
  sections + hints render, /comp ranks /compact first, tap inserts "/compact ".
- Compaction UX: claude.ts yields compact-boundary on system/compact_boundary →
  thread.compaction broadcast → "Context compacted" info chip part in the timeline.

### Permissions (12-gap audit → all fixed)
- CRITICAL: pending approvals now tracked in ctx.pendingApprovals, included in snapshots
  (orchestration-helpers session.pendingApprovals), rehydrated on mobile → app reload no
  longer deadlocks a turn.
- thread.approval-resolved broadcast on every path (respond RPC, interrupt, turn end) →
  reducer clears cards on all devices; ghost cards gone.
- Claude always-allow now real: canUseTool captures opts.suggestions → respondToApproval
  returns updatedPermissions (was byte-identical to accept). Button: "Always allow (session)".
- ExitPlanMode intercepted → thread.plan-proposed → PlanCard (plan markdown + Approve & build
  / Keep planning; approve flips mode to default + sends approval turn).
- Codex: approvalPolicy + sandboxPolicy now sent on EVERY turn/start (mid-thread access
  changes work); stopAll goes through stopSession (declines pending); command argv arrays
  normalized to strings for the card.
- isAutoApprovedClaudeTool substring list deleted (was auto-approving any tool name containing
  edit/write/delete/... incl. MCP tools); acceptEdits SDK mode handles it.
- bypassPermissions now paired with allowDangerouslySkipPermissions (t3code parity).
- ApprovalCard rewrite: request-kind classification (command/file-change/file-read), Edit
  old→new diff preview, expandable long commands (400 chars), 1/N queue badge, Cancel-turn.
- accessLevel chip rehydrates from thread.runtimeMode (was reset to supervised every mount).
- turnError swapped-args bug fixed (error showed as "turn-<ts>").

### Streaming (perf)
- Server turn-start: WS broadcast throttled to 60ms (trailing timer), SQLite writes to 300ms
  + final — was per-delta on both (O(n²) wire, hundreds of writes/turn).
- Client: markdown tail-split while streaming (settled prefix memo-stable, only current
  paragraph re-parses), near-bottom autoscroll guard (lunel pattern — no more fighting the
  user's finger), reanimated blinking cursor.
- SWM verdict: the project is react-native-streamdown (software-mansion-labs, v0.2) over
  enriched-markdown (native text, RN 0.83+ Fabric). Lunel does NOT use it (plain
  markdown-display, no batching — stavi's coalescer is ahead). Deferred: prototype behind a
  plugin setting later; v0.2-labs + loses the code-block copy button today.

### UX items (all verified live on emulator)
- Editor tabs: tabText flex:1 → flexShrink:1 (Yoga intrinsic-width collapse — same pitfall
  class as memory note). File names render.
- Editor drawer = file tree: PluginDefinitionBase.drawerContent escape hatch; EditorDrawerTree
  wraps FileTree + auto-closes on editor.openFile. Verified: tree in drawer (gitignore-
  filtered), tap opens file + closes drawer.
- Explorer → Editor: openFileInEditor() helper (editor store openFile + find-existing-tab
  activation — bare eventBus emit was dropped when the editor tab was unmounted); wired into
  EntryRow tap + batch Open in Editor; serverId plumbed into ExplorerList.
- Browser tabs → drawer: SessionRegistration.onCloseSession + drawer row X affordance;
  browser registers tabs (title/URL/active) with New Tab; top strip deleted. Verified live.
- Theme: default 'system' (userSet flag preserves explicit choices across migrations, v3);
  windowBackground light #f2f1ed / values-night #08090a (no white flash, matches JS bg.base);
  SystemBars rendered once in AppInner (4 per-screen copies deleted); MoonLogo theme-aware
  (deeper gradient + amber sparkle on light); dead textStyles import dropped from git panel.
  Verified live: light theme home/AI/terminal/editor all render correctly with dark status icons.

### Review finding (fixed)
- Workspace scoping was snapshot-only: live thread.created events from other workspaces
  (second device) appended to this workspace's drawer until next snapshot. Fixed: reducer
  ctx carries preferredWorktreePath, thread.created drops foreign-workspace threads.

### Notes
- Server restart required (probe/approvals/throttle are server-side). APK already rebuilt +
  installed (keyboard-controller native module). Metro may need /metro-clean once for the
  new keyboard-controller package resolution.
- t3code patterns intentionally NOT ported yet: 5-min snapshot refresh loop + provider status
  PubSub (stavi pushes on demand), approval persistence as DB activities (in-memory ctx +
  snapshot covers reload; durable history is a follow-up).

### Release build recipe (session 12 addendum)
- `cd apps/mobile/android && ./gradlew assembleRelease -PreactNativeArchitectures=arm64-v8a`
  → 57MB arm64-only APK, debug-keystore signed (testing only — generate a real keystore
  before any store distribution). ProGuard intentionally OFF (no curated rules for
  notifee/vision-camera/skia/keyboard-controller yet).
- FIXED: release dex-merge failed with duplicate `com.facebook.react.viewmanagers.*` —
  vision-camera 4.7.3 has no codegenConfig, so the React plugin codegens RN CORE specs
  (70 classes) into the library; debug's native multidex tolerates the dupes, release's
  merger doesn't. Patched its build.gradle to `java.exclude` the two core packages —
  persisted via patch-package (`patches/react-native-vision-camera+4.7.3.patch`,
  root `postinstall: patch-package`).
- FIXED: APK shipped the entire editor bundle WORKSPACE (node_modules incl. two 9MB macOS
  esbuild binaries, sources, lockfile — ~28MB dead weight, 67→57MB). app/build.gradle
  `androidResources.ignoreAssetsPattern` now ships only editor/index.html + bundle.js.

---

## Session 13 (2026-06-12) — real-device feedback batch

6-agent recon → serial implementation → 2-phase adversarial review. All packages typecheck.

### Model switching mid-thread (FIXED — was fully client-side)
- Root cause: useModelSelection's thread-sync effect had configSelection.modelId in its deps —
  picking a new model re-ran the effect, which overwrote the pick from the thread's STORED
  selection on the next render. Server already supported per-turn models (fresh query() per
  turn with resume + per-turn model). Fix: threadSelKey + lastSyncedKeyRef — sync runs only
  when the thread or its persisted selection changes (t3code "draft wins" semantics).

### Terminal truths (FIXED)
- "toybox: Unknown command 999999999" — the Android keep-alive process: Termux passes args
  VERBATIM as argv, so argv[0] was "999999999"; toybox dispatches by argv[0] → error + exit
  127 printed into every terminal. Fix: /system/bin/sleep + argv ["sleep","999999999"].
- Settings were lying: Android ALWAYS renders the Termux native view; there is no xterm
  WebView on Android (iOS-only). resolveEffectiveBackend now returns 'native' on Android;
  labels/notice/fontSize descriptions rewritten to match reality.
- New-tab dead keyboard: nothing focused the new terminal — the hidden previous tab kept IME
  focus and keystrokes went to the WRONG PTY. Added a focus command through the full stack
  (Fabric spec → ViewManager → focusTerminal() with requestFocus+showSoftInput → JS ref →
  panel effect on activeSessionId).
- Key bar: 40→52px bar, 28→38px keys (48dp-class targets), added Home/End/PgUp/PgDn.

### Ports (FIXED)
- lsof bare -i leaked every UDP + connected socket (−sTCP:LISTEN only filters TCP states) →
  duplicate (port,pid) keys crashed the FlatList. Now -nP -iTCP -sTCP:LISTEN + '->' skip +
  Set dedupe; client keyExtractor includes address.

### Fonts (FIXED a silent year-old bug)
- Android resolves custom fonts by ASSET FILENAME: bare 'Inter'/'JetBrainsMono' never matched
  → Roboto everywhere those tokens were used (including "mono" code blocks!). Tokens now use
  Name-Weight form. Mono switched to Fira Code (tonsky 6.2 statics) bundled for RN +
  Termux typeface (guarded createFromAsset) + editor WebView @font-face (+ CSP font-src).
  iOS xterm WebView font deferred (Android terminal is native).

### AI markdown highlighting (NEW)
- lowlight (hljs core) + 10 grammars → nested Text spans colored from theme terminal tokens.
  20KB cap, memoized per content. Neither lunel nor t3code mobile highlight chat code.

### Editor restructure (NEW)
- Single header: editor sets hideHeader; EditorToolbar (44px) hosts the drawer hamburger +
  filename + find/undo/redo/save. onOpenDrawer threaded WorkspaceScreen→PluginRenderer→panels.
- In-panel file tree removed (drawer owns it); tablet rail removed with it.
- Image preview: server GET /file?path&token (guardPath-protected, streamed) + raster <Image>
  preview; SVG renders via SvgXml from file text (error-bounded). Raster files skip fs.read
  entirely (utf-8 corrupts bytes).
- Symbols bar above keyboard (lunel terminal-bar pattern): Save + Tab/braces/quotes/operators,
  routed through a new insertText bridge message (editor bundle rebuilt); editor panel now
  rides the keyboard via the shared keyboardPad.

### Settings + bottom bar (RESTRUCTURED)
- Per-plugin settings page (PluginSettings route) replaces inline accordions.
- PluginBottomBar: BAR_HEIGHT exported (56→60), icon 22→24, label 12, slot minHeight 48;
  WorkspaceScreen derives bottomBarHeight from the export (keyboard math can't drift).

### App icon (REGENERATED via codex image gen — confirmed working)
- codex CLI has stable image_generation; generated flat-vector crescent (amber two-tone +
  cream sparkle on #07080E) informed by litter/lunel icon analysis (flat tones, full-bleed,
  ~70% subject). Transparent-alpha variant generated for the adaptive foreground (safe-zone
  scaled) + in-app mark. Splash/Welcome now show the SAME art (MoonLogo renders the icon
  with launcher-style rounded corners). Legacy + round + adaptive mipmaps all rebuilt.

### Session 13 review findings (all fixed)
- HIGH: terminal auto-focus effect wasn't gated on isActive — a hidden (opacity-swapped)
  terminal could steal IME focus after WS-reconnect auto-create or Explorer "Open in
  Terminal", silently piping typed chat text into a shell. Now gated on isActive.
- MED: streaming markdown tail-split could land inside a ``` fence (blank lines are common
  in code) → half-fence rendered as auto-closed code + rest as prose. Split point now skips
  breaks inside open fences (``` parity check, 50KB perf guard).
- MED: FiraCode was plist-declared but not bundled on iOS — ran react-native-asset (pbxproj
  Resources group + build phase now reference the TTFs).
- MED: GET /file had no ReadStream error handler — file deleted mid-stream could throw
  asynchronously and kill the server. Guarded with stream.on('error') → res.destroy().
- Build gotchas: yarn-classic `yarn workspace X add` does NOT run the root postinstall —
  vision-camera patch silently reverted once. Both root AND apps/mobile now have
  patch-package postinstalls. Release APK: 59MB arm64 at /tmp/stavi-release-arm64.apk.

---

## Session 14 (2026-06-12) — connection experience overhaul

4-agent recon + live handshake reproduction + 2-phase adversarial review (3 confirmed, fixed).

### Root causes of "release APK on real phone cannot connect" (BOTH fixed)
1. **Cleartext blocked**: RN's gradle plugin sets usesCleartextTraffic=false for release —
   Android 9+ rejected every http/ws connection before a packet left the phone (debug/emulator
   allowed it, masking this). Manifest now hardcodes true (tools:replace) with a TLS-pinning
   note for future hardening. Verified in the merged release manifest + final APK.
2. **Dev config baked into release**: generated/dev-config.ts (emulator 10.0.2.2 + a REAL
   bearer token) was committed AND statically imported — the release Add Server form was
   pre-filled with an unroutable host, and the token shipped inside every APK. Now: dev-only
   conditional require (Metro strips it from release bundles — verified token absent from the
   final bundle), file untracked + gitignored, null-stub postinstall for fresh clones.
   NOTE: the old token is in previously built APKs — rotate by deleting
   ~/.stavi/userdata/credentials.json (server mints a new one; phone re-pairs).

### Server-side verified healthy (live): /health + ws-token + WS open all work over LAN.

### Pipeline hardening
- detectLanCandidates(): all LAN IPv4s, Wi-Fi/Ethernet preferred, VPN/virtual (utun/tap/awdl/
  bridge/vmnet/wg/...) excluded — the old first-interface pick routinely handed the phone a
  VPN address. QR/banner now carry lanHosts[]; the app probe-races /health (1.5s each,
  Promise.any) and persists the winning host.
- /health enriched: {status, app:'stavi', serverId, name, port} — probes positively identify
  a stavi server (no secrets).
- _fetchWsToken: 8s AbortController (was: infinite hang on blackholed hosts).
- RelayTransport: 15s connect timeout (was: stuck "authenticating…" forever if the server
  never joined the room).
- addServer skips the LAN preflight for relay pairings.

### Error experience
- utils/connect-errors.ts classifyConnectError(): token-rejected / unreachable (with same-
  Wi-Fi + firewall + AP-isolation checklist) / refused-session / relay causes — used by
  Add Server, QR pairing, ServersSheet, home reconnects. No silent catches remain on user-
  initiated connects.
- Home cards: error = red dot + "error — tap to retry"; offline = "offline — tap to connect";
  tapping an offline/errored card reconnects. Offline empty state has a Reconnect button.
- QR pairing now AWAITS the connect (was fire-and-forget + goBack — scans "succeeded"
  against dead servers) and shows classified errors.

### Add Server form
- Smart paste (paste-sized input only — typing never mis-splits): full pairing code fills
  host/port/token AND relay fields; host:port and http URLs split correctly. Copy fixed
  (stavi serve, not yarn dev). QR screen: copy corrected (QR prints in BOTH modes),
  Open-app-settings on permanent camera denial, close button on no-camera.

### Relay: now actually works end-to-end
- THE bug: the CLI dropped all decrypted relay traffic (onDecrypted was an empty stub with
  the send hook discarded) — handshake succeeded, app showed connected, every RPC vanished.
  Implemented createLocalBridge: decrypted frames → local ws (internally minted wsToken),
  responses piped back through the tunnel.
- Mobile-peer auth: Noise NK only authenticates server→phone and the relay never validates
  tokens — first encrypted frame must now be RelayAuth{token}; CLI verifies before bridging.
- ws v8 gotcha (review-confirmed): text frames arrive as Buffer — `instanceof Buffer` could
  not detect relay signals; switched to the isBinary flag, plus re-handshake-while-session-
  active resets the peer (reconnect resilience even when signals are missed).
- Dead default relay URL (relay.stavi.app = NXDOMAIN) removed: relay requires --relay or
  STAVI_RELAY; the prompt explains self-hosting apps/relay and falls back to local.

### CLI banner
- Prints every candidate address, a paste-able pairing code (local mode too), and a
  troubleshooting block (same Wi-Fi / macOS Firewall / AP isolation).

### Review findings fixed
- ws v8 text-frame detection (above), Add Server modal not closing on success from home
  (missing onComplete at 2 sites), relay pairing paste dropping relay fields (now captured
  in form state, cleared on manual host edits).

---

## Session 15 (2026-06-12) — connect failures, verified on-device

User: real-phone LAN connect fails entirely; tapping a server should connect; Add Server
adds the server even when the connection fails. All fixed + verified live on the release
build (emulator), incl. against the Mac's REAL LAN IP (not just the 10.0.2.2 alias).

### Bug #3 — phantom add (FIXED + verified)
- prefetchServerInfo swallowed ALL errors → addServer always persisted, even for a server
  that doesn't exist. Now returns {reachable, error}; addServer THROWS for an unreachable
  LAN server (relay skips, validated at transport). AddServerModal shows the classified
  error inline and does NOT add. Verified: bogus 192.168.1.99 → "Couldn't reach … check
  same Wi-Fi / server running / firewall / AP isolation", form stays open, not added.

### Bug #1 — can't connect on real phone (root cause + mitigations)
- The Mac has TWO non-internal IPv4s: en0 192.168.1.8 (Wi-Fi) and utun10 100.115.180.29
  (Tailscale CGNAT). The OLD detectLocalIp picked the FIRST in arbitrary interface order —
  if utun10 won, the QR advertised a Tailscale IP the phone can't route to. detectLanCandidates
  (session 14) excludes utun*/tun*/vpn ifaces and prefers en* — deterministic now; plus the
  app probe-races lanHosts. Verified the app connects to 192.168.1.8 directly on the emulator,
  so app + release cleartext are correct; residual failures are environmental (AP isolation /
  phone not on the same Wi-Fi) and now surface a clear actionable error instead of silence.

### Bug #2 — tap server to connect (already in place)
- Tapping an offline/errored home server card calls connectServer + shows a classified error
  on failure (session 14). Verified cards auto-connect on launch (green dots).

### Verified on release APK (emulator): launch, connect to 10.0.2.2 AND 192.168.1.8,
### modal auto-closes on success, bogus host errors without adding, terminal clean.
