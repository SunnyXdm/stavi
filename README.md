# Stavi

**Control your AI coding agent from your phone.**

Stavi is a mobile IDE for AI coding agents. Run a lightweight server on your development machine, open the Stavi app on your phone, and get a native interface to everything the agent is doing — real terminal, streaming AI chat, full git operations, and a file browser.

Built on React Native 0.85 (New Architecture), Bun, and a typed WebSocket RPC protocol.

---

## What It Does

| Feature | Details |
|---------|---------|
| **AI agents** | Claude (Anthropic) and Codex (OpenAI) with real streaming, extended thinking, tool calls, and approval workflows |
| **Terminal** | Native PTY via Termux on Android. Full ANSI rendering, cursor movement, resizing, keyboard |
| **Git** | Stage, unstage, commit, push, pull, discard. Branch list with checkout. Commit history |
| **File browser** | Navigate project files. Open in the code viewer |
| **Plugin system** | All tabs are plugins. Add new capabilities without touching core code |

---

## Quick Start

### On your machine

```bash
npx stavi serve
```

```
  ◆ Stavi server running

  Address:  192.168.1.5:3773
  Token:    sk-sess-abc123...

  Enter these in the Stavi mobile app to connect.
```

### On your phone

Open Stavi → tap **Add Server** → paste the address and token.

Or, during development, tap **Connect to This Machine** — it auto-fills from `yarn dev` output.

---

## Architecture

```
Your Phone                  Your Machine
┌───────────────────┐       ┌──────────────────────────────────────┐
│                   │       │                                      │
│  Stavi Mobile     │◀─────▶│  Stavi Server          Your Project  │
│  React Native     │  WS   │  Bun + WebSocket  ───▶  Files, Git  │
│  Native terminal  │       │  AI providers     ───▶  Claude API  │
│  Plugin panels    │       │  PTY manager      ───▶  Shell       │
│                   │       │                                      │
└───────────────────┘       └──────────────────────────────────────┘
         │                                   ▲
         │             ┌───────────────────┐  │
         └────────────▶│  Stavi Relay      │──┘   (optional,
                       │  Bun + WebSocket  │       for remote
                       └───────────────────┘       access)
```

**Server** (`packages/server-core`) — Manages AI providers, PTY terminals, git, and files. Speaks a compact JSON RPC protocol over WebSocket (`Request` / `Chunk` / `Exit`).

**Mobile** (`apps/mobile`) — React Native 0.85 with Fabric (New Architecture). All tabs are plugins mounted into an opacity-swap renderer so WebViews and terminals stay alive when you switch tabs.

**CLI** (`apps/cli`) — `npx stavi serve`. Starts the server, writes connection details, and optionally issues tokens.

**Relay** (`apps/relay`) — Optional Bun WebSocket proxy for remote (non-LAN) connections.

---

## Repo Layout

```
stavi/
├── apps/
│   ├── cli/            # npx stavi serve
│   ├── mobile/         # React Native mobile app
│   └── relay/          # Bun WebSocket relay
├── packages/
│   ├── server-core/    # Server: AI, PTY, git, files, RPC
│   ├── shared/         # Shared TypeScript types
│   ├── protocol/       # RPC message constructors
│   └── crypto/         # Noise NK encryption primitives
├── scripts/
│   └── dev.mjs         # Dev orchestrator (zx)
├── docs/               # Architecture, design, protocol, development
├── package.json        # Yarn 1.x workspaces + Turbo
└── turbo.json          # Build pipeline
```

---

## Development

### Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | 22+ | For Yarn and Metro |
| Yarn | 1.22 | `npm install -g yarn` |
| Bun | latest | `curl -fsSL https://bun.sh/install \| bash` |
| Android Studio | latest | With API 35 emulator + JDK 17 |
| Xcode | 16+ | With iOS 18 simulator (macOS only) |

### Install

```bash
git clone https://github.com/your-org/stavi
cd stavi
yarn install
cd apps/mobile/ios && pod install && cd ../../..
```

### Run

**Terminal 1 — start the server and Metro:**

```bash
yarn dev
```

This starts `server-core` on an available port, writes `apps/mobile/src/generated/dev-config.ts` with the connection address and token, and starts Metro on `0.0.0.0:8081`.

**Terminal 2 — launch the native app:**

```bash
# Android
cd apps/mobile && npx react-native run-android

# iOS
cd apps/mobile && npx react-native run-ios
```

**In the app** — tap **Connect to This Machine** to auto-fill the server address and token.

> Metro must be running before you launch the native app. `yarn dev` starts it automatically. If you need to restart Metro alone: `cd apps/mobile && npx react-native start --host 0.0.0.0`

