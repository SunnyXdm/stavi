// ============================================================
// server.ts — Bootstrap only: HTTP/WS setup, auth, dispatch loop
// ============================================================
// All RPC handler logic lives in handlers/. All shared state
// lives in context.ts. This file wires them together.

import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';

import { ProviderRegistry } from './providers/registry';
import { createServerContext, type RpcHandler } from './context';
import { getGitStatus, nowIso, sendJson, makeFailure, detectLocalIp } from './utils';

import { createGitHandlers } from './handlers/git';
import { createTerminalHandlers } from './handlers/terminal';
import { createFsHandlers } from './handlers/fs';
import { createSystemHandlers } from './handlers/system';
import { createProcessHandlers } from './handlers/process';
import { createOrchestrationHandlers } from './handlers/orchestration/index';
import { createServerConfigHandlers } from './handlers/server-config';
import { createSessionHandlers } from './handlers/session';

import type { RpcRequest, StartServerOptions, ServerConnectionConfig, StaviServer } from './types';

export type { StartServerOptions, ServerConnectionConfig, StaviServer };

export const DEFAULT_PORT = 3773;

// ----------------------------------------------------------
// Auth helpers (kept here since they depend on no handler state)
// ----------------------------------------------------------

interface StoredCredentials {
  version: 1;
  bearerToken: string;
  createdAt: string;
  serverId?: string;
}

function createToken(prefix: string) {
  return `${prefix}${randomBytes(18).toString('hex')}`;
}

function credentialsPath(baseDir: string) {
  return join(baseDir, 'userdata', 'credentials.json');
}

function runtimeStatePath(baseDir: string) {
  return join(baseDir, 'userdata', 'server-runtime.json');
}

function ensureDirFor(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function issueOrReadBearerToken(baseDir: string): string {
  const filePath = credentialsPath(baseDir);
  ensureDirFor(filePath);

  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as StoredCredentials;
      if (parsed.bearerToken) return parsed.bearerToken;
    } catch { /* fall through */ }
  }

  const stored: StoredCredentials = {
    version: 1,
    bearerToken: createToken('sk-stavi-'),
    createdAt: nowIso(),
    serverId: randomUUID(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, filePath);
  return stored.bearerToken;
}

