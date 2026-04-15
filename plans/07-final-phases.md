# Stavi Final Phases — Replacing Phase 7

Authored by: Opus 4.6 (lead architect)
Supersedes: Phase 7 in `plans/00-master-plan.md`
Grounded in: Theme audit (2026-04-15), `plans/followups.md`, `DESIGN.md`, codebase inspection.
Executor: Sonnet 4.6, one phase at a time.

## Why Phase 7 was split

The original Phase 7 conflated three distinct workstreams:

1. **Functional cleanup** — deferred bugs, tech debt from Phases 1–6, and real-use gaps
2. **Explorer bulk file manager** — the original Phase 7 scope
3. **DESIGN.md visual compliance** — a specification that did not exist when the master plan was written

Each has different risk profiles and different "done" definitions. Mixing them into a single phase creates a big-bang commit that's hard to verify and easy to regress. The restructured plan below gives each workstream its own phase, ordered so each is independently shippable.

### Phase ordering rationale

- **7a (Functional cleanup)** first: fixes tech debt that would otherwise be copy-pasted into 7b and 7c. Also makes the codebase easier to work in for the later phases (smaller files, fewer footguns).
- **7b (Design token alignment)** second: updates `tokens.ts` and sweeps hardcoded values out of components. This is a token-only pass — it changes colors, fonts, and radii, but does NOT redesign layouts or add new UX. After 7b, every component speaks the same visual language.
- **7c (Explorer + system-search)** third: the bulk file manager and the system-search implementation. These are new features that should be built on the final token system, not retrofitted.
- **7d (Loading/error/empty states + docs)** last: polish pass that touches every screen — easier and safer after the token system is settled.

---

## Phase 7a — Functional Cleanup

### Goal

Resolve every deferred item from `plans/followups.md` and fix structural violations of the master plan's legibility rules (400-line limit, no module-level mutable state). No new features, no visual changes. The app looks and behaves identically after this phase; the codebase is cleaner.

### Files touched

| Status | Path | What changes |
|---|---|---|
| SPLIT | `packages/server-core/src/context.ts` (496 lines) | Extract `subscriptions.ts` (session/orchestration/terminal/git subscription plumbing) and `process-spawn.ts` (managed process spawn helpers). Target: `context.ts` ≤300 lines, each extracted file ≤200 lines. |
| SPLIT | `apps/mobile/src/stores/stavi-client.ts` (654 lines) | Extract `rpc-engine.ts` (request/response machinery, timeout handling, message serialization) from the class body. Target: `stavi-client.ts` ≤400 lines, `rpc-engine.ts` ≤300 lines. |
| MODIFIED | `apps/mobile/src/navigation/SettingsScreen.tsx` | Replace `savedConnections[0]` with a server list. Show all connected servers with per-server disconnect buttons. |
| MODIFIED | `packages/server-core/src/repositories/message-repo.ts` | Add write coalescing: batch `replaceMessage` calls within a 50ms window into a single transaction. Use a simple `setTimeout` + `Map<id, pending>` pattern. |
| MODIFIED | `apps/mobile/src/plugins/workspace/terminal/index.tsx` | Surface `status: 'error'` sessions in the UI — show a red banner with the error message and a "Retry" button. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` (or hooks) | Surface `handleSend` errors as a dismissible error banner above the composer, not just `console.error`. |
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Add an `ActivityIndicator` to the loading state (currently blank screen). |

### Order of operations

1. **Split `context.ts`.** Extract subscription Maps and their `broadcast*`/`subscribe*` helpers into `subscriptions.ts`. Extract `spawnManagedProcess` and related helpers into `process-spawn.ts`. Update imports in `server.ts`, all handlers, and tests. Run `tsc --noEmit`.
2. **Split `stavi-client.ts`.** Extract the `_sendRequest`, `_handleResponse`, `_sendSubscription`, `_handleChunk`, timeout/retry logic into `rpc-engine.ts` as a standalone class or set of functions. `StaviClient` delegates to it. Run `tsc --noEmit`.
3. **SettingsScreen multi-server.** Replace `savedConnections[0]` with `Object.values(connectionsById)`. Render a section per server with name, status, and a disconnect/forget button. Remove the single "Disconnect" button.
4. **Message write coalescing.** In `message-repo.ts`, add a `PendingWrites` class that buffers `replaceMessage` calls and flushes them in a single `BEGIN/COMMIT` transaction after 50ms of quiet. Expose `flush()` for tests.
5. **Terminal error UI.** In terminal plugin, when a session has `status: 'error'`, render a `View` with `colors.semantic.errorSubtle` background, the error text, and a Retry button that calls `terminal.open` again.
6. **AI send error UI.** Wrap the `handleSend` call in a try/catch. On error, set an `errorMessage` state. Render a dismissible banner (tap X to dismiss) between the message list and the composer.
7. **WorkspaceScreen loading.** Replace the blank `styles.loading` view with an `ActivityIndicator` centered on `colors.bg.base`.

### Edges and gotchas

- **`context.ts` split must not break the `ctx` object shape.** The extracted files export functions that close over or accept `ctx` as a parameter. Do NOT make `ctx` a class — keep it as a plain object.
- **`stavi-client.ts` split must preserve reconnect semantics.** The RPC engine must be reconstructable on reconnect (new WebSocket → new engine instance, same pending-request queue drained with errors).
- **Message coalescing must not lose the final message.** On server shutdown, call `flush()` synchronously before closing the DB.
- **SettingsScreen may need a ScrollView** if the user has many servers. Use `FlatList` with `ListHeaderComponent` for the settings header.
- **Do NOT touch visual tokens in this phase.** 7a is functional-only.

### Verification script (`plans/7a-verify.md`)

```
Phase 7a verification

