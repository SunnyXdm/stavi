// WHAT: Thread-building and snapshot helpers for server-side orchestration.
// WHY:  context.ts needed to stay ≤300 lines; these helpers form a coherent seam.
// HOW:  Exports createOrchestrationHelpers() closed over threads, messages, state,
//       workspaceRoot, and defaultThreadTemplate. Called once by createServerContext().
// SEE:  packages/server-core/src/context.ts,
//       packages/server-core/src/handlers/orchestration/

import type { OrchestrationMessage, OrchestrationThread } from './types';
import type { ModelSelection } from './providers/types';
import { nowIso, resolveWorkspacePath } from './utils';

// ----------------------------------------------------------
// Factory
// ----------------------------------------------------------

export function createOrchestrationHelpers(
  threads: Map<string, OrchestrationThread>,
  messages: Map<string, OrchestrationMessage[]>,
  state: { sequence: number },
  workspaceRoot: string,
  defaultThreadTemplate: OrchestrationThread,
  getGitStatus: (cwd: string) => Promise<import('./types').GitStatusPayload>,
): {
  buildThreadFromCommand: (
    threadId: string,
    command: Record<string, unknown>,
    existing?: OrchestrationThread,
  ) => OrchestrationThread;
  getSnapshot: () => Promise<unknown>;
} {
  const resolveThreadWorktreePath = (value: unknown): string => {
    if (typeof value !== 'string' || value.trim().length === 0) return workspaceRoot;
    return resolveWorkspacePath(workspaceRoot, value);
  };

  const buildThreadFromCommand = (
    threadId: string,
    command: Record<string, unknown>,
    existing?: OrchestrationThread,
  ): OrchestrationThread => {
    const createdAt =
      existing?.createdAt ??
      (typeof command.createdAt === 'string' && command.createdAt.length > 0
        ? command.createdAt
        : nowIso());
    const rawModelSelection = command.modelSelection as ModelSelection | undefined;

    return {
      ...(existing ?? defaultThreadTemplate),
      threadId,
      sessionId:
        typeof command.sessionId === 'string' && command.sessionId.length > 0
          ? command.sessionId
          : existing?.sessionId ?? defaultThreadTemplate.sessionId,
      projectId:
        typeof command.projectId === 'string' && command.projectId.length > 0
          ? command.projectId
          : existing?.projectId ?? 'project-local',
      title:
        typeof command.title === 'string' && command.title.trim().length > 0
          ? command.title
          : existing?.title ?? 'Conversation',
      runtimeMode:
        (command.runtimeMode as OrchestrationThread['runtimeMode'] | undefined) ??
        existing?.runtimeMode ??
        defaultThreadTemplate.runtimeMode,
      interactionMode:
        (command.interactionMode as OrchestrationThread['interactionMode'] | undefined) ??
        existing?.interactionMode ??
        defaultThreadTemplate.interactionMode,
      branch:
        typeof command.branch === 'string' ? command.branch : existing?.branch ?? '',
      worktreePath:
        'worktreePath' in command
          ? resolveThreadWorktreePath(command.worktreePath)
          : existing?.worktreePath ?? workspaceRoot,
      modelSelection: rawModelSelection ?? existing?.modelSelection,
      archived: existing?.archived ?? false,
      createdAt,
      updatedAt: nowIso(),
    };
  };

  const getSnapshot = async () => {
    const git = await getGitStatus(workspaceRoot);
    const threadList = Array.from(threads.values()).map((thread) => {
      const threadMessages = messages.get(thread.threadId) ?? [];
      return {
        ...thread,
        branch: git.branch,
        messages: threadMessages,
        conversation: { messages: threadMessages },
        session: { pendingApprovals: [] },
      };
    });
    return {
      snapshotSequence: state.sequence,
      threads: threadList,
      projects: [
        {
          id: 'project-local',
          projectId: 'project-local',
          workspaceRoot,
          title: workspaceRoot.split('/').pop() ?? workspaceRoot,
        },
      ],
    };
  };

  return { buildThreadFromCommand, getSnapshot };
}
