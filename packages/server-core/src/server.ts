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

  // Prune unconsumed ws tokens every minute to prevent unbounded growth
  const wsTokenCleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of wsTokens) {
      if (now > v.expiresAt) wsTokens.delete(k);
    }
  }, 60_000);
  wsTokenCleanupInterval.unref();

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

  // Wire Claude adapter's AskUserQuestion emitter. Mirrors onApprovalRequired,
  // but emits `thread.user-input-requested` with the question schema so the
  // mobile client can render a proper form instead of a generic approval card.
  if (claudeAdapter && 'onUserInputRequired' in claudeAdapter) {
    (claudeAdapter as any).onUserInputRequired(
      (threadId: string, requestId: string, questions: unknown, turnId: string) => {
        ctx.broadcastOrchestrationEvent({
          type: 'thread.user-input-requested',
          occurredAt: nowIso(),
          payload: { threadId, turnId, requestId, questions },
        });
      },
    );
  }

  // Wire Claude adapter's cursor persistence callbacks so sessions survive
  // server restarts.  onCursorPersist(persist, getCursor) follows the same
  // pattern as onApprovalRequired — callbacks keep the adapter DB-free.
  if (claudeAdapter && 'onCursorPersist' in claudeAdapter) {
    (claudeAdapter as any).onCursorPersist(
      // persist: called after every successful turn to save the new cursor
      (threadId: string, sessionId: string | null) => {
        if (sessionId) {
          ctx.threadRepo.setResumeCursor(threadId, { provider: 'claude', sessionId });
        } else {
          ctx.threadRepo.setResumeCursor(threadId, null);
        }
      },
      // getCursor: called at the start of sendTurn when no in-memory session exists
      (threadId: string): string | null => {
        const cursor = ctx.threadRepo.getResumeCursor(threadId);
        if (cursor?.provider === 'claude') return cursor.sessionId;
        return null;
      },
    );
  }

  // Wire Codex adapter's cursor persistence (observability only — no restart resume).
  const codexAdapter = providerRegistry.getAdapter('codex');
  if (codexAdapter && 'onCursorPersist' in codexAdapter) {
    (codexAdapter as any).onCursorPersist(
      (threadId: string, providerThreadId: string | null) => {
        if (providerThreadId) {
          ctx.threadRepo.setResumeCursor(threadId, { provider: 'codex', providerThreadId });
        } else {
          ctx.threadRepo.setResumeCursor(threadId, null);
        }
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
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }

    // ------------------------------------------------------------------
    // GET /proxy?url=<encoded>&token=<bearer>  (or Authorization: Bearer)
    // ------------------------------------------------------------------
    // LAN-only localhost proxy for the mobile Browser plugin.
    // Security:
    //   - Requires bearer auth (header OR ?token= query because WebView
    //     cannot set Authorization headers cleanly for top-level navigation).
    //   - Allowlists only http(s)://(localhost|127.0.0.1|0.0.0.0)(:port)?(/...)?
    //     — rejects everything else with 400.
    // v1 limitations (documented, intentional):
    //   - No HTML rewriting. The WebView's top-level URL points at the proxy,
    //     but relative subresources (CSS/JS/XHR) resolve against the proxy
    //     origin — the proxy happily serves them. Absolute URLs pointing to
    //     `http://localhost:<other-port>` inside HTML will not be rewritten
    //     and will fail to load from the phone. A future iteration should
    //     inject `<base href>` or rewrite `localhost:` refs in text/html.
    //   - WebSocket upgrade is NOT forwarded — HMR will not work on first
    //     load. Planned for a follow-up (needs http.upgrade wiring here
    //     distinct from the /ws path used by the RPC WebSocket).
    if (req.method === 'GET' && url.pathname === '/proxy') {
      // Auth: Bearer header OR ?token= query param.
      const authHeader = req.headers.authorization ?? '';
      const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      const queryToken = url.searchParams.get('token') ?? '';
      const providedToken = headerToken || queryToken;
      if (providedToken !== bearerToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid bearer token' }));
        return;
      }

      const target = url.searchParams.get('url') ?? '';
      // Allowlist: only localhost/127.0.0.1/0.0.0.0 over http(s).
      const ALLOW_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i;
      if (!ALLOW_RE.test(target)) {
        res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Invalid or disallowed url. Only http(s)://localhost|127.0.0.1|0.0.0.0 permitted.');
        return;
      }

      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        res.writeHead(400).end('Malformed url');
        return;
      }

      const portForError = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');

      try {
        const upstream = await fetch(parsed.toString(), {
          method: 'GET',
          // Forward a minimal set of headers; browsers send lots we don't
          // want to forward (host, origin, cookie for the proxy origin, …).
          headers: {
            'user-agent': req.headers['user-agent'] ?? 'StaviProxy/1.0',
            accept: (req.headers['accept'] as string) ?? '*/*',
            'accept-language': (req.headers['accept-language'] as string) ?? 'en',
          },
          redirect: 'manual',
        });

        const contentType = upstream.headers.get('content-type') ?? 'application/octet-stream';
        const headers: Record<string, string> = { 'content-type': contentType };
        const cacheControl = upstream.headers.get('cache-control');
        if (cacheControl) headers['cache-control'] = cacheControl;

        res.writeHead(upstream.status, headers);

        if (!upstream.body) {
          res.end();
          return;
        }

        // Stream the body through. Works for Node fetch (web ReadableStream).
        const reader = upstream.body.getReader();
        const pump = async () => {
          try {
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              if (value) res.write(Buffer.from(value));
            }
            res.end();
          } catch (err) {
            try { res.end(); } catch { /* noop */ }
            console.warn('[proxy] stream error:', err);
          }
        };
        void pump();
        return;
      } catch (err: unknown) {
        const code = (err as { cause?: { code?: string }; code?: string })?.cause?.code
          ?? (err as { code?: string })?.code
          ?? '';
        if (code === 'ECONNREFUSED' || code === 'ECONNRESET') {
          res.writeHead(502, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(
            `<!doctype html><html><head><meta charset="utf-8"><title>Dev server not running</title>` +
            `<style>body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#1a1a1a;color:#eee;padding:2rem;max-width:40rem;margin:0 auto}h1{color:#ff8a65}code{background:#000;padding:.1rem .3rem;border-radius:.2rem}</style>` +
            `</head><body><h1>Dev server on port ${portForError} is not running</h1>` +
            `<p>Stavi tried to reach <code>${parsed.protocol}//${parsed.host}</code> on the server machine, but no process is listening there.</p>` +
            `<p>Start your dev server (e.g. <code>npm run dev</code>) and reload.</p></body></html>`,
          );
          return;
        }
        res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(`Upstream fetch failed: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
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

  const wss = new WebSocketServer({ noServer: true, maxPayload: 5 * 1024 * 1024 } as ConstructorParameters<typeof WebSocketServer>[0]);

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

    // Stop all AI sessions when a client disconnects.
    // TRADEOFF: adapters don't track which sessions belong to which WS client,
    // so we stop everything. This is safe for the single-client use case (one
    // mobile app connected at a time). If stavi ever supports multiple concurrent
    // clients, the adapters will need a clientId→threadId mapping so we can stop
    // only the disconnecting client's sessions.
    void providerRegistry.stopAll();
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
      // Flush any coalesced replaceMessage writes before closing the DB
      ctx.messageRepo.flush();
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