1. File size check
   - wc -l packages/server-core/src/context.ts → ≤300
   - wc -l apps/mobile/src/stores/stavi-client.ts → ≤400
   - wc -l packages/server-core/src/subscriptions.ts → exists, ≤200
   - wc -l apps/mobile/src/stores/rpc-engine.ts → exists, ≤300
   - tsc --noEmit → zero errors

2. SettingsScreen multi-server
   - Connect two servers. Open Settings.
   - PASS: both servers listed with status and disconnect buttons.
   - Disconnect server 1 from Settings. PASS: server 1 section shows "Disconnected".

3. Message write coalescing
   - Start a Claude turn that generates 20+ streaming tokens.
   - Check SQLite: SELECT COUNT(*) FROM messages WHERE thread_id = ?
   - PASS: message row count is small (1–3), not 20+. The final message text is complete.

4. Terminal error surface
   - Kill a running terminal's PTY process from the host.
   - PASS: terminal tab shows a red error banner with a Retry button.
   - Tap Retry. PASS: terminal reopens.

5. AI send error surface
   - Disconnect server mid-compose. Tap Send.
   - PASS: error banner appears above composer. Tap X to dismiss.

6. WorkspaceScreen loading
   - Navigate to a session. PASS: spinner visible during load, not blank screen.
```

---

## Phase 7b — DESIGN.md Token Alignment

### Goal

Align every visual token in `tokens.ts` with `DESIGN.md` and sweep all hardcoded color/spacing/radius values out of components. After this phase, the app's dark mode matches the DESIGN.md specification. Light mode infrastructure is stubbed but not implemented (that's out of scope per the master plan's explicit exclusion list). No layout or UX changes — only paint.

### Token-system audit summary (performed 2026-04-15)

The codebase has a well-structured token system in `apps/mobile/src/theme/tokens.ts` that is widely adopted (~90% of components import from it). However, the **token values themselves diverge from DESIGN.md** on almost every core color:

| Token | Current value | DESIGN.md value | Delta |
|---|---|---|---|
| `bg.base` | `#161616` | `#08090a` | Major — near-black vs dark gray |
| `bg.raised` | `#212121` | `#0f1011` | Major |
| `bg.overlay` | `#2a2a2a` | `#191a1b` | Major |
| `bg.elevated` | `#333333` | `#222327` | Major |
| `accent.primary` | `#5fccb0` (mint teal) | `#5e6ad2` (indigo) | **Completely different hue** |
| `accent.secondary` | `#4db89d` | `#7170ff` | Completely different |
| `fg.secondary` | `#c0c0c0` | `#d0d6e0` | Hue shift (neutral → cool blue-gray) |
| `semantic.success` | `#4ade80` | `#10b981` | Different shade |
| `semantic.error` | `#f87171` | `#cf2d56` | Different shade |
| `divider` | `rgba(255,255,255,0.06)` | `rgba(255,255,255,0.08)` | Minor |
| Font family (sans) | `IBMPlexSans` | `Inter` | Different typeface |
| Font family (mono) | `JetBrainsMono` | `Berkeley Mono` | Different typeface |
| `fontSize.base` (Body) | `15` | `16` | Off by 1pt |
| Card radius | `radii.lg = 12` | `10` | Off by 2 |

Components with the most hardcoded values (furthest from compliance):
1. **`NativeTerminal.tsx`** — 20+ hardcoded colors in HTML template, no theme imports
2. **`ModelPopover.tsx`** — 8+ hardcoded rgba/hex values, off-grid spacing, shadows
3. **`system-search/index.tsx`** — zero theme imports (3 hardcoded values)
4. **`PairServerScreen.tsx`** — 6+ hardcoded colors (camera overlay context)
5. **`ConfigSheet.tsx`** — 3 hardcoded provider brand colors (intentional but not extracted)

### Files touched

