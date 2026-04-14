// ============================================================
// handlers/fs.ts — fs.* + projects.* RPC handlers
// ============================================================

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import type { ServerContext, RpcHandler } from '../context';
import { execFileAsync, resolveWorkspacePath, searchEntries } from '../utils';

const HIDDEN_DIRS = new Set([
  '.git', 'node_modules', '.turbo', 'dist', 'build',
  '.next', '.cache', 'Pods', '.gradle',
]);

function ensureDirFor(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

export function createFsHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { workspaceRoot, sendJson, makeSuccess, makeFailure } = ctx;

  return {
    'fs.read': async (ws, id, payload) => {
      const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
      const content = readFileSync(targetPath, 'utf-8');
      sendJson(ws, makeSuccess(id, { content }));
    },

    'fs.write': async (ws, id, payload) => {
      const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
      ensureDirFor(targetPath);
      writeFileSync(targetPath, String(payload.content ?? ''), 'utf-8');
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    // Alias used by some older plugin code
    'projects.writeFile': async (ws, id, payload) => {
      const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
      ensureDirFor(targetPath);
      writeFileSync(targetPath, String(payload.content ?? ''), 'utf-8');
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    'fs.list': async (ws, id, payload) => {
      const relPath = String(payload.path ?? '.');
      const targetPath = resolveWorkspacePath(workspaceRoot, relPath);

      if (!existsSync(targetPath)) {
        sendJson(ws, makeFailure(id, `Directory not found: ${relPath}`));
        return;
      }

      try {
        const dirents = readdirSync(targetPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = [];

        for (const dirent of dirents) {
          if (HIDDEN_DIRS.has(dirent.name)) continue;
          if (
            dirent.name.startsWith('.') &&
            dirent.name !== '.env' &&
            dirent.name !== '.env.local'
          ) continue;

          const entryType = dirent.isDirectory() ? 'directory' : 'file';
          const entry: { name: string; type: 'file' | 'directory'; size?: number } = {
            name: dirent.name,
            type: entryType,
          };

          if (entryType === 'file') {
            try {
              entry.size = statSync(join(targetPath, dirent.name)).size;
            } catch { /* ignore stat errors */ }
          }

          entries.push(entry);
        }

        entries.sort((a, b) => {
          if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
          return a.name.localeCompare(b.name);
        });

        sendJson(ws, makeSuccess(id, { path: relPath, entries }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Failed to list directory'));
      }
    },

    'fs.search': async (ws, id, payload) => {
      const query = String(payload.query ?? payload.path ?? '*');
      const limit = Number(payload.limit ?? 200);
      const exactPath = resolveWorkspacePath(workspaceRoot, query);
      let content: string | undefined;
      if (existsSync(exactPath)) {
        try { content = readFileSync(exactPath, 'utf-8'); } catch { /* ignore */ }
      }
      const entries = await searchEntries(workspaceRoot, query, limit);
      sendJson(ws, makeSuccess(id, { entries, content }));
    },

    // Alias used by explorer plugin
    'projects.searchEntries': async (ws, id, payload) => {
      const query = String(payload.query ?? payload.path ?? '*');
      const limit = Number(payload.limit ?? 200);
      const exactPath = resolveWorkspacePath(workspaceRoot, query);
      let content: string | undefined;
      if (existsSync(exactPath)) {
        try { content = readFileSync(exactPath, 'utf-8'); } catch { /* ignore */ }
      }
      const entries = await searchEntries(workspaceRoot, query, limit);
      sendJson(ws, makeSuccess(id, { entries, content }));
    },

    'fs.grep': async (ws, id, payload) => {
      const pattern = String(payload.pattern ?? '');
      const fileGlob = String(payload.glob ?? '');
      const maxResults = Math.min(Number(payload.limit ?? 100), 500);

      if (!pattern) {
        sendJson(ws, makeFailure(id, 'pattern is required'));
        return;
      }

      try {
        const args = [
          '--json', '-i',
          '--max-count', '5',
          '-g', '!node_modules',
          '-g', '!.git',
          '-g', '!dist',
          '-g', '!build',
        ];
        if (fileGlob) args.push('-g', fileGlob);
        args.push(pattern);

        const { stdout } = await execFileAsync('rg', args, {
          cwd: workspaceRoot,
          maxBuffer: 5 * 1024 * 1024,
          timeout: 10000,
        });

        const matches: Array<{ file: string; line: number; text: string }> = [];
        for (const line of stdout.trim().split('\n').filter(Boolean)) {
          try {
            const obj = JSON.parse(line);
            if (obj.type === 'match') {
              matches.push({
                file: obj.data.path.text,
                line: obj.data.line_number,
                text: obj.data.lines.text.trimEnd(),
              });
            }
          } catch { /* skip malformed JSON lines */ }
          if (matches.length >= maxResults) break;
        }
        sendJson(ws, makeSuccess(id, { matches }));
      } catch (err: any) {
        if (err.code === 1) {
          sendJson(ws, makeSuccess(id, { matches: [] }));
        } else {
          sendJson(ws, makeFailure(id, 'Search failed'));
        }
      }
    },
  };
}
