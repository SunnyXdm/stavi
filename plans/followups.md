# Phase follow-ups

## From Phase 1 verification
- ~~Streaming `replaceMessage` has no coalescing~~ — **CLOSED in Phase 7a**: PendingWrites class batches replaceMessage calls within 50ms window into single transaction. flush() called on server shutdown.
- ~~`context.ts` is 496 lines (over 400-line limit)~~ — **CLOSED in Phase 7a**: Split into context.ts (239), subscriptions.ts (144), process-spawn.ts (163), orchestration-helpers.ts (111). All under 200 lines.

## From Phase 2 verification
- ~~`apps/mobile/src/stores/stavi-client.ts` is 573 lines (over 400-line limit)~~ — **CLOSED in Phase 7a**: Split into stavi-client.ts (390) and rpc-engine.ts (203). RpcEngine owns request/response/subscription dispatch; StaviClient owns connection lifecycle and reconnect.

## From Phase 4 real-use testing
- ~~Overall visual design does not yet conform to DESIGN.md~~ — **CLOSED in Phase 7b**: tokens.ts aligned to DESIGN.md, accent changed from mint teal to indigo (#5e6ad2), all hardcoded colors swept, Inter font installed, lightColors export added as inert data.
- ~~DirectoryPicker visually broken/ugly. Token backdrop fixed in Phase 7b (rgba → colors.bg.scrim). Full layout pass deferred to Phase 7d (loading/empty/error states).~~ — **CLOSED-IN-7D**: Explorer now uses LoadingView/ErrorView/EmptyView with refined messages (permission denied / path not found / empty folder). DirectoryPicker backdrop already tokenized in 7b.

## From Phase 5
- GPI `terminalApi()` and `gitApi()` fall back to `savedConnections[0]` because the `api()` factory receives no `serverId` context. Annotated with console.warn. **DEFERRED-OUT-OF-SCOPE**: Phase 7 should pass `serverId` through the GPI call or replace direct-client calls with event-bus calls. Not a regression — GPI works for single-server setups.
- ~~`SettingsScreen.tsx` uses `savedConnections[0]`~~ — **CLOSED in Phase 7a**: SettingsScreen now renders all servers via FlatList, each with per-server disconnect + forget buttons.
- `addServer` is now async (pre-flights server.getConfig for dedup). If the server is offline at add-time, dedup is skipped (prefetchServerId returns null). This is best-effort and acceptable; adding an offline server works but won't dedup until next connect.

## From Phase 6
- **Relay reconnect wired (fixed in Phase 6 fix commit)**: connection.ts now schedules a fresh `connectServer()` call (→ new RelayTransport + new Noise NK handshake) when a relay-backed server enters 'reconnecting'. Uses same 1s→64s exponential backoff. Session state is NEVER reused. Pinned by `noise.test.ts` test "two successive handshakes with the same responder keypair produce different session keys".
- **CLI tsc dom lib (fixed in Phase 6 fix commit)**: Phase 6 mistakenly added `"lib": ["ES2022", "dom"]` to `apps/cli/tsconfig.json`, which caused `ReadableStream<Uint8Array<ArrayBuffer>>` in `server-core/src/context.ts` to lose `Symbol.asyncIterator`. Fixed by removing `"dom"` — Node.js 18+ exposes TextEncoder as a global via `@types/node`, no dom lib needed.
- **iOS build not verified**: Phase 6 adds `react-native-vision-camera` (PairServerScreen) and @stablelib packages. Expo/RN bare workflow iOS build not smoke-tested. **DEFERRED-OUT-OF-SCOPE**: Verify on first iOS device test; pay attention to vision-camera pod install and Hermes compatibility.

## From Phase 7b
- **Berkeley Mono not installed as TTF**: Berkeley Mono OTF files found on dev machine (in sibling project `litter`) but not available as TTF (Android RN requires TTF). JetBrains Mono retained as the monospace token. **DEFERRED-OUT-OF-SCOPE**: If Berkeley Mono TTF becomes available, update `typography.fontFamily.mono` in tokens.ts and re-run font linking — no component changes required since all code references the token.
- **ApiKeySetup.tsx, CommitSheet.tsx, DirectoryPicker.tsx** had `rgba(0,0,0,0.5)` backdrop not listed in 7b's Files-touched table. Fixed in Phase 7b Commit 2 to satisfy done-criterion 4 (zero hardcoded colors). These were simple single-line substitutions (→ colors.bg.scrim), no functional or layout changes.
- **PairServerScreen.tsx `'#fff'` camera values kept**: Three hardcoded `'#fff'`/`rgba(255,255,255,0.8)` values in the camera overlay are intentionally not tokenized — camera contrast requires pure white regardless of theme, and these elements overlay live camera feed, not app surfaces. Each has an inline comment explaining the intent.
- **iOS build not smoke-tested after font swap**: IBMPlexSans → Inter swap updates Info.plist and project.pbxproj, but Xcode/pod install not re-run. **DEFERRED-OUT-OF-SCOPE**: Verify on iOS device/simulator before releasing. JetBrains Mono was untouched.
- ~~**LoadingView / ErrorView / EmptyView polish, reconnect toast, MENTAL-MODEL.md** remain deferred to Phase 7d as specified.~~ — **CLOSED-IN-7D**: StateViews.tsx created with three components using tokens exclusively. All six plugins + WorkspaceScreen swept to use shared StateViews. ReconnectToast polished (tap-to-dismiss, 2.5s, zIndex.toast, fade-in). MENTAL-MODEL.md created in docs/.
- **Explorer rewrite and system-search real implementation** ~~remain Phase 7c. system-search stub text updated from "Phase 7" → "Phase 7c" for clarity.~~ — **CLOSED in Phase 7c**.

## From Phase 7a
- `orchestration-helpers.ts` is a new seam not explicitly specified in 07-final-phases.md — it was needed to get context.ts under 300 lines. The seam is coherent (thread-building and snapshot logic) and stable. Phase 7c can locate it predictably.
- `rpc-engine.ts` makeTransportEngine sends JSON strings via `JSON.parse(msg)` round-trip — the RpcEngine accepts a string-based send function but transport expects bytes. This works correctly (encodeJsonMessage handles it) but could be simplified. **DEFERRED-OUT-OF-SCOPE**: Low priority; no functional impact.

## From Phase 7c
- **`client.subscribe` vs `client.subscribeAsync`**: Explorer batch ops (batchDelete, batchMove, batchCopy, zip) now correctly use `client.subscribeAsync()` which resolves when the server sends Exit.Success. The underlying `RpcEngine.handleExit` was extended with `onComplete?: () => void` on `ActiveSubscription` — called on Exit.Success, mirrors the existing `onError` for Exit.Failure.
- **`fs.ts` split into three files**: `fs.ts` (core RPCs), `fs-batch.ts` (batchDelete/Move/Copy + stat), `fs-zip.ts` (zip/unzip). The `guardedPath` closure is passed as a callback so each handler file can validate paths without duplicating the guard logic.
- **`archiver` + `unzipper` in server-core/package.json**: Both zip libraries are declared as explicit dependencies. npm workspace hoisting puts them in the repo root `node_modules` but Node module resolution finds them correctly via the package.json declaration.
- **Zip unimplemented on server unless npm install is re-run**: `archiver` and `unzipper` must be installed (`cd packages/server-core && npm install`) before `fs.zip` / `fs.unzip` are functional. The server will throw at runtime if these modules are missing.
- **Explorer `estimatedItemSize` removed**: The installed version of `@shopify/flash-list` does not expose `estimatedItemSize` as a standalone prop. Removed from ExplorerList and SearchResults. If a newer version is installed that supports it, add `estimatedItemSize={44}` to ExplorerList rows and `estimatedItemSize={56}` to SearchResults rows for better initial scroll performance.
- **`client.subscribeAsync` does not support reconnect-resubscribe**: Unlike `client.subscribe()`, the `subscribeAsync` Promise-based wrapper registers a one-shot subscription that is removed from `registeredSubscriptions` when the stream completes or errors. If the server disconnects mid-batch-operation, the subscription is NOT re-sent on reconnect; the Promise rejects with the connection error. This is correct behavior for batch ops (user should re-trigger manually) but different from persistent subscriptions.
- **iOS build not smoke-tested after Phase 7c**: New native deps (`archiver`, `unzipper`) are Node.js-only (daemon side). No new React Native native modules were added, so iOS build should be unaffected. Verify before release.
- **`subscribeAsync` registration race**: If `this.engine` is null when `subscribeAsync` is called (connection dropped between the check and the sendSubscription call), the sub is cleaned up and the Promise rejects immediately. This is handled explicitly in the implementation. No silent hang.

## From Phase 7d
- **Telemetry is console-only**: `logEvent()` writes structured JSON to `console.log`. No analytics SDK, no network calls. Swap in a real provider (Amplitude, PostHog, etc.) by changing the single function body in `services/telemetry.ts`.
- **Explorer `ActivityIndicator` in progress banner intentionally kept**: The batch-operation progress banner (`progressText`) in `explorer/index.tsx` uses an inline `ActivityIndicator` alongside progress text — this is a contextual inline spinner, not a full-screen loading state, so it does not use `LoadingView`.
- **Browser error state is per-navigation**: `webViewError` is cleared on each new navigation (`handleNavigate`). If a page loads partially and then errors, the error replaces the WebView until the user retries or navigates elsewhere.
- **ReconnectToast onDismiss drives cleanup**: SessionsHomeScreen no longer uses a setTimeout to clear the toast. The toast itself manages its lifecycle (2.5s auto-dismiss + tap-to-dismiss) and calls `onDismiss` to clear the parent's `toastServerId` state.

## From Phase 8a
- ~~**`useOrchestration.ts` line 118 reads connection state non-reactively**~~ — **CLOSED in Phase 8e**: Replaced `.getState().getServerStatus(activeConnectionId)` with `useConnectionStore((s) => s.getServerStatus(activeConnectionId))` selector. Hook now re-renders reactively when connection state changes (server drops/reconnects).

## From Phase 8b
- **`DrawerContent.tsx` comment header still says "session management"**: The comment on line 3 says "Left sidebar with session management". Not user-visible, so not renamed in 8b. Update the comment when the drawer is repurposed in Phase 8e. — **MOOT**: DrawerContent.tsx was deleted in Phase 8e.
- **`terminal/index.tsx` still uses "session" terminology internally**: The `TerminalSession` interface, `sessions` state, `createSession`, `closeSession` — all internal code names. These are *terminal sessions* (PTY processes), not workspace sessions, so renaming would be semantically wrong. They stay as-is permanently.
- **Telemetry event names unchanged**: `session.opened`, `session.created` etc. remain machine-readable. UI says "workspace"; telemetry retains "session" for log analysis stability. Document this distinction in any future analytics SDK integration.

## From Phase 8d
- ~~**`SessionsHomeServerSection.tsx` is superseded but not deleted**~~ — **CLOSED in Phase 8d** (already deleted before Phase 8g).
- **Archive/delete RPCs not yet wired from WorkspaceCard**: `WorkspaceCard.onArchive` and `WorkspaceCard.onDelete` fire the action sheet and Alert confirm correctly, but the server RPC calls (`session.archive`, `session.delete`) are stubbed with TODO comments. Wire in future polish pass when per-session client context is readily available on the home screen.
- **Search is client-side only**: `getAllWorkspaces()` is re-computed on every render when `searchQuery` changes. With 50+ workspaces this is still O(N) over a small array — acceptable. If the list grows to hundreds, memoize with `useMemo` keyed on `sessionsByServer` reference as well as the query.
- ~~**NoWorkspacesEmpty shows a spinner**~~ — **CLOSED in Phase 8g**: `NoWorkspacesEmpty` has no spinner; it was never added. The followup was mistaken.

## From Phase 8f
- ~~**`useOrchestration.ts` and `ai/index.tsx` pre-existing over 400 lines**~~ — **CLOSED in Phase 8g**: useOrchestration.ts split into useOrchestration.ts (332) + hooks/useThreadManager.ts (169) + utils/event-reducer.ts (173). ai/index.tsx split into index.tsx (344) + hooks/useModelSelection.ts (133) + api.ts (78) + aiPanelStyles.ts (82) + components/CommandPartsDropdown.tsx (105) + components/ThinkingIndicator.tsx (77). All files under 400 lines.
- **Chat title is static at creation time**: New chats get a title like "my-app AI" based on the folder name. The server may update the title via `thread.meta-updated` events after the AI responds. This is correct behavior — no action needed.
- **`createNewChat` does not propagate the current model selection**: When the sidebar "New Chat" button creates a thread, the `agentRuntime` is undefined (falls back to workspace default). Phase 8f wires the button; wiring the model selection from the current composer state is deferred to future polish.
- ~~**`DrawerContent.tsx` deleted, logic inlined into WorkspaceSidebar**: The session-list pattern from DrawerContent is re-implemented in WorkspaceSidebarChats using the same SessionRegistry API. Comments in `terminal/index.tsx` and `ai/index.tsx` still say "DrawerContent" — these are code comments, not imports. Update in Phase 8g cleanup pass.~~ — **CLOSED in Phase 8g**: Both comment strings updated to reference WorkspaceSidebarChats.
- **Sidebar tap-outside scrim**: WorkspaceScreen renders a full-screen Pressable overlay when sidebar is expanded. This means any tap anywhere in the content area collapses the sidebar — intentional for dismissal, but may interfere with content interaction if the sidebar is accidentally expanded. Phase 8f can gate scrim on a small left-edge zone if needed.
- **`SessionsHomeServerSection.tsx` still present**: Referenced in followups.md from Phase 8d as dead code. Delete in Phase 8g cleanup. — **MOOT**: Already confirmed deleted before Phase 8g.

## From Phase 8g
- **`useThreadManager.ts` helper functions are not `useCallback`-wrapped**: `buildThreadPayload`, `dispatchThreadCreate`, and `applyNewThread` inside `useThreadManager` are plain functions (not hooks), so they re-create each render. The hook's exported callbacks (`ensureActiveThread`, `createNewChat`) are `useCallback`-wrapped and stable. The plain helpers are only called inside those callbacks. No perf issue.
- **`processEventInner` context ref**: The `reducerCtxRef` in `useOrchestration` is initialized once with the constructor values of `instanceId`, `activeConnectionId`, and `sessionId`. These values are stable for the hook's lifetime (the hook re-mounts on serverId change via key). If multi-server hot-swap is ever needed without remount, make `reducerCtxRef.current` an always-updated object.
- **`CommandPartsDropdown` imported but not used directly in `index.tsx`**: The component was extracted to `components/CommandPartsDropdown.tsx` and the import was removed from `index.tsx`. It is consumed by `MessageBubble.tsx` if needed. If MessageBubble doesn't import it yet, wire it there.
- **iOS build not smoke-tested after Phase 8g**: Phase 8g adds no new native modules. File splits are TypeScript-only. iOS build should be unaffected. Verify before release.

## From Phase 9 (Navigation Overhaul)
- **Server plugin subscriptions now self-managed**: Each panel (Processes, Ports, Monitor) subscribes via useEffect. If a panel is unmounted (tab closed), the subscription tears down. If re-opened, it re-subscribes. Ref-counting in server-plugins-store handles dedup.
- **Case-sensitive search not supported**: Server's `fs.grep` handler hardcodes `-i` (always case-insensitive). The Search plugin omits the toggle. Update server handler to accept a `caseSensitive` flag when needed.
- **Open-in-editor line scrolling**: Search plugin passes `{ filePath, line }` as initialState to `openTab('editor', ...)`. Editor plugin may not respect `line` in initialState — verify and wire up.
- **Hash transforms skipped**: No `expo-crypto` in dependencies. Add entries to `transforms.ts` when `expo-crypto` is installed.
- **Edge zone z-index vs bottom bar**: The 30px swipe edge zone (zIndex: 10) overlaps the bottom-left of the bottom bar. If tap conflicts are reported, constrain the edge zone height to exclude the bottom bar area.
- **Keyboard + bottom bar**: Bottom bar does not hide when keyboard is open. This is correct for most plugins but may cause layout issues if a plugin's content doesn't account for `bottomBarHeight` changing.
- **`PluginRenderer` has stale `scope: 'workspace' | 'server'` in `PanelProps`**: Phase 6 removed `ServerPluginDefinition` from shared types, but `PluginRenderer.tsx` (not modified per Phase 6 rules) retains the union. This is a harmless widening — no server-scoped plugins exist to trigger the dead branch. Remove in a future cleanup pass when PluginRenderer is next edited.

## From Phase 10 Stabilization (Connection + Search Dedup)
- **Connection concurrency guard**: `_connectingServers` Map deduplicates concurrent `connectServer` calls. If the same serverId is already connecting, the second call awaits the first's promise. The guard is module-level (not persisted).
- **Old transport closed before replacing**: `connectServer` now calls `runtime.client.disconnect()` before creating a new transport. `connectViaTransport` also independently closes old transport + drains old engine. Belt-and-suspenders — both paths are safe.
- **forgetServer clears sessions**: Now calls `useSessionsStore.getState().clearServer(serverId)` which tears down subscriptions, removes session data, and cleans all per-server state.
- **Error swallowing reduced**: `autoConnectSavedServers` and `server.getConfig` bind now log warnings instead of `.catch(() => {})`. Connection errors still set `clientState: 'error'` in the store.
- **Sessions persisted**: `sessions-store.ts` now uses `zustand/persist` with AsyncStorage. Only `sessionsByServer` and `sessionsById` are persisted (not subscriptions/loading/errors). Sessions survive app restart.
- **Search dedup (3 → 1)**: Deleted `plugins/extra/search/` and `plugins/workspace/workspace-search/`. Kept `plugins/extra/system-search/` renamed to id `'search'`, display name `'Search'`. Load.ts updated.
- **AI tab strip threshold**: `PluginHeader.tsx` changed `>= 1` to `> 1` — tab strip only shows when there are multiple instances to switch between.
- **SessionsHomeScreen re-render fix**: Replaced `getAllWorkspaces()` (new array every render) with `useShallow` selector on `sessionsByServer` + `useMemo`. The sorted flat list only recomputes when session data actually changes.
- **Pre-existing TS errors not fixed**: `StyleSheet.absoluteFillObject` → should be `StyleSheet.absoluteFill` in PluginBottomBar.tsx and SessionDrawer.tsx. These are Phase 9 artifacts — fix in Phase 10 Step 8d.
- **`tools` plugin self-registers**: `extra/tools/index.tsx` calls `usePluginRegistry.getState().register()` at module scope (side-effect import). All other plugins use explicit `register()` in `load.ts`. Migrate tools to match in Phase 10 Step 7b.
- **`plugins/core/` is empty**: Dead directory from Phase 8 restructure. Delete in Phase 10 Step 7b.

