# Phase follow-ups

## From Phase 1 verification
- Streaming `replaceMessage` has no coalescing — every text-delta writes to SQLite. Profile in Phase 3; batch only if write amplification shows up.
- `context.ts` is 496 lines (over 400-line limit). Accumulated across phases. Split candidates: extract `sessionSubscriptions` plumbing, extract process/terminal spawn helpers. Target before Phase 4 or when it crosses 600.

## From Phase 2 verification
- `apps/mobile/src/stores/stavi-client.ts` is 573 lines (over 400-line limit). Pre-existing condition, not a Phase 2 regression. Split candidate: extract the RPC request/response machinery from the class body. Target in Phase 7 polish, or sooner if it crosses 700.

## From Phase 4 real-use testing
- Overall visual design does not yet conform to DESIGN.md (Linear/Cursor/Intercom direction, token system, dark-mode-first). Every phase so far has targeted behavior, not style. Address in Phase 7 polish — see DESIGN.md at repo root.
- DirectoryPicker visually broken/ugly. Functional (NewSessionFlow works), but needs a pass. Phase 7 or earlier if it blocks new-session flow usability for testing.

## From Phase 5
- GPI `terminalApi()` and `gitApi()` fall back to `savedConnections[0]` because the `api()` factory receives no `serverId` context. Annotated with console.warn. Phase 7 should pass `serverId` through the GPI call or replace direct-client calls with event-bus calls.
- `SettingsScreen.tsx` uses `savedConnections[0]` as its notion of "active connection" for the disconnect button. This is a UX legacy issue (no subscription routing risk), but it should be updated to show all servers in Phase 7.
- `addServer` is now async (pre-flights server.getConfig for dedup). If the server is offline at add-time, dedup is skipped (prefetchServerId returns null). This is best-effort and acceptable; adding an offline server works but won't dedup until next connect.

## From Phase 6
- **Relay reconnect wired (fixed in Phase 6 fix commit)**: connection.ts now schedules a fresh `connectServer()` call (→ new RelayTransport + new Noise NK handshake) when a relay-backed server enters 'reconnecting'. Uses same 1s→64s exponential backoff. Session state is NEVER reused. Pinned by `noise.test.ts` test "two successive handshakes with the same responder keypair produce different session keys".
- **CLI tsc dom lib (fixed in Phase 6 fix commit)**: Phase 6 mistakenly added `"lib": ["ES2022", "dom"]` to `apps/cli/tsconfig.json`, which caused `ReadableStream<Uint8Array<ArrayBuffer>>` in `server-core/src/context.ts` to lose `Symbol.asyncIterator`. Fixed by removing `"dom"` — Node.js 18+ exposes TextEncoder as a global via `@types/node`, no dom lib needed.
- **iOS build not verified**: Phase 6 adds `react-native-vision-camera` (PairServerScreen) and @stablelib packages. Expo/RN bare workflow iOS build not smoke-tested. Verify in Phase 7 or on first iOS device test; pay attention to vision-camera pod install and Hermes compatibility.
