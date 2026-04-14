# Stavi Vision & Product Direction
_Written: 2026-04-12_

## What We're Building

A **mobile AI coding app** that connects directly to your machine over LAN (no cloud relay).
Better than t3code (mobile-first, not web/desktop) and lunel (direct LAN, no privacy leaks).

Target: Developer who wants to code from their phone while their laptop runs the heavy work.

---

## Core Differentiators

Both direct LAN and relay — best of both worlds. lunel forces you through their cloud; stavi lets you choose.

| Feature | t3code | lunel | stavi |
|---------|--------|-------|-------|
| Mobile-first | ✗ (web/desktop) | ✓ | ✓ |
| Direct LAN | ✗ | ✗ (relay only) | ✓ |
| Relay (remote access) | ✗ | ✓ | ✓ |
| Plugin system | ✗ | limited | ✓ |
| Native terminal | ✗ | Rust PTY | NativeTerminalView |
| Claude Code | ✓ | via OpenCode | ✓ (direct SDK) |
| Codex | ✓ | ✓ | ✓ |
| OpenCode | ✗ | ✓ | planned |
| Voice input | ✗ | ✓ | planned |
| File attachments | ✓ | ✓ | planned |

---

## Plugin Architecture (stavi's killer feature)

The plugin system is what makes stavi extensible. Each plugin:
- Has its own panel (tab in the app)
- Can expose an API via GPI (cross-plugin calls)
- Can be core (always present) or extra (optional)

**Current plugins:**
- `ai` — AI chat (Claude, Codex)
- `terminal` — Full terminal with NativeTerminalView (native PTY rendering)
- `git` — Git operations
- `editor` — File editor
- `monitor` — System monitoring
- `ports` — Port scanner
- `search` — File search
- `explorer` — File explorer

**This plugin architecture is stavi's real moat.** t3code has a fixed feature set.
lunel has a similar structure but in Expo (more limited). Stavi can add new plugins
without touching core code.

---

## Near-term Roadmap

### Phase 1: Fix what's broken ✅ COMPLETE
See `architecture-analysis.md`.
- ✅ Fix multi-turn Claude conversations
- ✅ Fix CWD not being passed
- ✅ Fix thread.created broadcast
- ✅ Compact model picker (ModelPopover)
- ✅ Provider icons (ProviderIcon.tsx)

### Phase 2: UI feel & tab UX
See `ui-redesign.md` for full phase breakdown.
- Phase 2-1: AnimatedPressable (spring press), remove bottom bar border, haptics
- Phase 2-2: Header tab strip for multi-instance switching, animated bottom indicator, proper bottom sheet
- Phase 2-3: Reanimated drawer, ThinkingIndicator on native thread, fix scrollToEnd race

### Phase 3: Composer & feature parity with lunel
See `ui-redesign.md` Phase 4.
- Fix Access chip icon
- Voice input (expo-av + /api/transcribe)
- File attachments in AI prompts
- Session revert/unrevert

### Phase 4: Theme system
See `ui-redesign.md` Phase 5.
- Theme singleton adapter (useThemeColors hook)
- Light theme tokens
- System auto-switch + settings toggle

### Phase 5: Surpass both
- OpenCode adapter (all providers: GPT, Gemini, etc.)
- Multi-agent workflows (AI plugin calls terminal plugin via GPI)
- Offline mode with local models (Ollama)
- Native code editing with LSP support

---

## Server Design Principles

Keep `server.ts` simple — it's a strength, not a weakness.

**Do:**
- Stay as a single WebSocket RPC server
- Add new RPC handlers as needed
- Use Bun for performance (spawn, PTY, etc.)

**Don't:**
- Add Effect-TS or heavy abstractions
- Implement persistence for MVP (in-memory is fine)
- Re-implement what OpenCode/claude-agent-sdk already does well

---

## Mobile App Design Principles

From lunel's DESIGN.md (worth adopting):
- "Depth through color, not lines" — no borders, use background layering
- Background layers: bg.base → bg.raised → bg.overlay → bg.elevated
- Text via opacity on a single foreground color (primary 100%, secondary 60%, tertiary 40%)
- Accent color used sparingly — only for actions, active states, links
- Touch targets ≥ 44px
- Never use borders to separate elements

The stavi theme tokens already follow most of this — good.
