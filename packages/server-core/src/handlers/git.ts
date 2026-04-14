// ============================================================
// handlers/git.ts — git.* RPC handlers + subscribeGitStatus
// ============================================================

import type { WebSocket } from 'ws';
import type { ServerContext, RpcHandler } from '../context';
import { execFileAsync, getGitStatus } from '../utils';

export function createGitHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { workspaceRoot, sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  return {
    'git.status': async (ws, id) => {
      const status = await getGitStatus(workspaceRoot);
      ctx.state.lastGitStatusJson = JSON.stringify(status);
      for (const sub of ctx.gitSubscriptions.values()) {
        sendJson(sub.ws, makeChunk(sub.requestId, [status]));
      }
      sendJson(ws, makeSuccess(id, status));
    },

    'git.refreshStatus': async (ws, id) => {
      const status = await getGitStatus(workspaceRoot);
      ctx.state.lastGitStatusJson = JSON.stringify(status);
      for (const sub of ctx.gitSubscriptions.values()) {
        sendJson(sub.ws, makeChunk(sub.requestId, [status]));
      }
      sendJson(ws, makeSuccess(id, status));
    },

    'git.stage': async (ws, id, payload) => {
      const paths = payload.paths as string[] | undefined;
      if (!paths || paths.length === 0) {
        sendJson(ws, makeFailure(id, 'No paths provided'));
        return;
      }
      await execFileAsync('git', ['add', '--', ...paths], { cwd: workspaceRoot });
      void ctx.broadcastGitStatus();
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'git.unstage': async (ws, id, payload) => {
      const paths = payload.paths as string[] | undefined;
      if (!paths || paths.length === 0) {
        sendJson(ws, makeFailure(id, 'No paths provided'));
        return;
      }
      await execFileAsync('git', ['restore', '--staged', '--', ...paths], { cwd: workspaceRoot });
      void ctx.broadcastGitStatus();
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'git.commit': async (ws, id, payload) => {
      const message = String(payload.message ?? '');
      if (!message) {
        sendJson(ws, makeFailure(id, 'Commit message is required'));
        return;
      }
      const { stdout: commitOut } = await execFileAsync('git', ['commit', '-m', message], { cwd: workspaceRoot });
      void ctx.broadcastGitStatus();
      sendJson(ws, makeSuccess(id, { ok: true, output: commitOut }));
    },

    'git.diff': async (ws, id, payload) => {
      const diffPath = payload.path as string | undefined;
      const staged = payload.staged as boolean | undefined;
      const args = ['diff'];
      if (staged) args.push('--staged');
      args.push('--stat', '--numstat');
      if (diffPath) args.push('--', diffPath);
      try {
        const { stdout: diffOut } = await execFileAsync('git', args, { cwd: workspaceRoot });
        sendJson(ws, makeSuccess(id, { diff: diffOut }));
      } catch {
        sendJson(ws, makeSuccess(id, { diff: '' }));
      }
    },

    'git.diffFile': async (ws, id, payload) => {
      const filePath = String(payload.path ?? '');
      const staged = payload.staged as boolean | undefined;
      const args = ['diff'];
      if (staged) args.push('--staged');
      if (filePath) args.push('--', filePath);
      try {
        const { stdout } = await execFileAsync('git', args, {
          cwd: workspaceRoot,
          maxBuffer: 2 * 1024 * 1024,
        });
        sendJson(ws, makeSuccess(id, { diff: stdout }));
      } catch {
        sendJson(ws, makeSuccess(id, { diff: '' }));
      }
    },

    'git.log': async (ws, id, payload) => {
      const limit = Number(payload.limit ?? 50);
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['log', `--format=%H%x00%s%x00%an%x00%aI`, '-n', String(limit)],
          { cwd: workspaceRoot },
        );
        const commits = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [hash, message, author, date] = line.split('\0');
            return { hash, message, author, date };
          });
        sendJson(ws, makeSuccess(id, { commits }));
      } catch {
        sendJson(ws, makeSuccess(id, { commits: [] }));
      }
    },

    'git.branches': async (ws, id) => {
      try {
        const { stdout } = await execFileAsync(
          'git',
          ['branch', '-a', '--format=%(refname:short)\t%(objectname:short)\t%(upstream:short)\t%(HEAD)'],
          { cwd: workspaceRoot },
        );
        const branches = stdout
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            const [name, hash, upstream, head] = line.split('\t');
            return { name, hash, upstream: upstream || null, current: head === '*' };
          });
        sendJson(ws, makeSuccess(id, { branches }));
      } catch {
        sendJson(ws, makeSuccess(id, { branches: [] }));
      }
    },

    'git.checkout': async (ws, id, payload) => {
      const branch = String(payload.branch ?? '');
      const create = payload.create as boolean | undefined;
      if (!branch) {
        sendJson(ws, makeFailure(id, 'Branch name required'));
        return;
      }
      const args = create ? ['checkout', '-b', branch] : ['checkout', branch];
      await execFileAsync('git', args, { cwd: workspaceRoot });
      void ctx.broadcastGitStatus();
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'git.push': async (ws, id, payload) => {
      const force = payload.force as boolean | undefined;
      const args = ['push'];
      if (force) args.push('--force-with-lease');
      try {
        const { stdout: pushOut, stderr: pushErr } = await execFileAsync('git', args, { cwd: workspaceRoot });
        sendJson(ws, makeSuccess(id, { ok: true, output: pushOut || pushErr }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Push failed'));
      }
    },

    'git.pull': async (ws, id, payload) => {
      const rebase = payload.rebase as boolean | undefined;
      const args = ['pull'];
      if (rebase) args.push('--rebase');
      try {
        const { stdout: pullOut, stderr: pullErr } = await execFileAsync('git', args, { cwd: workspaceRoot });
        sendJson(ws, makeSuccess(id, { ok: true, output: pullOut || pullErr }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Pull failed'));
      }
    },

    'git.discard': async (ws, id, payload) => {
      const paths = payload.paths as string[] | undefined;
      if (!paths || paths.length === 0) {
        sendJson(ws, makeFailure(id, 'No paths provided'));
        return;
      }
      try {
        await execFileAsync('git', ['checkout', '--', ...paths], { cwd: workspaceRoot });
      } catch { /* may fail for untracked files */ }
      try {
        await execFileAsync('git', ['clean', '-fd', '--', ...paths], { cwd: workspaceRoot });
      } catch { /* may fail if already handled */ }
      void ctx.broadcastGitStatus();
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'subscribeGitStatus': async (ws, id) => {
      ctx.gitSubscriptions.set(id, { ws, requestId: id, tag: 'subscribeGitStatus' });
      ctx.addConnectionSubscription(ws, id);
      ctx.ensureGitPolling();
      const status = await getGitStatus(workspaceRoot);
      sendJson(ws, makeChunk(id, [status]));
    },
  };
}
