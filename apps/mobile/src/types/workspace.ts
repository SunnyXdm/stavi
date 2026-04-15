// WHAT: UI terminology aliases — Workspace and Chat.
// WHY:  Phase 8b renames user-facing language: Session → Workspace, Thread → Chat.
//       The wire protocol, store names, and internal identifiers are unchanged.
//       These aliases let new code use the user-facing terms while preserving
//       full structural compatibility with the underlying types.
// HOW:  Workspace re-exports Session from @stavi/shared.
//       Chat re-exports Thread from the AI orchestration hook.
// SEE:  plans/08-restructure-plan.md §Phase 8b

export type { Session as Workspace } from '@stavi/shared';
export type { Thread as Chat } from '../plugins/workspace/ai/useOrchestration';
