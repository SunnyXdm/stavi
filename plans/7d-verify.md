# Phase 7d — Verification Script

Run these checks after completing Phase 7d to confirm all done-criteria are met.

## 1. TypeScript compilation (zero errors)

```bash
cd packages/server-core && npx tsc --noEmit
cd packages/shared      && npx tsc --noEmit
cd packages/crypto       && npx tsc --noEmit
cd packages/protocol     && npx tsc --noEmit
cd apps/mobile           && npx tsc --noEmit
cd apps/cli              && npx tsc --noEmit
```

## 2. No raw ActivityIndicator outside StateViews

```bash
# Should return ONLY StateViews.tsx itself
grep -rn 'ActivityIndicator' apps/mobile/src/ --include='*.tsx' --include='*.ts' \
  | grep -v 'node_modules' \
  | grep -v 'StateViews.tsx'
```

Any match = a plugin/screen still using inline loading instead of `<LoadingView>`.

## 3. No hardcoded colors/fonts/spacing

```bash
# Should return zero matches (excluding comments, imports, and theme files)
grep -rn '#[0-9a-fA-F]\{3,8\}' apps/mobile/src/ --include='*.tsx' --include='*.ts' \
  | grep -v 'node_modules' \
  | grep -v 'theme/' \
  | grep -v '// ' \
  | grep -v 'PairServerScreen' # camera overlay intentionally hardcoded
```

## 4. File line counts (all under 400)

```bash
wc -l apps/mobile/src/components/StateViews.tsx
wc -l apps/mobile/src/services/telemetry.ts
wc -l apps/mobile/src/components/ReconnectToast.tsx
wc -l docs/MENTAL-MODEL.md
```

## 5. StateViews uses only tokens

```bash
# Verify no inline hex colors in StateViews
grep '#[0-9a-fA-F]' apps/mobile/src/components/StateViews.tsx
# Should return nothing
```

## 6. Telemetry breadcrumbs present

```bash
grep -rn 'logEvent(' apps/mobile/src/ --include='*.tsx' --include='*.ts' \
  | grep -v 'node_modules' \
  | grep -v 'telemetry.ts'
# Expected: connection.ts, sessions-store.ts, WorkspaceScreen.tsx,
#           useOrchestrationActions.ts, terminal/index.tsx, explorer/index.tsx
```

## 7. ReconnectToast uses zIndex token

```bash
grep 'zIndex' apps/mobile/src/components/ReconnectToast.tsx
# Should show: zIndex: zIndex.toast — NOT a hardcoded number
```

## 8. Empty states are specific (not generic)

```bash
grep -rn 'EmptyView\|ErrorView\|LoadingView' apps/mobile/src/plugins/ --include='*.tsx' \
  | grep -v 'import'
# Verify each usage has a specific title/subtitle, not "Something went wrong"
```

## 9. MENTAL-MODEL.md exists and is under 200 lines

```bash
wc -l docs/MENTAL-MODEL.md
# Should be < 200
```

## 10. followups.md updated

```bash
grep 'CLOSED-IN-7D\|DEFERRED' plans/followups.md
# Should show items marked as closed or deferred
```
