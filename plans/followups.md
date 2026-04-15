# Phase follow-ups

## From Phase 1 verification
- ~~Streaming `replaceMessage` has no coalescing~~ — **CLOSED in Phase 7a**: PendingWrites class batches replaceMessage calls within 50ms window into single transaction. flush() called on server shutdown.
- ~~`context.ts` is 496 lines (over 400-line limit)~~ — **CLOSED in Phase 7a**: Split into context.ts (239), subscriptions.ts (144), process-spawn.ts (163), orchestration-helpers.ts (111). All under 200 lines.

## From Phase 2 verification
- ~~`apps/mobile/src/stores/stavi-client.ts` is 573 lines (over 400-line limit)~~ — **CLOSED in Phase 7a**: Split into stavi-client.ts (390) and rpc-engine.ts (203). RpcEngine owns request/response/subscription dispatch; StaviClient owns connection lifecycle and reconnect.

## From Phase 4 real-use testing
- Overall visual design does not yet conform to DESIGN.md (Linear/Cursor/Intercom direction, token system, dark-mode-first). Address in Phase 7b — see DESIGN.md at repo root.
- DirectoryPicker visually broken/ugly. Functional (NewSessionFlow works), but needs a pass. Phase 7b or earlier if it blocks new-session flow usability for testing.

## From Phase 5
- GPI `terminalApi()` and `gitApi()` fall back to `savedConnections[0]` because the `api()` factory receives no `serverId` context. Annotated with console.warn. Phase 7 should pass `serverId` through the GPI call or replace direct-client calls with event-bus calls.
- ~~`SettingsScreen.tsx` uses `savedConnections[0]`~~ — **CLOSED in Phase 7a**: SettingsScreen now renders all servers via FlatList, each with per-server disconnect + forget buttons.
- `addServer` is now async (pre-flights server.getConfig for dedup). If the server is offline at add-time, dedup is skipped (prefetchServerId returns null). This is best-effort and acceptable; adding an offline server works but won't dedup until next connect.

## From Phase 6
- **Relay reconnect wired (fixed in Phase 6 fix commit)**: connection.ts now schedules a fresh `connectServer()` call (→ new RelayTransport + new Noise NK handshake) when a relay-backed server enters 'reconnecting'. Uses same 1s→64s exponential backoff. Session state is NEVER reused. Pinned by `noise.test.ts` test "two successive handshakes with the same responder keypair produce different session keys".
- **CLI tsc dom lib (fixed in Phase 6 fix commit)**: Phase 6 mistakenly added `"lib": ["ES2022", "dom"]` to `apps/cli/tsconfig.json`, which caused `ReadableStream<Uint8Array<ArrayBuffer>>` in `server-core/src/context.ts` to lose `Symbol.asyncIterator`. Fixed by removing `"dom"` — Node.js 18+ exposes TextEncoder as a global via `@types/node`, no dom lib needed.
- **iOS build not verified**: Phase 6 adds `react-native-vision-camera` (PairServerScreen) and @stablelib packages. Expo/RN bare workflow iOS build not smoke-tested. Verify in Phase 7 or on first iOS device test; pay attention to vision-camera pod install and Hermes compatibility.

## From Phase 7a
- `orchestration-helpers.ts` is a new seam not explicitly specified in 07-final-phases.md — it was needed to get context.ts under 300 lines. The seam is coherent (thread-building and snapshot logic) and stable. Phase 7b can locate it predictably.
- `rpc-engine.ts` makeTransportEngine sends JSON strings via `JSON.parse(msg)` round-trip — the RpcEngine accepts a string-based send function but transport expects bytes. This works correctly (encodeJsonMessage handles it) but could be simplified. Low priority; no functional impact.
