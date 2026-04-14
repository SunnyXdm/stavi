# Phase follow-ups

## From Phase 1 verification
- Streaming `replaceMessage` has no coalescing — every text-delta writes to SQLite. Profile in Phase 3; batch only if write amplification shows up.
- `context.ts` is 496 lines (over 400-line limit). Accumulated across phases. Split candidates: extract `sessionSubscriptions` plumbing, extract process/terminal spawn helpers. Target before Phase 3 or when it crosses 600.