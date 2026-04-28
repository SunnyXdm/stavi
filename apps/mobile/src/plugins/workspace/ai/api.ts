// ============================================================
// AI Plugin — GPI API (cross-plugin calls)
// ============================================================
// Extracted from ai/index.tsx (Phase 8g split).
// getClient falls back to savedConnections[0] — known limitation
// (see followups.md Phase 5: GPI serverId context not threaded through).

import type { AIPluginAPI } from '@stavi/shared';
import { useConnectionStore } from '../../../stores/connection';

export function getClient(serverId?: string) {
  const state = useConnectionStore.getState();
  const resolvedServerId = serverId ?? state.savedConnections[0]?.id;
  return resolvedServerId ? state.getClientForServer(resolvedServerId) : undefined;
}

export function aiApi(): AIPluginAPI {
  return {
    sendMessage: async (text, threadId) => {
      const messageId = `msg-${Date.now()}`;
      const commandId = `cmd-${Date.now()}`;
      const config = await getClient()?.request<any>('server.getConfig', {});
      const providers = Array.isArray(config?.providers) ? config.providers : [];
      const selectedProvider =
        providers.find((p: any) => p?.authenticated && p?.installed) ??
        providers.find((p: any) => p?.installed) ?? null;
      const selectedModel = Array.isArray(selectedProvider?.models)
        ? selectedProvider.models.find((m: any) => m?.isDefault) ?? selectedProvider.models[0]
        : null;

      await getClient()?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.start',
          commandId,
          threadId: threadId || '',
          message: { messageId, role: 'user', text, attachments: [] },
          modelSelection:
            selectedProvider?.provider && (selectedModel?.id || selectedModel?.slug)
              ? { provider: selectedProvider.provider, modelId: selectedModel.id ?? selectedModel.slug }
              : undefined,
          runtimeMode: 'approval-required',
          interactionMode: 'default',
          createdAt: new Date().toISOString(),
        },
      });
      return { threadId: threadId || '', turnId: commandId };
    },

    interruptTurn: async (threadId) => {
      await getClient()?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.turn.interrupt',
          commandId: `cmd-${Date.now()}`,
          threadId: threadId || '',
          createdAt: new Date().toISOString(),
        },
      });
    },

    respondToApproval: async (threadId, requestId, decision) => {
      await getClient()?.request('orchestration.dispatchCommand', {
        command: {
          type: 'thread.approval.respond',
          commandId: `cmd-${Date.now()}`,
          threadId: threadId || '',
          requestId: requestId || '',
          decision: decision || 'accept',
          createdAt: new Date().toISOString(),
        },
      });
    },

    listThreads: async () => {
      const snapshot = await getClient()?.request<{ threads: any[] }>('orchestration.getSnapshot', {});
      return (snapshot?.threads || []).map((t: any) => ({ id: t.threadId || t.id, title: t.title }));
    },
  };
}
