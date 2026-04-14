# Stavi Editor Bundle

CodeMirror 6 bundle loaded by the Editor plugin's WebView. This directory is **self-contained** — its `package.json` is scoped to this folder only. Do not add `@codemirror/*` packages to `apps/mobile/package.json`.

## Build

```bash
# One-time build (run from this directory)
cd apps/mobile/assets/editor
npm install
npm run build
# Output: bundle.js (committed to git)
```

## Watch mode

```bash
npm run build:watch
```

## Files

| File | Purpose |
|------|---------|
| `src/index.ts` | Entry point — sets up CodeMirror and the postMessage bridge |
| `src/bridge.ts` | Handles messages from/to React Native (JsToWeb / WebToJs) |
| `src/theme.ts` | Dark theme matching Stavi design tokens |
| `src/languages.ts` | Language pack registry |
| `bundle.js` | **Built artifact** — committed to git, loaded by WebView |
| `index.html` | HTML host page — loads bundle.js |
| `build.mjs` | esbuild configuration |
| `package.json` | Scoped deps (@codemirror/*, esbuild) |

## Adding the bundle to React Native

**Android:** `file:///android_asset/editor/index.html`  
**iOS:** Use the bundled assets directory path (see EditorSurface.tsx).

The bundle is NOT added to Metro. It is loaded from the `assets/` directory via WebView `source={{ uri }}`.

## Bridge protocol

See `src/bridge.ts` for the full `JsToWeb` / `WebToJs` message shape. Key flow:

1. WebView loads, CodeMirror initializes, sends `{ type: 'ready' }`.
2. React Native side queues all `JsToWeb` messages until `ready` is received.
3. `loadFile { path, content, language }` populates the editor.
4. `contentChanged { content, dirty }` is sent on every edit.
5. Save: `requestContent { requestId }` → `contentResponse { requestId, content }`.