| Status | Path | What changes |
|---|---|---|
| REWRITTEN | `apps/mobile/src/theme/tokens.ts` | All color values updated to DESIGN.md. New tokens added: `bg.surfaceAlt`, `accent.subtle`/`accent.glow` recomputed from new accent hue. `radii.card: 10` added. `fontSize.base: 16`. Font families updated to `Inter`/`Berkeley Mono` with fallback chain. Light mode token set added (exported as `lightColors`, not wired to context yet). |
| MODIFIED | `apps/mobile/src/theme/styles.ts` | Recompute all pre-composed styles from updated tokens. No structural changes. |
| NEW | `apps/mobile/src/theme/provider-brands.ts` | Extract provider brand colors (`#7C3AED` Claude, `#10B981` Codex, `#F97316` OpenCode, `#6B6B6B` Cursor, `#4285F4` Gemini) into a typed map. These are NOT theme tokens — they are fixed brand assets. |
| MODIFIED | `apps/mobile/src/plugins/workspace/terminal/NativeTerminal.tsx` | Replace all hardcoded colors in HTML template with interpolated `colors.terminal.*` and `colors.bg.*` values. Replace hardcoded font with `typography.fontFamily.mono` (with fallback). |
| MODIFIED | `apps/mobile/src/components/ModelPopover.tsx` | Replace all hardcoded `rgba()` values with theme tokens. Replace `fontSize: 10` with `typography.fontSize.xs` (11). Replace `fontSize: 11, fontWeight: '700'` inline style with `textStyles` reference. Remove `shadowColor` (dark-mode anti-pattern per DESIGN.md). Import and use `providerBrands` map. Replace off-grid spacing (`paddingVertical: 10`) with `spacing[3]` (12). |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/components/ConfigSheet.tsx` | Import and use `providerBrands` map instead of hardcoded hex colors. |
| MODIFIED | `apps/mobile/src/plugins/server/system-search/index.tsx` | Add theme imports. Replace `color: '#888'` → `colors.fg.muted`, `padding: 24` → `spacing[6]`, `fontSize: 14` → `typography.fontSize.sm`. |
| MODIFIED | `apps/mobile/src/navigation/PairServerScreen.tsx` | Replace `'#000'` with `colors.bg.base` where appropriate. Replace `'rgba(0,0,0,0.5)'` with `colors.bg.scrim`. Keep `'#fff'` for camera overlay contrast elements (add comment explaining why). |
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Replace `backgroundColor: '#000'` scrim with `colors.bg.scrim`. |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/components/Composer.tsx` | Replace off-grid `paddingVertical: 5` and `gap: 5` with nearest grid values (`spacing[1]` = 4 or `spacing[2]` = 8). |
| MODIFIED | `apps/mobile/src/plugins/server/monitor/index.tsx` | Replace raw `borderRadius: 8` with `radii.md`. |
| NEW | `apps/mobile/android/app/src/main/assets/fonts/Inter-*.ttf` | Inter font files (Regular, Medium, SemiBold, Bold). |
| NEW | `apps/mobile/android/app/src/main/assets/fonts/BerkeleyMono-*.ttf` | Berkeley Mono font files (Regular, Medium, Bold) — OR fall back to `JetBrainsMono` if Berkeley Mono is not available (it's a paid font). |
| MODIFIED | `react-native.config.js` or equivalent | Register new font assets. |

### Order of operations

1. **Decision checkpoint: font families.** Berkeley Mono is a paid font. If not available, keep JetBrainsMono as mono and switch sans from IBMPlexSans to Inter (Inter is free/open-source). Update DESIGN.md's monospace spec to "JetBrains Mono" if Berkeley Mono is unavailable. **The executor should check whether Berkeley Mono font files exist anywhere in the repo or on the developer's machine before proceeding.**
2. **Install Inter font.** Download Inter (variable or static weights: Regular 400, Medium 500, SemiBold 600, Bold 700). Place in the font assets directory. Run the RN font linking command (`npx react-native-asset` or equivalent).
3. **Update `tokens.ts`.** Apply all DESIGN.md color values. Add `radii.card: 10`. Update `fontSize.base` to `16`. Update font family references. Add `lightColors` as a parallel export (not wired to any context/provider — just the values, for future use). Recompute `accent.subtle` and `accent.glow` rgba values from the new `#5e6ad2` accent.
4. **Update `styles.ts`.** Regenerate pre-composed styles from updated tokens. Check every `textStyles` and `surfaceStyles` entry.
5. **Create `provider-brands.ts`.** Extract all provider brand colors into a typed map.
6. **Sweep `NativeTerminal.tsx`.** Build the HTML template string using template literals that interpolate `colors.terminal.*` and `colors.bg.base`. Replace hardcoded `'Menlo, Monaco, monospace'` with `'${typography.fontFamily.mono}, monospace'`.
7. **Sweep `ModelPopover.tsx`.** Replace every hardcoded value. Remove shadows. Use provider-brands map.
8. **Sweep `ConfigSheet.tsx`.** Use provider-brands map.
9. **Sweep `system-search/index.tsx`.** Add theme imports, replace 3 values.
10. **Sweep `PairServerScreen.tsx`.** Replace where appropriate, annotate where `'#fff'` is intentional.
11. **Sweep `WorkspaceScreen.tsx`.** Replace scrim color.
12. **Sweep `Composer.tsx`.** Fix off-grid spacing.
13. **Sweep `MonitorPlugin`.** Replace raw `borderRadius: 8`.
14. **Final grep audit.** `grep -rn "#[0-9a-fA-F]\{3,8\}" apps/mobile/src --include="*.tsx" --include="*.ts" | grep -v theme | grep -v node_modules | grep -v provider-brands | grep -v assets` — every remaining hit must be justified (font asset references, SVG brand icons in `Icons.tsx`, test files).

### Contracts

**`apps/mobile/src/theme/provider-brands.ts`** (new file):

```typescript
// WHAT: Fixed brand colors for third-party AI providers.
// WHY:  These are NOT theme tokens — they are brand assets that do not change
//       with dark/light mode. Extracting them prevents hardcoded hex values
//       scattered across ConfigSheet and ModelPopover.
// HOW:  Imported by provider-selection UI. Never by the theme system.
// SEE:  theme/tokens.ts (for actual theme tokens)

export const providerBrands = {
  claude:   { color: '#7C3AED', label: 'Claude' },
  codex:    { color: '#10B981', label: 'Codex' },
  opencode: { color: '#F97316', label: 'OpenCode' },
  cursor:   { color: '#6B6B6B', label: 'Cursor' },
  gemini:   { color: '#4285F4', label: 'Gemini' },
} as const;

export type ProviderId = keyof typeof providerBrands;
```

**Updated `tokens.ts` color structure** (key changes only):

```typescript
export const colors = {
  bg: {
    base: '#08090a',         // was #161616
    raised: '#0f1011',       // was #212121 — DESIGN.md "Panel Background"
    overlay: '#191a1b',      // was #2a2a2a — DESIGN.md "Surface Background"
    surfaceAlt: '#222327',   // NEW — DESIGN.md "Surface Alt"
    elevated: '#222327',     // was #333333
    input: '#0d0e0f',        // recomputed: between base and raised
    active: '#2a2d30',       // recomputed for new palette
    scrim: 'rgba(0, 0, 0, 0.5)',
  },
  fg: {
    primary: '#f7f8f8',      // was #fafafa
    secondary: '#d0d6e0',    // was #c0c0c0 — now cool blue-gray per DESIGN.md
    tertiary: '#8a8f98',     // was #9e9e9e — DESIGN.md "Muted Text"
    muted: '#62666d',        // was #666666 — DESIGN.md "Subtle Text"
    onAccent: '#ffffff',     // recomputed for indigo accent
  },
  accent: {
    primary: '#5e6ad2',      // was #5fccb0 — Linear indigo
    secondary: '#7170ff',    // was #4db89d — DESIGN.md "Accent Hover/Active"
    subtle: 'rgba(94, 106, 210, 0.12)',  // recomputed
    glow: 'rgba(94, 106, 210, 0.25)',    // recomputed
  },
  semantic: {
    success: '#10b981',      // was #4ade80
    warning: '#f59e0b',      // was #fbbf24
    error: '#cf2d56',        // was #f87171
    info: '#60a5fa',         // unchanged
    // subtle variants recomputed from new base colors
  },
  divider: 'rgba(255, 255, 255, 0.08)', // was 0.06
  // ... terminal colors and utility unchanged
};

// Light mode values (not wired to any provider — exported for future use)
export const lightColors = {
  bg: {
    base: '#f2f1ed',
    raised: '#ebeae5',
    overlay: '#e6e5e0',
    surfaceAlt: '#dedcd6',
    // ...
  },
  // ... full light mode palette from DESIGN.md §2
} as const;
```

### Edges and gotchas

- **Accent hue change is the highest-risk visual change.** Every active tab, button, selection highlight, and focus ring changes from mint teal to indigo. This is intentional per DESIGN.md but will be visually dramatic. Verify every interactive element.
- **Near-black background (`#08090a`) may cause contrast issues on AMOLED screens** where true black pixels turn off. Test on a real device with an AMOLED display. If it's problematic, bump to `#0a0b0c` (still very dark but avoids the AMOLED cutoff).
- **`NativeTerminal.tsx` HTML template interpolation:** The template is built at component mount time. Token values are static (no runtime theme switching), so interpolation is safe. But ensure the HTML string doesn't break if a token value contains a `'` character (it won't — they're all hex/rgba).
- **Font installation on Android vs iOS.** Android uses `assets/fonts/`. iOS may need the fonts added to the Xcode project and `Info.plist`. The executor should verify the RN font linking mechanism for the current RN version.
- **`lightColors` export is intentionally inert.** No `ThemeProvider`, no `useColorScheme`, no conditional rendering. It's just a data export for a future phase (explicitly out of scope). Do NOT add any runtime theme switching in 7b.
- **Provider brand colors in SVG icons (`Icons.tsx`)** are intentionally hardcoded SVG fill values representing brand logos. Do NOT tokenize them. They are the equivalent of an image asset.
- **Body font size change (15 → 16) will subtly affect every text-heavy screen.** Review the AI chat, git diff, and terminal for overflow or clipping.

### Verification script (`plans/7b-verify.md`)

```
Phase 7b verification

1. Token value spot-check
   - Read tokens.ts. Verify:
     - bg.base === '#08090a'
     - accent.primary === '#5e6ad2'
     - fg.secondary === '#d0d6e0'
     - semantic.error === '#cf2d56'
     - radii.card === 10
     - fontSize.base === 16

2. Visual regression — accent color
   - Open SessionsHome. Active session row accent → indigo, not teal.
   - Open Workspace. Active bottom tab → indigo underline/tint.
   - AI plugin: send button → indigo.
   - PASS: no mint teal visible anywhere.

3. Visual regression — background depth
   - SessionsHome: app background is near-black (#08090a).
   - Server section cards are slightly lighter.
   - Session rows slightly lighter than section background.
   - PASS: clear 3-layer depth progression, darker than before.

4. Font check
   - Open AI plugin. Body text renders in Inter (not IBM Plex Sans).
   - Open Terminal. Monospace text renders in JetBrains Mono (or Berkeley Mono if installed).

5. Hardcoded color grep
   - grep -rn "#[0-9a-fA-F]\{3,8\}" apps/mobile/src --include="*.tsx" --include="*.ts" \
       | grep -v node_modules | grep -v theme/ | grep -v provider-brands | grep -v Icons.tsx \
       | grep -v assets/ | grep -v __tests__
   - PASS: zero hits (or only justified exceptions with inline comments).

6. NativeTerminal theme sync
   - Open a terminal. Type `ls --color`.
   - PASS: ANSI colors match colors.terminal.* in tokens.ts (visually — exact hex verification via screenshot if needed).

7. Provider brand colors
   - Open model picker (ModelPopover).
   - Claude provider dot → purple (#7C3AED).
   - PASS: dots are visually distinct, not from theme accent.

8. tsc --noEmit → zero errors.
9. Metro bundle → no errors.
10. App launches and navigates through SessionsHome → Workspace → AI → Terminal → Home without crash.
```

---

## Phase 7c — Explorer Bulk File Manager + System Search

### Goal

Replace the Explorer plugin's basic flat file list with a full bulk-ops file manager (multi-select, batch move/copy/delete, metadata view, breadcrumb navigation). Implement system-search (replacing the Phase 0 stub). Both features are new UI built on the final token system from 7b.

### Files touched

| Status | Path | What changes |
|---|---|---|
| REWRITTEN | `apps/mobile/src/plugins/shared/explorer/index.tsx` | New Explorer shell: breadcrumb bar, toolbar, FlashList body. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/ExplorerList.tsx` | FlashList of entries with checkbox selection mode. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/ExplorerToolbar.tsx` | Context-sensitive toolbar: appears when selection > 0. Buttons: Move, Copy, Delete, Zip. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/BreadcrumbBar.tsx` | Horizontal scroll of path segments. Tap segment to navigate. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/EntryMetaSheet.tsx` | Bottom sheet showing file metadata: size, modified time, permissions, type, full path. |
| NEW | `apps/mobile/src/plugins/shared/explorer/components/DestinationPicker.tsx` | Modal for choosing a move/copy destination. Reuses `DirectoryPicker` internally. |
| NEW | `apps/mobile/src/plugins/shared/explorer/store.ts` | Explorer state: `cwd`, `entries`, `selection`, `isSelecting`, `sortBy`, `showHidden`. |
| MODIFIED | `packages/server-core/src/handlers/fs.ts` | Add RPCs: `fs.stat`, `fs.batchMove`, `fs.batchCopy`, `fs.batchDelete`, `fs.zip`, `fs.unzip`. |
| REWRITTEN | `apps/mobile/src/plugins/server/system-search/index.tsx` | Real implementation: search across the entire host machine using `fs.grep` scoped to common paths. |
| NEW | `apps/mobile/src/plugins/server/system-search/components/SearchResults.tsx` | FlashList of search results with file path, match preview, and tap-to-open. |

### Order of operations

1. **New `fs` RPCs on server.** Implement in `handlers/fs.ts`:
   - `fs.stat { path }` → `{ size, mtime, atime, mode, isDirectory, isFile, isSymlink }`
   - `fs.batchDelete { paths }` → chunk stream `{ type: 'progress'|'done'|'error', path?, error? }`
   - `fs.batchMove { paths, destination }` → chunk stream (same shape)
   - `fs.batchCopy { paths, destination }` → chunk stream (same shape)
   - `fs.zip { paths, destination }` → chunk stream (same shape + final `{ size }`)
   - `fs.unzip { source, destination }` → chunk stream
   Each operation validates that all paths are within `ctx.workspaceRoot` or a known Session folder. Reject path traversal attempts.
2. **Explorer store.** Zustand store with per-session state:
   ```typescript
   interface ExplorerState {
     cwdBySession: Record<string, string>;
     entriesBySession: Record<string, FsEntry[]>;
     selectionBySession: Record<string, Set<string>>;
     isSelectingBySession: Record<string, boolean>;
     sortByBySession: Record<string, 'name' | 'modified' | 'size'>;
     showHiddenBySession: Record<string, boolean>;
     loadingBySession: Record<string, boolean>;
     errorBySession: Record<string, string | null>;
   }
   ```
3. **BreadcrumbBar.** Horizontal `ScrollView` with path segments derived from `cwd` relative to `session.folder`. Root segment = session title or folder basename. Tap any segment to `navigate(segment)`. Style: `colors.fg.muted` for inactive, `colors.fg.primary` for active (last), separator = `>` in `colors.fg.muted`.
4. **ExplorerList.** FlashList of `FsEntry` items. Each row: checkbox (visible only in selection mode), icon (folder/file type), name, size (files), modified time. Long-press a row → enter selection mode and toggle that row. Tap in selection mode → toggle selection. Tap outside selection mode → navigate (folder) or open in editor (file via `eventBus.emit('editor.openFile', ...)`).
5. **ExplorerToolbar.** Appears above the list when `selection.size > 0`. Buttons:
   - Delete → confirmation alert → `fs.batchDelete`
   - Move → `DestinationPicker` → `fs.batchMove`
   - Copy → `DestinationPicker` → `fs.batchCopy`
   - Zip → auto-name `archive-<timestamp>.zip` in current dir → `fs.zip`
   - Info → if single selection, open `EntryMetaSheet`
   - Open in Terminal → `eventBus.emit('terminal.openHere', { sessionId, cwd: selectedDir })`
   - Open in Editor → `eventBus.emit('editor.openFile', ...)` for each selected file
6. **EntryMetaSheet.** Bottom sheet. Calls `fs.stat` on the selected path. Shows: name, full path (copyable), size (human-readable), modified, type, permissions (octal). Style per DESIGN.md §4 sheets.
7. **DestinationPicker.** Wraps `DirectoryPicker` in a modal with a "Move here" / "Copy here" confirmation button. Receives `onSelect(destinationPath)` callback.
8. **Explorer `index.tsx` rewrite.** Composes: `BreadcrumbBar` (top) + `ExplorerToolbar` (conditional) + `ExplorerList` (body). Pull-to-refresh. Sort toggle in header. Show/hide hidden files toggle. Loading state: `ActivityIndicator`. Error state: error message + retry button. Empty state: "This folder is empty" with option to create new file/folder.
9. **System search implementation.** Replace the stub with a real UI:
   - Search input at top.
   - On submit, calls `fs.grep { pattern: query, glob: '*' }` (searches file contents) and `fs.search { query }` (searches file names).
   - Results in a FlashList: file path, match line preview, line number.
   - Tap result → if inside a Session's folder, `eventBus.emit('editor.openFile', ...)`. If outside, show a toast "File not in any open session."
   - System search is server-scoped, so it searches `ctx.workspaceRoot` (the server's launch directory). This is intentional — it's the "system-wide" search vs. workspace-search which is session-folder-scoped.

### Contracts

```typescript
// New fs RPCs — all in packages/server-core/src/handlers/fs.ts
// Document each in docs/PROTOCOL.md

// fs.stat
//   payload: { path: string }
//   Exit.Success: { size: number; mtime: number; atime: number; mode: number;
//                   isDirectory: boolean; isFile: boolean; isSymlink: boolean }

// fs.batchDelete
//   payload: { paths: string[] }
//   Chunk: { type: 'progress', path: string, index: number, total: number }
//        | { type: 'error', path: string, error: string }
//        | { type: 'done', deletedCount: number }

// fs.batchMove / fs.batchCopy
//   payload: { paths: string[]; destination: string }
//   Chunk: same shape as batchDelete

// fs.zip
//   payload: { paths: string[]; destination: string }
//   Chunk: { type: 'progress', path: string }
//        | { type: 'done', size: number, destination: string }
//        | { type: 'error', error: string }

// fs.unzip
//   payload: { source: string; destination: string }
//   Chunk: { type: 'progress', path: string }
//        | { type: 'done', extractedCount: number }
//        | { type: 'error', error: string }
```

```typescript
// Explorer store — apps/mobile/src/plugins/shared/explorer/store.ts
export interface ExplorerStore {
  cwdBySession: Record<string, string>;
  entriesBySession: Record<string, FsEntry[]>;
  selectionBySession: Record<string, Set<string>>;  // paths
  isSelectingBySession: Record<string, boolean>;
  sortByBySession: Record<string, 'name' | 'modified' | 'size'>;
  showHiddenBySession: Record<string, boolean>;
  loadingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;

  navigate(sessionId: string, path: string): Promise<void>;
  refresh(sessionId: string): Promise<void>;
  toggleSelection(sessionId: string, path: string): void;
  selectAll(sessionId: string): void;
  clearSelection(sessionId: string): void;
  enterSelectionMode(sessionId: string): void;
  exitSelectionMode(sessionId: string): void;
  setSortBy(sessionId: string, sort: 'name' | 'modified' | 'size'): void;
  toggleShowHidden(sessionId: string): void;
}
```

### Edges and gotchas

- **Explorer is `scope: 'workspace'` in practice** (it operates on `session.folder`) but is in `plugins/shared/` because the master plan put it there. It receives workspace plugin props. Do not move it.
- **Don't re-implement the file tree.** Explorer uses a flat list with breadcrumbs — the tree lives in the Editor (Phase 4a). Explorer is for bulk operations. These are complementary, not duplicative.
- **Batch ops must stream progress** — the mobile shows a progress sheet. Use the existing chunk mechanism. Each chunk includes `index` and `total` for progress bar computation.
- **`fs.zip` / `fs.unzip`** — use Bun's built-in `Bun.file` and `node:zlib` / a zip library. Check if `archiver` or `adm-zip` is in server-core's deps; if not, use `tar` (Bun has native tar support). **Decision for executor: if no zip library is available, implement `batchDelete`, `batchMove`, `batchCopy` only and stub zip/unzip as "Coming soon."**
- **System search performance.** `fs.grep` on a large filesystem can be slow. Add a `timeout: 10000` to the RPC call. If the server doesn't respond, show "Search timed out — try a more specific query."
- **Path traversal guard is critical.** Every batch operation must validate that every path in `paths[]` and the `destination` are within `ctx.workspaceRoot` or a Session's `folder`. Use `path.resolve()` + `startsWith()` check. Reject with a clear error, not a silent skip.

### Verification script (`plans/7c-verify.md`)

```
Phase 7c verification

1. Explorer navigation
   - Open Explorer in a session. PASS: breadcrumb shows session folder.
   - Tap a subfolder. PASS: breadcrumb updates, list shows subfolder contents.
   - Tap the root breadcrumb segment. PASS: back to session folder.

2. Explorer multi-select + delete
   - Long-press a file → selection mode activates, file is checked.
   - Tap two more files → three checked.
   - Tap Delete → confirmation dialog → confirm.
   - PASS: files removed from list. Server confirms deletion via fs.list.

3. Explorer move
   - Select two files. Tap Move → DestinationPicker opens.
   - Pick a subfolder. Tap "Move here".
   - PASS: files disappear from current dir, appear in the subfolder.

4. Explorer copy
   - Select a file. Tap Copy → pick destination.
   - PASS: original file still exists, copy exists in destination.

5. Explorer metadata
   - Select one file. Tap Info.
   - PASS: EntryMetaSheet shows size, modified time, permissions, full path.

6. Explorer → Editor integration
   - Tap a file (not in selection mode).
   - PASS: Editor opens with that file in a new tab.

7. Explorer → Terminal integration
   - Long-press a folder → select → Tap "Open in Terminal".
   - PASS: Terminal opens with cwd = that folder.

8. System search
   - Open Tools sheet → System Search.
   - Search for a known filename or content string.
   - PASS: results appear with file paths and match previews.
   - Tap a result that is inside a session folder.
   - PASS: Editor opens the file.

9. Batch operation progress
   - Select 10+ files. Tap Delete.
   - PASS: progress indicator visible during deletion (not instant for 10+ files).

10. Path traversal rejection
    - Via a scratch WS client, send fs.batchDelete { paths: ['/etc/passwd'] }.
    - PASS: server rejects with "path outside workspace" error.
```

---

## Phase 7d — Loading/Error/Empty States + Documentation

### Goal

Every screen and plugin in the app has explicit, well-designed loading, error, and empty states. Ship `docs/MENTAL-MODEL.md` for AI agent onboarding. Add structured telemetry logging. This is the final polish pass.

### Files touched

| Status | Path | What changes |
|---|---|---|
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Error state for session-load failure (not just "not found" — also network error). |
| MODIFIED | `apps/mobile/src/plugins/workspace/editor/index.tsx` | Top-level loading state while editor WebView initializes. Empty state when no file is open: icon + "Open a file from the file tree" message. Error state if WebView fails to load. |
| MODIFIED | `apps/mobile/src/plugins/workspace/terminal/index.tsx` | Error state for failed terminal opens (already partially done in 7a — this phase adds the visual polish per DESIGN.md tokens). |
| MODIFIED | `apps/mobile/src/plugins/workspace/ai/index.tsx` | Error state for snapshot fetch failure. Loading skeleton while snapshot loads (replace raw ActivityIndicator with a skeleton row pattern). |
| MODIFIED | `apps/mobile/src/plugins/workspace/git/index.tsx` | Error state for failed git operations (stage, commit, push, pull) — show a dismissible error banner per operation. |
| MODIFIED | `apps/mobile/src/plugins/workspace/browser/index.tsx` | Loading state while WebView loads a URL. Error state for unreachable URLs. |
| MODIFIED | `apps/mobile/src/plugins/shared/explorer/index.tsx` | (Already has loading/empty from 7c — this phase adds error state refinement: network error vs. permission denied vs. path not found.) |
| MODIFIED | `apps/mobile/src/navigation/SessionsHomeScreen.tsx` | Reconnection polish: greyed sections, spinner overlay, toast on reconnect. (Partially exists — polish the visual treatment per DESIGN.md.) |
| NEW | `apps/mobile/src/components/StateViews.tsx` | Shared components: `LoadingView`, `ErrorView`, `EmptyView`. Each takes an icon, title, subtitle, and optional action button. Styled per DESIGN.md — centered, calm, using `colors.fg.muted` for subtitles. |
| NEW | `docs/MENTAL-MODEL.md` | One-page architecture onboarding doc. |
| NEW | `apps/mobile/src/services/telemetry.ts` | `logEvent(event, props)` helper that writes structured `console.log` with `{ telemetry: { event, sessionId?, serverId?, timestamp } }` shape. |
| MODIFIED | `apps/mobile/src/stores/sessions-store.ts` | Add telemetry calls on session create/open/close. |
| MODIFIED | `apps/mobile/src/navigation/WorkspaceScreen.tsx` | Add telemetry call on session open. |

### Order of operations

1. **Create `StateViews.tsx`.** Three components:
   ```typescript
   // LoadingView: ActivityIndicator + optional message
   // ErrorView: AlertTriangle icon + title + subtitle + optional "Retry" button
   // EmptyView: custom icon + title + subtitle + optional CTA button
   // All use theme tokens. All are centered flex containers.
   ```
2. **Sweep every plugin and screen.** For each, add the missing states using `StateViews` components:
   - **Editor:** `EmptyView` when no file open (icon: `FileCode`, title: "No file open", subtitle: "Open a file from the tree or Explorer"). `LoadingView` while WebView mounts. `ErrorView` if WebView `onError` fires.
   - **Terminal:** `ErrorView` for failed opens (icon: `AlertTriangle`, title: "Terminal failed to start", subtitle: error message, action: "Retry").
   - **AI:** `LoadingView` with skeleton rows during snapshot fetch. `ErrorView` for snapshot fetch failure with retry.
   - **Git:** Dismissible `ErrorBanner` component (not full-screen — inline at the top of the relevant tab section). Shows the git operation that failed and the error message.
   - **Browser:** `LoadingView` with a progress bar during page load. `ErrorView` for unreachable URLs.
   - **Explorer:** Error state refinement — parse the server error to show "Permission denied", "Path not found", or "Network error" with appropriate messaging.
3. **Reconnection UX polish.** In SessionsHome:
   - Disconnected server section: grey overlay with subtle pulsing animation (using `motion.duration.slow`).
   - On reconnect success: `ReconnectToast` (already exists — verify it uses the updated tokens from 7b).
4. **Telemetry service.** `logEvent(event, props)` writes to `console.log` with the structured shape. Events: `session.created`, `session.opened`, `session.closed`, `ai.turnStarted`, `ai.turnCompleted`, `terminal.opened`, `editor.fileOpened`, `server.connected`, `server.disconnected`. Non-blocking, no network calls — console only.
5. **`docs/MENTAL-MODEL.md`.** One page. Diagram, definitions, "what changed in this refactor" history. Structure:
   ```markdown
   # Stavi Mental Model
   ## Diagram (ASCII)
   ## Definitions (Server, Session, Thread, Connection, Workspace, Plugin Scope)
   ## Data flow (RPC lifecycle)
   ## What changed (Phase 0–7d summary, 3 sentences per phase)
   ## Where to start reading code (5 entry points with file paths)
   ```

### Edges and gotchas

- **`StateViews` must not impose layout.** They should be drop-in replacements for the content area of each plugin, occupying `flex: 1` of the parent. They should NOT add their own navigation chrome or padding beyond what `surfaceStyles.base` provides.
- **Skeleton rows vs. ActivityIndicator:** For the AI plugin, use a skeleton pattern (3 grey rectangles simulating message bubbles) rather than a spinner. This is the Intercom-inspired "warmth" that DESIGN.md §8 calls for in AI surfaces. For all other plugins, a simple centered `ActivityIndicator` is fine.
- **Telemetry is console-only.** No analytics SDK, no network calls, no PII. Just structured logs that can be grepped from `adb logcat` or Flipper. Do NOT add a telemetry opt-in/opt-out UI — it's developer-facing only.
- **`docs/MENTAL-MODEL.md` must be accurate to post-7d state.** Write it last, after all other changes in 7d are committed.
- **Error banners in Git plugin should be dismissible** (tap X) and auto-dismiss after 5 seconds. Use `setTimeout` + `Animated.timing` for the dismiss animation.
- **Do NOT add retry logic for failed AI turns.** The error banner surfaces the failure; the user can re-send manually. Auto-retry risks duplicate API calls.

### Verification script (`plans/7d-verify.md`)

```
Phase 7d verification

1. Editor empty state
   - Open Editor with no file selected.
   - PASS: centered message "No file open" with icon and hint text.

2. Editor error state
   - Simulate WebView load failure (e.g., corrupt bundle path).
   - PASS: ErrorView with "Editor failed to load" and retry button.

3. Terminal error state
   - Attempt to open a terminal with an invalid cwd.
   - PASS: error banner with retry button (from 7a, now visually polished).

4. AI loading skeleton
   - Connect to a slow server (or add artificial delay to getSnapshot).
   - PASS: skeleton rows visible while loading, then replaced by real content.

5. AI snapshot error
   - Disconnect server before snapshot fetch completes.
   - PASS: ErrorView with "Couldn't load conversations" and retry button.

6. Git error banner
   - Attempt git push on a repo with no remote.
   - PASS: dismissible error banner at top of Changes tab.
   - Wait 5s. PASS: banner auto-dismisses.

7. Reconnection polish
   - Kill server 1. SessionsHome server 1 section is greyed with pulsing animation.
   - Restart server 1. PASS: toast "Reconnected to <server name>". Section un-greys.

8. Telemetry
   - Open adb logcat | grep telemetry.
   - Create a session. PASS: log line { telemetry: { event: 'session.created', ... } }.
   - Open a terminal. PASS: log line { telemetry: { event: 'terminal.opened', ... } }.

9. Mental model doc
   - Open docs/MENTAL-MODEL.md.
   - PASS: contains ASCII diagram, all 7 definitions, 5 entry points, and phase history.
   - A reader unfamiliar with the codebase can describe Session vs Thread in one sentence each.

10. Full smoke test
    - Cold launch → SessionsHome → add server → create session → AI (send message) →
      Terminal (run command) → Editor (open file) → Git (view status) → Explorer (navigate) →
      Home → back to session → Settings → Home.
    - PASS: no crashes, no blank screens, no uncaught errors in logcat.
```

---

## Summary of all phases

| Phase | Goal | Key risk | Estimated size |
|---|---|---|---|
| 7a | Functional cleanup | `stavi-client.ts` split may affect reconnect | Small (7 files) |
| 7b | DESIGN.md token alignment | Accent color change is visually dramatic | Medium (12+ files, font install) |
| 7c | Explorer + system-search | Batch fs ops, path traversal security | Large (10+ new/rewritten files, new RPCs) |
| 7d | Loading/error/empty + docs | Must touch every plugin | Medium (10+ files, mostly small edits) |

Each phase is independently shippable. The app works after every phase commits, even if later phases haven't run yet. 7a and 7b have no feature dependencies on each other (they could technically run in parallel, but 7a first is recommended for cleaner code during 7b). 7c must follow 7b (new UI should use final tokens). 7d must follow 7c (it polishes states in 7c's new Explorer).
