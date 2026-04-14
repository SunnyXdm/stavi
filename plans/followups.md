# Phase follow-ups

## From Phase 1 verification
- Streaming `replaceMessage` has no coalescing — every text-delta writes to SQLite. Profile in Phase 3; batch only if write amplification shows up.
- `context.ts` is 496 lines (over 400-line limit). Accumulated across phases. Split candidates: extract `sessionSubscriptions` plumbing, extract process/terminal spawn helpers. Target before Phase 4 or when it crosses 600.

## From Phase 2 verification
- `apps/mobile/src/stores/stavi-client.ts` is 573 lines (over 400-line limit). Pre-existing condition, not a Phase 2 regression. Split candidate: extract the RPC request/response machinery from the class body. Target in Phase 7 polish, or sooner if it crosses 700.

## From Phase 4 real-use testing
- Overall visual design does not yet conform to DESIGN.md (Linear/Cursor/Intercom direction, token system, dark-mode-first). Every phase so far has targeted behavior, not style. Address in Phase 7 polish — see DESIGN.md at repo root.
- DirectoryPicker visually broken/ugly. Functional (NewSessionFlow works), but needs a pass. Phase 7 or earlier if it blocks new-session flow usability for testing.
- [any other specific bugs you noticed — list them concretely, one line each, so Phase 7 has a checklist]