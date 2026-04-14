import { startStaviServer } from '../src/server.ts';
import { WebSocket } from 'ws';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';

const baseDir = '/Users/sunny/.stavi';
const dbPath = join(baseDir, 'userdata', 'stavi.db');

function rpc(ws, tag, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = `req-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const onMessage = (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg._tag !== 'Exit' || msg.requestId !== id) return;
      ws.off('message', onMessage);
      if (msg.exit._tag === 'Failure') {
        reject(new Error(msg.exit.cause?.error?.message ?? 'Unknown failure'));
        return;
      }
      resolve(msg.exit.value);
    };
    ws.on('message', onMessage);
    ws.send(JSON.stringify({ _tag: 'Request', id, tag, payload }));
  });
}

function wait(ms) { return new Promise((r) => setTimeout(r, ms)); }

async function getWs(port, bearerToken) {
  const res = await fetch(`http://127.0.0.1:${port}/api/auth/ws-token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${bearerToken}` },
  }).then((r) => r.json());
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?wsToken=${res.token}`);
  await new Promise((resolve) => ws.once('open', resolve));
  return ws;
}

async function run() {
  if (existsSync(dbPath)) rmSync(dbPath);

  const server = await startStaviServer({
    cwd: '/Users/sunny/claude-code-remote/stavi',
    baseDir,
    host: '127.0.0.1',
    port: 3789,
  });
  const ws = await getWs(3789, server.bearerToken);

  // 1. Empty DB on first boot: ensure db exists & _migrations has version=1
  const dbExists = existsSync(dbPath);
  const db = new Database(dbPath);
  const migrations = db.query('SELECT version FROM _migrations ORDER BY version').all();

  // 2. session.create round-trip
  const session = await rpc(ws, 'session.create', { folder: '/tmp', title: 'demo' });

  // 3. session.list
  const list = await rpc(ws, 'session.list', {});

  // 4. session.get should have no threads
  const sessionGet = await rpc(ws, 'session.get', { sessionId: session.id });

  // 5. thread.create via orchestration
  const threadId = `thread-${Date.now()}`;
  await rpc(ws, 'orchestration.dispatchCommand', {
    command: {
      type: 'thread.create',
      commandId: `cmd-${Date.now()}`,
      threadId,
      sessionId: session.id,
      projectId: 'project-local',
      title: 'Thread 1',
      runtimeMode: 'approval-required',
      interactionMode: 'default',
      branch: '',
      worktreePath: null,
      createdAt: new Date().toISOString(),
    },
  });

  // 7. session.touch updates lastActiveAt
  const beforeTouch = sessionGet.session.lastActiveAt;
  await wait(1100);
  await rpc(ws, 'session.touch', { sessionId: session.id });
  const afterTouch = (await rpc(ws, 'session.get', { sessionId: session.id })).session.lastActiveAt;

  ws.close();
  await server.stop();

  // Restart server to verify persistence + threads
  const server2 = await startStaviServer({
    cwd: '/Users/sunny/claude-code-remote/stavi',
    baseDir,
    host: '127.0.0.1',
    port: 3790,
  });
  const ws2 = await getWs(3790, server2.bearerToken);

  const list2 = await rpc(ws2, 'session.list', {});
  const sessionGet2 = await rpc(ws2, 'session.get', { sessionId: session.id });

  // 6. Cascade delete
  await rpc(ws2, 'session.delete', { sessionId: session.id });
  ws2.close();
  await server2.stop();

  const server3 = await startStaviServer({
    cwd: '/Users/sunny/claude-code-remote/stavi',
    baseDir,
    host: '127.0.0.1',
    port: 3791,
  });
  const ws3 = await getWs(3791, server3.bearerToken);

  let sessionGetAfterDelete;
  try {
    sessionGetAfterDelete = await rpc(ws3, 'session.get', { sessionId: session.id });
  } catch (err) {
    sessionGetAfterDelete = { error: err.message };
  }

  ws3.close();
  await server3.stop();

  const result = {
    dbExists,
    migrations,
    sessionCreated: session,
    listCount: list.sessions?.length ?? 0,
    sessionGetThreads: sessionGet.threads?.length ?? 0,
    persistedListCount: list2.sessions?.length ?? 0,
    persistedThreadCount: sessionGet2.threads?.length ?? 0,
    touchBefore: beforeTouch,
    touchAfter: afterTouch,
    sessionGetAfterDelete,
  };

  console.log(JSON.stringify(result, null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