### Other Commands

```bash
yarn typecheck   # TypeScript check across all packages
yarn lint        # ESLint across all packages
yarn build       # Production build (all packages)
yarn clean       # Clear build artifacts and Turbo cache
```

### Validation

Stavi does not use Jest — meaningful tests require a real device. The validation workflow is:

```bash
# 1. Static — catches type errors across all packages
yarn typecheck

# 2. Lint — catches style and correctness issues
yarn lint

# 3. On-device — run on Android emulator or iOS simulator (see above)
```

### Troubleshooting

| Symptom | Fix |
|---------|-----|
| Stale JS bundle | `cd apps/mobile && npx react-native start --reset-cache` |
| Native module missing | `cd apps/mobile/android && ./gradlew clean`, then re-run |
| Pod issues (iOS) | `cd apps/mobile/ios && pod deintegrate && pod install` |
| Metro binding to wrong host | Always run Metro with `--host 0.0.0.0` |
| Android emulator can't reach server | Server address is `10.0.2.2:<port>` (not `localhost`) |

---

## AI Provider Setup

### Claude (Anthropic)

Set `ANTHROPIC_API_KEY` in your environment before running `yarn dev`:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
yarn dev
```

Or paste the key in the app: **Settings → Claude API Key**.

Available models: Claude Opus 4, Claude Sonnet 4, Claude Haiku 3.5.

Extended thinking is supported on Opus 4 and Sonnet 4.

### Codex (OpenAI)

Install the Codex CLI and authenticate:

```bash
npm install -g @openai/codex
codex auth login
```

Stavi detects the `codex` binary on `$PATH` automatically. If not found, Codex is hidden from the model picker.

---

## Tech Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| Mobile | React Native 0.85 (Fabric, Hermes) | New Architecture required for Fabric native views |
| Terminal (Android) | Termux `TerminalView` (Fabric component) | Mature VT100 emulator, hardware-accelerated |
| Terminal (iOS) | SwiftTerm (planned) | Matches native quality of Android terminal |
| AI — Claude | `@anthropic-ai/sdk` streaming | Server-Sent Events, native streaming |
| AI — Codex | `codex app-server` JSON-RPC subprocess | Codex CLI handles auth, sandboxing |
| State | Zustand 5.0 + AsyncStorage | Minimal, reactive, persisted |
| Navigation | React Navigation 7 (native stack) | Native navigation primitives |
| Server runtime | Bun | Native PTY, fast startup, TypeScript out of the box |
| Server protocol | JSON RPC over WebSocket | Simple, debuggable, typed |
| Monorepo | Yarn 1.x workspaces + Turborepo 2.x | Parallel builds, caching, task pipelines |
| React Compiler | `babel-plugin-react-compiler` 1.0.0 | Auto-memoization via Babel transform |

---

## Architectural Constraints

These decisions are locked and must not be changed without understanding the downstream impact:

1. **Terminal = native views.** The Android terminal is a Fabric codegen component wrapping `TerminalView`. Never replace with a WebView or JS-side canvas.

2. **`react@19.2.3` exactly.** RN 0.85.0 ships `react-native-renderer` compiled against `19.2.3`. Other versions cause renderer mismatches.

3. **Fabric everywhere.** All new native components must use codegen specs (`NativeComponent` or `NativeModule`). The Android `TerminalView` bridges through the legacy interop layer by necessity — do not extend that pattern.

4. **Opacity-swap, never unmount.** Plugin panels toggle `opacity: 0` / `pointerEvents: 'none'` when inactive. Unmounting a panel would destroy terminal state, WebView history, and editor buffers.

5. **`babel-plugin-react-compiler@1.0.0` exactly.** Not `^19.x`. The compiler generates `useMemoCache` calls that require React canary internals — the pinned version is compatible with `react@19.2.3`.

6. **`react-native-worklets/plugin` last in Babel.** The worklets Babel plugin must be the final plugin in the chain. `react-native-reanimated/plugin` is not used.

7. **`@react-native-async-storage/async-storage@2.2.0`.** Version 3+ has a broken Maven artifact that fails Gradle builds.

---

## Documentation

| Doc | Contents |
|-----|---------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, AI provider pipeline, streaming, data flow diagrams |
| [DESIGN.md](docs/DESIGN.md) | Design system tokens, component patterns, anti-patterns |
| [DEVELOPMENT.md](docs/DEVELOPMENT.md) | Setup, running, building, common issues, per-platform notes |
| [PROTOCOL.md](docs/PROTOCOL.md) | WebSocket RPC wire protocol — all methods, events, shapes |

---

## License

Private.
