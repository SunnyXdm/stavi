// WHAT: Structured telemetry helper — console-only event logging for developer diagnostics.
// WHY:  Phase 7d requires observable telemetry for key user flows (session lifecycle,
//       AI turns, terminal opens, server connections). Console-only: no analytics SDK,
//       no network calls, no PII. Grep from adb logcat or Flipper via '[telemetry]'.
// HOW:  Single logEvent(event, props?) function writing to console.log with a
//       consistent shape: { event, ts, ...props }. Non-blocking.
// SEE:  apps/mobile/src/stores/sessions-store.ts, apps/mobile/src/navigation/WorkspaceScreen.tsx
//
// NOTE: Event names (session.opened, session.created, etc.) are intentionally machine-readable
//       and kept as-is. The UI displays "workspace" but telemetry retains "session" for
//       stable log analysis across all phases. See Phase 8b terminology note in plans/.

export function logEvent(event: string, props?: Record<string, unknown>): void {
  console.log('[telemetry]', { event, ts: Date.now(), ...props });
}
