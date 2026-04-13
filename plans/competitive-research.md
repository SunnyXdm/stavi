# Competitive Research: t3code vs lunel vs stavi
_Written: 2026-04-12_

## The Space

All three are "code on your phone, run on your machine" apps. Mobile AI coding agents.

---

## t3code

**What it is:** Web + desktop app (not mobile-first). Electron desktop + React web client.

**Architecture:**
- Effect-TS event-sourced server with SQLite persistence
- `OrchestrationEngine` → `ProjectionPipeline` → `ProviderCommandReactor` → `ProviderRuntimeIngestion`
- Each layer is 20-50KB of Effect-TS code
- Manages Codex via a full `codexAppServerManager` (50KB!) that spawns and manages the Codex HTTP server lifecycle
- Claude via claude-agent-sdk

**Why we can't just use their packages:**
- Deeply coupled to Effect-TS (`Layer`, `Effect`, `Stream`) throughout
- Their Codex integration is tightly coupled to their session/checkpoint system
- Would require adopting their entire runtime just to get provider routing
- Not designed to be embedded — it's a monolith

**UI patterns worth copying:**
- Compact popover model picker (not full-screen modal)
- Provider icons + COMING SOON rows for future providers
- Checkmarks on selected items (left-aligned)
- Branch indicator in bottom bar
- Effort: "Extra High / High (default) / Medium / Low"

---

## lunel

**What it is:** Mobile-first (Expo/React Native) + cloud relay. Closest competitor to stavi.

**Architecture:**
```
Mobile app (Expo) ──WebSocket──► cloud proxy/manager ──WebSocket──► lunel-cli (your machine)
                                  (gateway.lunel.dev)
```

**Key insight — they don't implement AI themselves:**
- OpenCode: wraps `@opencode-ai/sdk` → `createOpencodeServer()` → local HTTP server on random port → `createOpencodeClient()` to talk to it
- Codex: wraps Codex similarly  
- The CLI (`lunel-cli`) starts these servers, relays events to the app
- App is a pure rendering client — no AI logic at all

**Why this works so well:**
- OpenCode handles Claude, GPT-4, Gemini, Anthropic, etc. — all providers
- Multi-turn, tool calls, streaming, permissions all handled by OpenCode's battle-tested server
- lunel just forwards events, never re-implements streaming

**AI event flow in lunel:**
```
OpenCode HTTP server
  → SSE events (streaming)
  → OpenCodeProvider.subscribe() listener
  → AiEventEmitter (tagged with backend name)
  → CLI data channel (WebSocket to proxy)
  → App data channel
  → useAI() onDataEvent handler
  → Panel.tsx state update
```

**Notable lunel features we should have:**
- Dual backend: opencode + codex simultaneously, routed by `backend` field
- Voice input (transcribe endpoint)
- File attachments in prompts
- Session revert/unrevert (undo a turn)
- Share session (URL)
- Permission reply (approve/reject tool use) + Question reply (structured answers)
- `@lobehub/icons-rn` for provider icons (npm package with all AI provider logos)

**lunel's weakness vs stavi:**
- Relay-only — no direct LAN option. Stavi supports both.
- Expo (not bare RN) — limits native module options
- 4335-line single Panel.tsx — unmaintainable monolith
- Manager (relay server) is also a 4263-line single file

---

## stavi — our position

**Architecture:**
```
Mobile (bare RN) ──WebSocket──► local server (Bun) ──subprocess──► Claude/Codex CLI
                   (direct LAN)   server-core/         providers/
```

**Our advantages over both:**
1. **Direct LAN + relay** — both options: direct for home/office, relay for remote. lunel is relay-only.
2. **Bare React Native** — can use any native modules (NativeTerminalView, Skia, etc.)
3. **Plugin system** — extensible (terminal, git, editor, AI, monitor, ports, search)
4. **Simpler server** — one file, easy to understand and extend
5. **Mobile-first UI** — designed for touch from day one

**Our current gaps vs both:**
1. AI integration has P0 bugs (multi-turn broken, wrong CWD) — see architecture-analysis.md
2. No voice input
3. No file attachments in AI prompts
4. No session revert/unrevert
5. Only Claude + Codex (no OpenCode = no multi-provider)
6. ConfigSheet is full-screen modal instead of compact popover

---

## Strategic Options

### Option A: Fix existing adapters (Claude + Codex only)
- Fix 3 P0 bugs in `claude.ts` and `server.ts`
- Ship working multi-turn conversations
- Fast (few hours)
- Leaves multi-provider gap

### Option B: Add OpenCode adapter alongside Claude/Codex  
- Add `OpenCodeAdapter` using `@opencode-ai/sdk`
- Gets Claude + GPT + Gemini + all other providers for free
- lunel proved this works
- Medium effort (~1 day)
- Still fix the P0 bugs for the direct Claude/Codex path

### Option C: Pivot to OpenCode as primary backend
- Like lunel but without the cloud relay
- OpenCode runs locally on user's machine
- Server just relays OpenCode events
- Simplest server code, best provider coverage
- Gives up direct claude-agent-sdk control

**Recommended: Option A first (fix bugs, ship), then Option B (add OpenCode)**

---

## Provider icon package

`@lobehub/icons-rn` — lunel uses this. Has icons for:
Claude, OpenAI, Gemini, Mistral, Cohere, etc.
Install: `yarn add @lobehub/icons-rn`
