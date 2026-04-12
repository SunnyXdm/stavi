# Stavi Development Guide

Mobile IDE for AI Coding Agents — Turborepo + Yarn 1.x monorepo with React Native 0.85.0.

## Prerequisites

- **Node.js** >= 22.11.0
- **Yarn** 1.22.x (classic, not Berry)
- **Bun** (latest, for server and relay)
- **macOS** with Xcode 16+ and Command Line Tools (`xcode-select --install`)
- **Android Studio** with SDK 35 (API 35)
- **JDK 17** (Android builds)
- **CocoaPods** (`brew install cocoapods`)
- **tmux** (for terminal sessions on server side)

## First-Time Setup

```bash
git clone <repo>
cd stavi
yarn install
cd apps/mobile/ios && pod install && cd ../../..
```

## Running the Stack

| Command | What it does |
|---------|-------------|
| `yarn dev` | Starts all services via Turborepo (Metro + server + relay) |
| `yarn dev:mobile` | Start Metro bundler only |
| `yarn dev:server` | Start Bun server (port 8022) |
| `yarn dev:relay` | Start relay server (port 9022) |

## Building

```bash
# Android
cd apps/mobile && npx react-native run-android

# iOS
cd apps/mobile && npx react-native run-ios
```

- **Android emulator**: connects to `10.0.2.2:8022` (maps to host localhost)
- **iOS simulator**: connects to `localhost:8022` directly

## Project Structure

```
stavi/
├── apps/
│   ├── mobile/          React Native 0.85.0 app
│   │   ├── src/
│   │   │   ├── plugins/     core/ (ai, editor, terminal, git) + extra/ (5 more)
│   │   │   ├── components/  PluginBottomBar, PluginRenderer
│   │   │   ├── navigation/  WorkspaceScreen, ConnectScreen
│   │   │   ├── stores/      connection (Zustand), plugin-registry (Zustand)
│   │   │   ├── services/    event-bus, gpi
│   │   │   ├── theme/       tokens, styles, index
│   │   │   └── assets/fonts/ IBMPlexSans, JetBrainsMono
│   │   ├── android/
│   │   ├── ios/
│   │   ├── DESIGN.md
│   │   ├── ARCHITECTURE.md
│   │   └── DEVELOPMENT.md  (this file)
│   ├── server/          Bun WebSocket server (port 8022)
│   └── relay/           Zero-knowledge relay (port 9022)
├── packages/
│   ├── shared/          Type definitions (no build step)
│   ├── protocol/        RPC message constructors
│   └── crypto/          Noise NK encryption types
├── package.json         Workspace root with resolutions
└── turbo.json           Task orchestration
```

## Monorepo Rules (CRITICAL)

1. **All native deps MUST be in apps/mobile/package.json** — autolinking only reads the app's package.json, not hoisted root.
2. **react and react-native are nohoist'd** — they live in `apps/mobile/node_modules` (not root). This is set in root `package.json` `workspaces.nohoist`.
3. **resolutions in root package.json** prevent duplicate react copies — `"react": "19.2.5"` and `"react-native": "0.85.0"` force single versions.
4. **metro.config.js uses resolveRequest hook** — NOT `extraNodeModules`. `resolveRequest` runs BEFORE hierarchical walk; `extraNodeModules` is a FALLBACK appended last.
5. **packages/shared has no build step** — consumed as raw TypeScript via tsconfig paths.
6. **moduleResolution must be "node"** in tsconfig — Metro needs this for `.ios.ts`/`.android.ts` platform resolution.

## Babel Rules (WILL BREAK YOUR BUILD IF WRONG)

1. `react-native-worklets/plugin` MUST be the **LAST** plugin in `babel.config.js`.
2. Do NOT add `react-native-reanimated/plugin` — in Reanimated v4 it re-exports `worklets/plugin`. Loading both crashes Metro with a duplicate plugin error.
3. `babel-plugin-react-compiler` version is `1.0.0` — NOT `^19.1.0` (that version doesn't exist on npm).

## Common Issues

| Issue | Cause | Fix |
|-------|-------|-----|
| "Invalid hook call" or "Cannot read property 'useContext' of null" | Duplicate React copies in bundle | Check: `find node_modules -maxdepth 3 -name react -type d`. Fix: ensure resolutions in root package.json + resolveRequest in metro.config.js |
| "Unable to resolve module @react-navigation/native" | Missing nodeModulesPaths in metro.config.js | Ensure nodeModulesPaths includes both app-local and monorepo root node_modules |
| "Could not find org.asyncstorage.shared_storage:storage-android:1.0.0" | async-storage v3+ has unpublished Maven artifact | Use v2.2.0 |
| Android emulator can't connect to server | Using "localhost" from emulator | Use `10.0.2.2` (maps to host machine's localhost) |
| Metro bundler stale cache | Cached old module resolution | `npx react-native start --reset-cache` |
| Pod install fails | Missing CocoaPods or wrong Ruby version | `brew install cocoapods` (don't use system Ruby) |
| "Duplicate babel plugin" crash on Metro start | Both reanimated/plugin and worklets/plugin in babel config | Remove `react-native-reanimated/plugin` — only keep `react-native-worklets/plugin` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `STAVI_PORT` | 8022 | Server port |
| `STAVI_HOST` | 0.0.0.0 | Server host |
| `STAVI_RELAY_PORT` | 9022 | Relay port |
| `STAVI_RELAY_HOST` | 0.0.0.0 | Relay host |

## Clearing Caches

```bash
# Metro cache
npx react-native start --reset-cache

# Gradle clean (Android)
cd apps/mobile/android && ./gradlew clean && cd ..

# Pod reinstall (iOS)
cd apps/mobile/ios && rm -rf Pods Podfile.lock && pod install && cd ..

# Full clean reinstall
cd stavi
rm -rf node_modules apps/*/node_modules packages/*/node_modules
yarn install
cd apps/mobile/ios && pod install
```

## Key Dependency Versions (pinned)

| Package | Version | Notes |
|---------|---------|-------|
| react | 19.2.5 | Pinned via resolutions |
| react-native | 0.85.0 | Pinned via resolutions + nohoist |
| react-native-reanimated | 4.3.0 | v4 — uses worklets/plugin |
| react-native-worklets | 0.8.1 | Babel plugin MUST be last |
| @react-native-async-storage/async-storage | 2.2.0 | NOT v3+ (broken Maven) |
| babel-plugin-react-compiler | 1.0.0 | NOT ^19.1.0 |
| @react-native-community/cli | 20.1.0 | Matches RN 0.85.0 |
| zustand | 5.0.12 | State management |
| lucide-react-native | 1.8.0 | Icon library |
