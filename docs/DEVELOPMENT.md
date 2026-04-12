# Development Guide

Setup, running, building, and troubleshooting for the Stavi monorepo.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Initial Setup](#2-initial-setup)
3. [Running the Apps](#3-running-the-apps)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Workspace Packages](#5-workspace-packages)
6. [Build System (Turborepo)](#6-build-system-turborepo)
7. [Android Build Configuration](#7-android-build-configuration)
8. [Metro Bundler Configuration](#8-metro-bundler-configuration)
9. [Babel Configuration](#9-babel-configuration)
10. [TypeScript Configuration](#10-typescript-configuration)
11. [Dependency Rules](#11-dependency-rules)
12. [Adding a New Package](#12-adding-a-new-package)
13. [Adding a New Plugin](#13-adding-a-new-plugin)
14. [Native Module Development](#14-native-module-development)
15. [Common Issues & Fixes](#15-common-issues--fixes)
16. [Environment Reference](#16-environment-reference)

---

## 1. Prerequisites

| Tool | Version | Notes |
|------|---------|-------|
| Node.js | >= 22.11.0 | Required by CLI and mobile |
| Yarn | 1.22.22 | Classic Yarn (not Berry/v3+). Enforced via `packageManager` field |
| Bun | Latest | Used by CLI (`bun run`) and Relay (`bun --watch`) |
| Java JDK | 17+ | Android Gradle builds |
| Android Studio | Latest | SDK Manager, emulator, Gradle integration |
| Android SDK | API 36 (compileSdk/targetSdk), API 24 (minSdk) |
| Android Build Tools | 36.0.0 |
| Android NDK | 27.1.12297006 |
| Gradle | 9.3.1 | Bundled via gradle-wrapper |
| Kotlin | 2.1.20 |
| Xcode | 15+ | iOS only (planned) |
| Git | Latest |

### Android Studio SDK Setup

In Android Studio → SDK Manager, ensure these are installed:

- **SDK Platforms:** Android 14 (API 36)
- **SDK Tools:** Android SDK Build-Tools 36.0.0, NDK 27.1.12297006, CMake
- **Environment variables:**
  ```bash
  export ANDROID_HOME=$HOME/Library/Android/sdk   # macOS
  export ANDROID_HOME=$HOME/Android/Sdk           # Linux
  export PATH=$PATH:$ANDROID_HOME/emulator:$ANDROID_HOME/platform-tools
  ```

---

## 2. Initial Setup

```bash
# 1. Clone the repository
git clone <repo-url> stavi
cd stavi

# 2. Install all workspace dependencies
yarn install

# 3. (Android) Install local Android dependencies
cd apps/mobile/android && ./gradlew dependencies && cd ../../..

# 4. Verify TypeScript across the monorepo
yarn typecheck
```

### Post-Install Checks

```bash
# Verify React version pinning (must be 19.2.3 everywhere)
yarn why react
# Should show exactly one copy: 19.2.3

# Verify react-native is nohoisted
ls apps/mobile/node_modules/react-native/package.json
# Should exist (not hoisted to root)
```

---

## 3. Running the Apps

### Stavi CLI

```bash
# Development (runs directly with Bun, no build step)
yarn dev:cli
# or
cd apps/cli && bun run dev

# Build for distribution
cd apps/cli && bun build src/index.ts --outfile dist/index.mjs --target node --format esm

# Test the built binary
node apps/cli/dist/index.mjs serve
node apps/cli/dist/index.mjs token
node apps/cli/dist/index.mjs --help
```

The CLI imports `startStaviServer()` from `@stavi/server-core` and starts the server directly (no subprocess). It prints a branded banner with the LAN address and bearer token. It uses `~/.stavi` as its base directory.

#### AI Provider Setup

The server supports two AI providers. Configure at least one:

**Claude (Anthropic):**
```bash
# Option 1: Environment variable
export ANTHROPIC_API_KEY=sk-ant-api...

# Option 2: Via the mobile app
# Connect to server → AI tab → tap model chip → "Add API Key" → paste key
# Key is stored in ~/.stavi/userdata/settings.json
```

**Codex (OpenAI):**
```bash
# Install the Codex CLI
npm install -g @openai/codex

# Verify
codex --version

# The server auto-detects codex on PATH via `which codex`
# Or set a custom path via the mobile app's settings
```

### Stavi Mobile (Android)

```bash
# Start Metro bundler (terminal 1)
yarn dev:mobile
# or
cd apps/mobile && npx react-native start

# Build and install on emulator/device (terminal 2)
cd apps/mobile && npx react-native run-android

# Or with a clean build
cd apps/mobile && npx react-native run-android --active-arch-only
```

**Important:** The first build takes 5-10 minutes (Fabric codegen + native compilation). Subsequent builds are incremental.

**Connecting from the Android emulator:**
- The emulator maps `10.0.2.2` to the host machine's `localhost`
- If the Stavi CLI is running on the same machine, use host `10.0.2.2` and port `3773` in the app

### Stavi Relay

```bash
# Development (auto-reloads on file changes)
yarn dev:relay
# or
cd apps/relay && bun --watch src/index.ts

# Build for production
cd apps/relay && bun build src/index.ts --outdir dist --target bun
```

The relay listens on port 9022 by default. Configure with `RELAY_PORT` and `RELAY_HOST` environment variables.

### Running Everything Together

```bash
# All apps in parallel via Turbo
yarn dev

# Specific combinations
turbo dev --filter=stavi --filter=@stavi/mobile
```

---

## 4. Monorepo Structure

```
stavi/
├── apps/
│   ├── cli/              # npx stavi serve — starts the server
│   │   ├── src/
│   │   │   ├── index.ts       # Entry point, arg parsing, serve/token commands
│   │   │   └── network.ts     # LAN IP detection (os.networkInterfaces)
│   │   ├── package.json       # name: "stavi", bin: stavi
│   │   └── tsconfig.json
│   │
│   ├── mobile/           # React Native mobile app
│   │   ├── src/
│   │   │   ├── App.tsx              # Root component, NavigationContainer
│   │   │   ├── navigation/          # ConnectScreen, WorkspaceScreen
│   │   │   ├── stores/              # Zustand stores (connection, plugin-registry)
│   │   │   ├── plugins/             # All feature plugins
│   │   │   │   ├── core/            # ai, editor, terminal, git
│   │   │   │   └── extra/           # explorer, search, processes, ports, monitor
│   │   │   ├── components/          # Shared components
│   │   │   ├── services/            # Event bus, GPI
│   │   │   ├── specs/               # Fabric codegen specs
│   │   │   ├── theme/               # Design tokens + shared styles
│   │   │   └── assets/fonts/        # IBM Plex Sans, JetBrains Mono
│   │   ├── android/                 # Android native project
│   │   │   └── app/src/main/java/com/stavi/
│   │   │       ├── terminal/        # NativeTerminalView (Fabric)
│   │   │       ├── MainApplication.kt
│   │   │       └── MainActivity.kt
│   │   ├── metro.config.js          # React version pinning hook
│   │   ├── babel.config.js          # react-compiler + worklets
│   │   └── package.json
│   │
│   └── relay/            # Bun WebSocket relay
│       ├── src/
│       │   └── index.ts       # Room-based WS relay
│       └── package.json
│
├── packages/
│   ├── server-core/     # @stavi/server-core — server (AI providers, terminals, git)
│   │   └── src/
│   │       ├── index.ts           # Public exports
│   │       ├── server.ts          # WebSocket RPC server
│   │       └── providers/         # AI provider system
│   │           ├── types.ts       # ProviderAdapter interface
│   │           ├── registry.ts    # ProviderRegistry
│   │           ├── claude.ts      # ClaudeAdapter (Anthropic SDK)
│   │           └── codex.ts       # CodexAdapter (Codex CLI subprocess)
│   ├── shared/           # @stavi/shared — TypeScript types (no build)
│   ├── protocol/         # @stavi/protocol — RPC message constructors (no build)
│   └── crypto/           # @stavi/crypto — Noise NK primitives (no build)
│
├── docs/
│   ├── ARCHITECTURE.md   # System design, provider system, AI streaming
│   ├── DESIGN.md         # Design tokens, patterns, anti-patterns
│   ├── DEVELOPMENT.md    # This file
│   ├── PROTOCOL.md       # Wire protocol, RPC methods, events
│   └── GAP-ANALYSIS.md   # Competitive analysis + prioritized roadmap
│
├── package.json          # Root: workspaces, resolutions, Turbo scripts
├── turbo.json            # Build pipeline config
└── tsconfig.base.json    # Shared TS compiler options
```

---

## 5. Workspace Packages

### Shared Packages (no build step)

The three packages under `packages/` are consumed as **raw TypeScript** — they have no build step. Consumers import directly from `src/index.ts`.

```json
// All three share this pattern:
{
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".":   { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": { "types": "./src/*.ts",     "default": "./src/*.ts" }
  },
  "scripts": {
    "build": "echo 'no build step - consumed as raw TS'"
  }
}
```

| Package | Purpose | Dependencies |
|---------|---------|-------------|
| `@stavi/shared` | Plugin types, domain types, event types, transport types | None |
| `@stavi/protocol` | RPC message constructors, namespace actions, type guards | `@stavi/shared` |
| `@stavi/crypto` | Noise NK frame format, crypto primitives interface | None |
| `@stavi/server-core` | Stavi server: WebSocket RPC, terminals, AI providers, git | `@anthropic-ai/sdk`, `ws` |

### Dependency Graph

```
apps/cli ──────▶ @stavi/server-core ──▶ @anthropic-ai/sdk
                                       ──▶ ws

apps/relay ─────┐
apps/mobile ────┤──▶ @stavi/shared
                ├──▶ @stavi/protocol ──▶ @stavi/shared
                └──▶ @stavi/crypto
```

### Adding to a Workspace Package

When you add a new type or utility to a shared package:

1. Add the export to `packages/<pkg>/src/index.ts`
2. No build step needed — it's immediately available
3. Run `yarn typecheck` to verify consumers pick it up

---

## 6. Build System (Turborepo)

### turbo.json Pipeline

| Task | `dependsOn` | `cache` | `persistent` | Notes |
|------|-------------|---------|-------------|-------|
| `build` | `^build` | `true` | — | Builds packages first, then apps |
| `dev` | `^build` | `false` | `true` | Long-running dev servers, no caching |
| `typecheck` | `^typecheck` | `true` | — | Upstream-aware type checking |
| `lint` | — | `true` | — | Independent, no upstream deps |
| `clean` | — | `false` | — | Removes dist/ directories |

**Global dependencies:** `tsconfig.base.json` — changing this invalidates all caches.

### Root Scripts

```bash
yarn dev          # All apps in parallel
yarn dev:cli      # CLI only (turbo dev --filter=stavi)
yarn dev:relay    # Relay only (turbo dev --filter=@stavi/relay)
yarn dev:mobile   # Mobile only (turbo dev --filter=@stavi/mobile)
yarn build        # Build everything
yarn typecheck    # Type-check everything
yarn lint         # Lint everything
yarn clean        # Clean all dist/ directories
```

### Testing

**Stavi does not use Jest.** React Native's native views (terminal, Fabric components), the Bun PTY server, and WebSocket RPC cannot be meaningfully unit-tested in a jsdom environment. The overhead of working around those limitations is not worth it.

The validation strategy is:
- **`yarn typecheck`** — catches type errors, wrong field names, bad imports, API mismatches
- **Run on device/simulator** — the only reliable test for native integration
- **`yarn lint`** — catches code style issues

To run on device, see [Section 3 — Running the Apps](#3-running-the-apps).

---

## 7. Android Build Configuration

### SDK Versions

| Property | Value | Set In |
|----------|-------|--------|
| `compileSdkVersion` | 36 | `android/build.gradle` |
| `targetSdkVersion` | 36 | `android/build.gradle` |
| `minSdkVersion` | 24 | `android/build.gradle` |
| `buildToolsVersion` | `36.0.0` | `android/build.gradle` |
| `ndkVersion` | `27.1.12297006` | `android/build.gradle` |
| `kotlinVersion` | `2.1.20` | `android/build.gradle` |

### Gradle Properties (`gradle.properties`)

| Property | Value | Purpose |
|----------|-------|---------|
| `newArchEnabled` | `true` | Enables Fabric + TurboModules (New Architecture) |
| `hermesEnabled` | `true` | Enables Hermes JS engine |
| `reactNativeArchitectures` | `armeabi-v7a,arm64-v8a,x86,x86_64` | All ABIs for development |
| `org.gradle.jvmargs` | `-Xmx2048m -XX:MaxMetaspaceSize=512m` | Gradle daemon heap size |
| `android.useAndroidX` | `true` | AndroidX compatibility |
| `edgeToEdgeEnabled` | `false` | System bar configuration |

### Termux Dependencies

Located in `android/app/build.gradle`:

```groovy
implementation 'com.github.termux.termux-app:terminal-view:v0.118.1'
implementation 'com.github.termux.termux-app:terminal-emulator:v0.118.1'
```

**JitPack repository** (required, in `android/settings.gradle`):

```groovy
dependencyResolutionManagement {
    repositoriesMode = RepositoriesMode.PREFER_SETTINGS
    repositories {
        google()
        mavenCentral()
        maven { url = uri("https://jitpack.io") }
    }
}
```

> Termux libraries are not on Maven Central — they're published via JitPack. The repository coordinates use `com.github.termux.termux-app` prefix (not just `com.termux`), and version tags include the `v` prefix.

### Native Module Registration

In-tree native modules (like `NativeTerminalView`) are **not** autolinked. They must be manually registered:

```kotlin
// MainApplication.kt
override val reactNativeHost = object : DefaultReactNativeHost(this) {
    // ...
    override fun getPackages() = PackageList(this).packages.apply {
        add(TerminalPackage())  // Manual registration
    }
}
```

### Signing

Currently using debug keystore for both debug and release builds. Production signing is not yet configured.

---

## 8. Metro Bundler Configuration

### `metro.config.js`

```javascript
const projectRoot = __dirname;                          // apps/mobile/
const monorepoRoot = path.resolve(projectRoot, '../..'); // stavi/

module.exports = mergeConfig(getDefaultConfig(projectRoot), {
  watchFolders: [monorepoRoot],  // Watch entire monorepo (for packages/)

  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),   // Local first
      path.resolve(monorepoRoot, 'node_modules'),  // Hoisted fallback
    ],

    // CRITICAL: Pin React and React Native to app-local copies
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'react' || moduleName.startsWith('react/'))
        return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [reactPath] }) };
      if (moduleName === 'react-native' || moduleName.startsWith('react-native/'))
        return { type: 'sourceFile', filePath: require.resolve(moduleName, { paths: [reactNativePath] }) };
      return context.resolveRequest(context, moduleName, platform);
    },
  },
});
```

**Why the `resolveRequest` hook?** In a monorepo, Metro's hierarchical module resolution can find multiple copies of `react` (one hoisted, one in `apps/mobile/node_modules/`). Two React instances = "Invalid hook call" crash. The hook runs before Metro's walk and forces all `react` / `react-native` imports to resolve to the app-local copy.

### Common Metro Operations

```bash
# Start with clean cache
cd apps/mobile && npx react-native start --reset-cache

# Start on a specific port
cd apps/mobile && npx react-native start --port 8082
```

---

## 9. Babel Configuration

### `babel.config.js`

```javascript
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['module:@react-native/babel-preset'],
    plugins: [
      'babel-plugin-react-compiler',
      'react-native-worklets/plugin',  // MUST be last
    ],
  };
};
```

### Plugin Order Rules

1. `babel-plugin-react-compiler` — v1.0.0 exactly (not `^19.1.0`, which is a different package)
2. `react-native-worklets/plugin` — **MUST be last**. This is a hard requirement.

> **Do not** add `react-native-reanimated/plugin`. The worklets plugin from `react-native-worklets` handles shared values. Adding Reanimated's plugin causes duplicate transforms and build failures.

---

## 10. TypeScript Configuration

### Root `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "jsx": "react-jsx",
    "lib": ["ES2022"]
  },
  "exclude": ["node_modules", "dist"]
}
```

### Mobile `tsconfig.json`

```json
{
  "extends": "@react-native/typescript-config",
  "compilerOptions": {
    "moduleResolution": "node",
    "types": ["react-native"],
    "paths": {
      "@stavi/shared":     ["../../packages/shared/src"],
      "@stavi/shared/*":   ["../../packages/shared/src/*"],
      "@stavi/protocol":   ["../../packages/protocol/src"],
      "@stavi/protocol/*": ["../../packages/protocol/src/*"],
      "@stavi/crypto":     ["../../packages/crypto/src"],
      "@stavi/crypto/*":   ["../../packages/crypto/src/*"]
    }
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "ios", "android", "build", "**/Pods"]
}
```

> The `paths` aliases let TypeScript resolve `@stavi/shared` imports to the source. Metro resolves them via Yarn workspaces. Both mechanisms must agree.

### CLI `tsconfig.json`

Standalone (does not extend `tsconfig.base.json`):

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### Relay `tsconfig.json`

Extends root, adds Bun types:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "types": ["bun-types"]
  },
  "include": ["src"],
  "references": [
    { "path": "../../packages/shared" },
    { "path": "../../packages/protocol" }
  ]
}
```

---

## 11. Dependency Rules

### Pinned Versions (Non-Negotiable)

These versions are architecturally load-bearing. Changing them will break the build:

| Package | Pinned Version | Why |
|---------|---------------|-----|
| `react` | `19.2.3` | Must match `react-native-renderer` bundled in RN 0.85.0. Not 19.2.5. |
| `react-native` | `0.85.0` | Current target. Upgrading requires verifying Fabric codegen compatibility. |
| `babel-plugin-react-compiler` | `1.0.0` | Exact version. `^19.1.0` is a different npm package with a different API. |
| `@react-native-async-storage/async-storage` | `2.2.0` | v3+ has broken Maven artifact that fails Android builds. |
| `react-native-reanimated` | `4.3.0` | Must be compatible with `react-native-worklets` 0.8.1 |

### Root `resolutions`

In the root `package.json`:

```json
"resolutions": {
  "react": "19.2.3",
  "react-native": "0.85.0"
}
```

This forces Yarn to install exactly these versions everywhere in the monorepo, even as transitive dependencies.

### `nohoist`

```json
"nohoist": [
  "**/react-native",
  "**/react-native/**"
]
```

`react-native` and all its sub-packages stay in `apps/mobile/node_modules/` instead of being hoisted to the monorepo root. This is required because:

1. Metro expects `react-native` at a specific path relative to the app
2. Android Gradle scripts resolve paths relative to `node_modules/react-native`
3. The codegen tool resolves its inputs from the app-local `node_modules`

### Adding a Dependency

```bash
# To a specific workspace:
cd apps/mobile && yarn add <package>
cd apps/cli && yarn add <package>

# To a shared package:
cd packages/shared && yarn add --dev <package>

# To root (devDependency only):
yarn add --dev -W <package>
```

---

## 12. Adding a New Package

To add a new shared package to `packages/`:

```bash
# 1. Create the directory
mkdir -p packages/my-package/src

# 2. Create package.json (follow the raw-TS pattern)
cat > packages/my-package/package.json << 'EOF'
{
  "name": "@stavi/my-package",
  "version": "0.0.1",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".":   { "types": "./src/index.ts", "default": "./src/index.ts" },
    "./*": { "types": "./src/*.ts",     "default": "./src/*.ts" }
  },
  "scripts": {
    "build": "echo 'no build step - consumed as raw TS'",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "typescript": "^5.7"
  }
}
EOF

# 3. Create tsconfig.json
cat > packages/my-package/tsconfig.json << 'EOF'
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
EOF

# 4. Create the entry point
echo 'export {};' > packages/my-package/src/index.ts

# 5. Re-install to update workspace links
yarn install
```

The new package is automatically picked up by the `"packages/*"` workspace glob.

---

## 13. Adding a New Plugin

All features are implemented as plugins. To add a new plugin:

### 1. Create the Plugin Component

```
apps/mobile/src/plugins/extra/my-plugin/index.tsx
```

```tsx
import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { PluginPanelProps } from '@stavi/shared';
import { colors, typography, spacing } from '../../../theme';

export default function MyPluginPanel({ isActive }: PluginPanelProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>My Plugin</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg.base },
  text: { color: colors.fg.primary, fontSize: typography.fontSize.base },
});
```

### 2. Register in `plugins/load.ts`

```tsx
import MyPluginPanel from './extra/my-plugin';

// Add to the extra plugins array:
registry.register({
  id: 'my-plugin',
  name: 'My Plugin',
  icon: 'Wrench',           // Lucide icon name
  category: 'extra',
  component: MyPluginPanel,
});
```

### 3. Expose an API (optional)

If other plugins need to call into yours:

1. Define the API interface in `@stavi/shared`:
   ```ts
   export interface MyPluginAPI {
     doSomething(arg: string): void;
   }
   ```

2. Register the API in your plugin's `useEffect`:
   ```ts
   registry.setApi('my-plugin', () => ({
     doSomething: (arg) => { /* ... */ },
   }));
   ```

3. Other plugins call it via GPI:
   ```ts
   gPI['my-plugin'].doSomething('hello');
   ```

### 4. Handle Events (optional)

```tsx
import { eventBus, EVENTS } from '../../../services/event-bus';

useEffect(() => {
  const unsub = eventBus.on(EVENTS.FILE_OPENED, (payload) => {
    // React to file open events
  });
  return unsub;
}, []);
```

### Plugin Rendering Rules

- Plugins are mounted lazily (first time the tab is tapped)
- Once mounted, plugins are **never unmounted** — they use opacity-swap
- Active: `opacity: 1, pointerEvents: 'auto'`
- Hidden: `opacity: 0, pointerEvents: 'none'`
- This preserves terminal sessions, WebView state, scroll positions

---

## 14. Native Module Development

### Fabric Codegen Spec

Native components use Fabric codegen. The spec file defines the interface:

```
apps/mobile/src/specs/NativeMyViewNativeComponent.ts
```

```ts
import type { ViewProps } from 'react-native';
import type { DirectEventHandler, Int32 } from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';
import codegenNativeCommands from 'react-native/Libraries/Utilities/codegenNativeCommands';

interface NativeProps extends ViewProps {
  onMyEvent?: DirectEventHandler<Readonly<{ value: string }>>;
}

export default codegenNativeComponent<NativeProps>('NativeMyView');

export const Commands = codegenNativeCommands<{
  myCommand: (viewRef: React.ElementRef<typeof NativeMyView>, arg: string) => void;
}>({ supportedCommands: ['myCommand'] });
```

### Fabric vs Old Architecture

| Aspect | Old Architecture | Fabric (New Architecture) |
|--------|-----------------|--------------------------|
| **Events** | `RCTEventEmitter.receiveEvent(reactTag, eventName, data)` | `UIManagerHelper.getEventDispatcherForReactTag()` + custom `Event<T>` subclass |
| **Commands** | `UIManager.dispatchViewManagerCommand(tag, commandId, args)` | Codegen `Commands.myCommand(ref, arg)` |
| **ViewManager** | `SimpleViewManager` + `getCommandsMap()` | `SimpleViewManager` + `NativeMyViewManagerInterface<T>` + `NativeMyViewManagerDelegate` |
| **Package** | `createViewManagers()` returning list | Same, but view manager implements codegen interface |

### Key Gotchas

1. **Custom Event subclasses** must override `getEventName()` returning the Fabric event name (e.g., `"topOnMyEvent"`)
2. **Commands receive the native view**, not a react tag — call methods directly on it
3. **Manual registration** in `MainApplication.kt` — in-tree modules aren't autolinked
4. After changing a codegen spec, run `cd android && ./gradlew generateCodegenArtifactsFromSchema` or do a clean rebuild

---

## 15. Common Issues & Fixes

### "Invalid hook call" / Duplicate React

**Symptom:** Runtime crash with "Invalid hook call. Hooks can only be called inside the body of a function component."

**Cause:** Multiple copies of `react` resolved by Metro.

**Fix:**
1. Verify root `resolutions` has `"react": "19.2.3"`
2. Verify `metro.config.js` has the `resolveRequest` hook pinning `react` and `react-native`
3. Run `yarn why react` — should show exactly one version
4. Clear Metro cache: `npx react-native start --reset-cache`

### React 19.2.3 vs 19.2.5

**Symptom:** Fatal crash on app startup with no useful error.

**Cause:** React Native 0.85.0 bundles `react-native-renderer` compiled against React 19.2.3 internals. Using 19.2.5 causes an internal API mismatch.

**Fix:** Root `resolutions` must pin to `"react": "19.2.3"`. Not 19.2.5.

### Termux Build Failure — "Could not resolve com.termux:terminal-view"

**Symptom:** Gradle fails with dependency resolution error for Termux libraries.

**Cause:** Wrong Maven coordinates or missing JitPack repository.

**Fix:**
1. Ensure `android/settings.gradle` has JitPack in `dependencyResolutionManagement`:
   ```groovy
   maven { url = uri("https://jitpack.io") }
   ```
2. Use the correct coordinates: `com.github.termux.termux-app:terminal-view:v0.118.1`
   - Note: `com.github.` prefix (JitPack convention)
   - Note: `v` prefix on version tag

### Metro "Unable to resolve module @stavi/shared"

**Symptom:** Metro can't find workspace packages.

**Fix:**
1. Verify `metro.config.js` has `watchFolders: [monorepoRoot]`
2. Verify `resolver.nodeModulesPaths` includes both app-local and root `node_modules/`
3. Run `yarn install` from the monorepo root to update symlinks

### Babel Plugin Order Error

**Symptom:** Build errors related to worklets or React compiler transforms.

**Fix:** In `babel.config.js`, `react-native-worklets/plugin` must be the **last** plugin. Do not use `react-native-reanimated/plugin` — the worklets plugin handles it.

### Gradle Build OOM

**Symptom:** Gradle daemon runs out of memory during Android builds.

**Fix:** In `gradle.properties`, increase heap:
```properties
org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m
```

### Codegen Spec Changes Not Picked Up

**Symptom:** Changes to Fabric codegen specs (in `src/specs/`) aren't reflected in the build.

**Fix:**
```bash
cd apps/mobile/android
./gradlew clean
./gradlew generateCodegenArtifactsFromSchema
cd ..
npx react-native run-android
```

### AsyncStorage v3 Maven Error

**Symptom:** Android build fails with AsyncStorage-related Maven artifact error.

**Cause:** `@react-native-async-storage/async-storage` v3+ publishes a broken Maven artifact.

**Fix:** Pin to v2.2.0 in `apps/mobile/package.json`. Do not upgrade.

### "Worklets/plugin must be last"

**Symptom:** Cryptic Babel transform errors.

**Fix:** Ensure `react-native-worklets/plugin` is the last entry in `babel.config.js` plugins array. No other plugin should come after it.

---

## 16. Environment Reference

### All Versions at a Glance

| Component | Version |
|-----------|---------|
| **Package Manager** | Yarn 1.22.22 (Classic) |
| **Build Orchestration** | Turborepo ^2.5 |
| **Node.js** | >= 22.11.0 |
| **TypeScript** | ^5.7 (root/packages), ^5.8.3 (cli/mobile) |
| **React** | 19.2.3 (pinned) |
| **React Native** | 0.85.0 (pinned) |
| **Hermes** | Enabled (bundled with RN 0.85.0) |
| **Fabric / New Architecture** | Enabled |
| **Gradle** | 9.3.1 |
| **Kotlin** | 2.1.20 |
| **Android compileSdk** | 36 |
| **Android targetSdk** | 36 |
| **Android minSdk** | 24 |
| **Android Build Tools** | 36.0.0 |
| **Android NDK** | 27.1.12297006 |
| **Termux terminal-view** | v0.118.1 |
| **Termux terminal-emulator** | v0.118.1 |
| **Reanimated** | 4.3.0 |
| **React Navigation** | 7.x |
| **Zustand** | 5.0.12 |
| **AsyncStorage** | 2.2.0 |
| **babel-plugin-react-compiler** | 1.0.0 (exact) |
| **Bun** | Latest (CLI + Relay) |
| **Relay Port** | 9022 (default) |
| **Stavi Server Port** | 3773 (default) |

### Workspace Package Names

| Directory | npm Name | Public? |
|-----------|----------|---------|
| `apps/cli` | `stavi` | Yes (publishable) |
| `apps/mobile` | `@stavi/mobile` | No (private) |
| `apps/relay` | `@stavi/relay` | No (private) |
| `packages/shared` | `@stavi/shared` | No (private) |
| `packages/protocol` | `@stavi/protocol` | No (private) |
| `packages/crypto` | `@stavi/crypto` | No (private) |

### Font Assets

Located in `apps/mobile/src/assets/fonts/`, linked via `react-native.config.js`:

| File | Family | Weight |
|------|--------|--------|
| `IBMPlexSans-Regular.ttf` | IBM Plex Sans | 400 |
| `IBMPlexSans-Medium.ttf` | IBM Plex Sans | 500 |
| `IBMPlexSans-SemiBold.ttf` | IBM Plex Sans | 600 |
| `IBMPlexSans-Bold.ttf` | IBM Plex Sans | 700 |
| `JetBrainsMono-Regular.ttf` | JetBrains Mono | 400 |
| `JetBrainsMono-Medium.ttf` | JetBrains Mono | 500 |
| `JetBrainsMono-Bold.ttf` | JetBrains Mono | 700 |

On Android, fonts are copied to `android/app/src/main/assets/fonts/` during linking.
On iOS, they're added to the Xcode project and listed in `Info.plist`.
