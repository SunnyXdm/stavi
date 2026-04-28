// ============================================================
// handlers/server-config.ts — server.* RPC handlers
// ============================================================

import { hostname } from 'os';
import type { ServerContext, RpcHandler } from '../context';

export function createServerConfigHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { sendJson, makeSuccess } = ctx;

  return {
    'server.getConfig': async (ws, id) => {
      sendJson(ws, makeSuccess(id, {
        cwd: ctx.workspaceRoot,
        providers: ctx.providerRegistry.getProviderInfos(),
        serverId: ctx.serverId,
        hostname: hostname(),
      }));
    },

    'server.getSettings': async (ws, id) => {
      const settings = ctx.providerRegistry.getSettings();
      const masked = { ...settings };
      if (masked.anthropicApiKey) {
        const key = masked.anthropicApiKey;
        masked.anthropicApiKey = `${key.slice(0, 8)}...${key.slice(-4)}`;
      }
      sendJson(ws, makeSuccess(id, masked));
    },

    'server.updateSettings': async (ws, id, payload) => {
      const settingsUpdate: Record<string, unknown> = {};
      if (typeof payload.anthropicApiKey === 'string') settingsUpdate.anthropicApiKey = payload.anthropicApiKey;
      if (typeof payload.defaultProvider === 'string') settingsUpdate.defaultProvider = payload.defaultProvider;
      if (typeof payload.defaultModel === 'string') settingsUpdate.defaultModel = payload.defaultModel;
      if (typeof payload.codexBinaryPath === 'string') settingsUpdate.codexBinaryPath = payload.codexBinaryPath;
      ctx.providerRegistry.updateSettings(settingsUpdate);
      await ctx.providerRegistry.refresh();
      sendJson(ws, makeSuccess(id, {
        ok: true,
        providers: ctx.providerRegistry.getProviderInfos(),
      }));
    },

    'server.refreshProviders': async (ws, id) => {
      await ctx.providerRegistry.refresh();
      sendJson(ws, makeSuccess(id, {
        providers: ctx.providerRegistry.getProviderInfos(),
      }));
    },
  };
}