export function issueOrReadServerId(baseDir: string): string {
  const filePath = credentialsPath(baseDir);
  ensureDirFor(filePath);

  if (existsSync(filePath)) {
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf-8')) as StoredCredentials;
      if (parsed.serverId) return parsed.serverId;
      const withServerId = { ...parsed, serverId: randomUUID() } as StoredCredentials;
      const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
      writeFileSync(tempPath, `${JSON.stringify(withServerId, null, 2)}\n`, 'utf-8');
      renameSync(tempPath, filePath);
      return withServerId.serverId!;
    } catch { /* fall through */ }
  }

  const stored: StoredCredentials = {
    version: 1,
    bearerToken: createToken('sk-stavi-'),
    createdAt: nowIso(),
    serverId: randomUUID(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(stored, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, filePath);
  return stored.serverId!;
}

export function createServerConnectionConfig(input: {
  host?: string;
  port?: number;
  token: string;
}): ServerConnectionConfig {
  const host = input.host && input.host !== '0.0.0.0' ? input.host : detectLocalIp();
  const port = input.port ?? DEFAULT_PORT;
  return { address: `${host}:${port}`, host, port, token: input.token };
}

function writeRuntimeState(baseDir: string, host: string, port: number) {
  const filePath = runtimeStatePath(baseDir);
  ensureDirFor(filePath);
  const state = {
    version: 1, pid: process.pid, host, port,
    origin: `http://${host}:${port}`,
    startedAt: nowIso(),
  };
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(state, null, 2)}\n`, 'utf-8');
  renameSync(tempPath, filePath);
}

function clearRuntimeState(baseDir: string) {
  const filePath = runtimeStatePath(baseDir);
  if (existsSync(filePath)) unlinkSync(filePath);
}

// ----------------------------------------------------------
// startStaviServer
// ----------------------------------------------------------

export async function startStaviServer(options: StartServerOptions): Promise<StaviServer> {
  const baseDir = resolve(options.baseDir);
  const workspaceRoot = resolve(options.cwd);
  const host = options.host ?? '0.0.0.0';
  const port = options.port ?? DEFAULT_PORT;
  const bearerToken = issueOrReadBearerToken(baseDir);
  const serverId = issueOrReadServerId(baseDir);

  const DEFAULT_WS_TOKEN_TTL_MS = 15 * 60 * 1000;
  const wsTokens = new Map<string, { sessionId: string; expiresAt: number }>();

  // Build provider registry
  const providerRegistry = new ProviderRegistry(baseDir);
  await providerRegistry.initialize();

  // Build shared context
  const ctx = createServerContext(workspaceRoot, baseDir, providerRegistry, getGitStatus, serverId);

  // Wire Claude adapter's approval emitter into orchestration event broadcast
  const claudeAdapter = providerRegistry.getAdapter('claude');
  if (claudeAdapter && 'onApprovalRequired' in claudeAdapter) {
    (claudeAdapter as any).onApprovalRequired(
      (threadId: string, requestId: string, toolName: string, toolInput: unknown, turnId: string) => {
        ctx.broadcastOrchestrationEvent({
          type: 'thread.approval-response-requested',
          occurredAt: nowIso(),
          payload: { threadId, turnId, requestId, toolName, toolInput },
        });
      },
    );
  }

  // Build the handler registry (tag → handler function)
  const handlers: Record<string, RpcHandler> = {
    ...createGitHandlers(ctx),
    ...createTerminalHandlers(ctx),
    ...createFsHandlers(ctx),
    ...createSystemHandlers(ctx),
    ...createProcessHandlers(ctx),
    ...createOrchestrationHandlers(ctx),
    ...createServerConfigHandlers(ctx),
    ...createSessionHandlers(ctx),
  };

  // -- HTTP server (health + WS token endpoint) --

  const server = createServer(async (req, res) => {
    if (!req.url) { res.writeHead(400).end('Bad Request'); return; }

    const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', cwd: workspaceRoot }));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/auth/ws-token') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token !== bearerToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid bearer token' }));
        return;
      }
      const wsToken = createToken('ws-stavi-');
      wsTokens.set(wsToken, { sessionId: 'local-session', expiresAt: Date.now() + DEFAULT_WS_TOKEN_TTL_MS });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        token: wsToken,
        expiresAt: new Date(Date.now() + DEFAULT_WS_TOKEN_TTL_MS).toISOString(),
      }));
      return;
    }

    res.writeHead(404).end('Not found');
  });

  // -- WebSocket server --

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') { socket.destroy(); return; }

    const wsToken = url.searchParams.get('wsToken') ?? '';
    const session = wsTokens.get(wsToken);
    if (!session || session.expiresAt < Date.now()) { socket.destroy(); return; }
    wsTokens.delete(wsToken);

    wss.handleUpgrade(req, socket, head, (ws: WebSocket) => wss.emit('connection', ws, req));
  });

  // -- Message dispatch --

  const removeSubscriptionByRequestId = (requestId: string) => {
    ctx.terminalSubscriptions.delete(requestId);
    ctx.gitSubscriptions.delete(requestId);
    ctx.orchestrationSubscriptions.delete(requestId);
    ctx.processSubscriptions.delete(requestId);
    ctx.sessionSubscriptions.delete(requestId);
  };

  const cleanupSocket = (ws: WebSocket) => {
    const ids = ctx.connectionSubscriptions.get(ws);
    if (ids) {
      for (const requestId of ids) removeSubscriptionByRequestId(requestId);
      ctx.connectionSubscriptions.delete(ws);
    }
    ctx.maybeStopGitPolling();
  };

  wss.on('connection', (ws: WebSocket) => {
    ws.on('close', () => cleanupSocket(ws));

    ws.on('message', async (raw: Buffer) => {
      let request: RpcRequest;
      try {
        request = JSON.parse(raw.toString()) as RpcRequest;
      } catch {
        return;
      }

      const { id, tag, payload } = request;

      const handler = handlers[tag];
      if (!handler) {
        sendJson(ws, makeFailure(id, `Unsupported RPC tag: ${tag}`));
        return;
      }

      try {
        await handler(ws, id, payload);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown server error';
        sendJson(ws, makeFailure(id, message));
      }
    });
  });

  // -- Start listening --

  await new Promise<void>((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => resolvePromise());
  });

  writeRuntimeState(baseDir, host, port);

  return {
    bearerToken,
    port,
    host,
    stop: async () => {
      if (ctx.state.gitPollTimer) {
        clearInterval(ctx.state.gitPollTimer);
        ctx.state.gitPollTimer = null;
      }
      await providerRegistry.stopAll();
      for (const session of ctx.terminalSessions.values()) {
        session.proc.kill('SIGTERM');
      }
      ctx.terminalSessions.clear();
      await new Promise<void>((resolvePromise) => {
        wss.close(() => server.close(() => resolvePromise()));
      });
      clearRuntimeState(baseDir);
    },
  };
}
