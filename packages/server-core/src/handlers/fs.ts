// WHAT: RPC handlers for filesystem operations (fs.* + projects.* namespaces).
// WHY:  Provides file read/write/list/search/grep plus create/rename/delete for
//       the Phase 4 editor. All paths are guarded against traversal.
//       Phase 7c batch/zip handlers live in fs-batch.ts (split to stay ≤400 lines).
// HOW:  Thin wrappers over node:fs/promises. ctx.workspaceRoot + session folders
//       define the allowed root set. Returns Exit.Success / Exit.Failure payloads.
// SEE:  packages/server-core/src/handlers/fs-batch.ts (batch + zip ops),
//       packages/server-core/src/context.ts, docs/PROTOCOL.md §5.5

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import type { ServerContext, RpcHandler } from '../context';
import { execFileAsync, resolveWorkspacePath, searchEntries } from '../utils';
import { createFsBatchHandlers } from './fs-batch';

const HIDDEN_DIRS = new Set([
  '.git', 'node_modules', '.turbo', 'dist', 'build',
  '.next', '.cache', 'Pods', '.gradle',
]);

function ensureDirFor(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Guard a path against traversal attacks. Accepts the path only if it
 * falls within workspaceRoot or one of the known session folders.
 *
 * Returns the normalized absolute path on success, or null on rejection.
 * Exported so fs-batch.ts can receive it as a parameter.
 */
export function guardPath(
  workspaceRoot: string,
  rawPath: string,
  sessionFolders: string[],
): string | null {
  // Resolve to absolute
  const abs = rawPath.startsWith('/')
    ? normalize(rawPath)
    : resolve(workspaceRoot, rawPath);

  // Must be under workspaceRoot OR a known session folder
  const allowed = [workspaceRoot, ...sessionFolders];
  for (const root of allowed) {
    if (abs === root || abs.startsWith(root + '/')) {
      return abs;
    }
  }
  return null;
}

export function createFsHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { workspaceRoot, sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  // Collect known session folders from the session repository
  function getSessionFolders(): string[] {
    try {
      const sessions = ctx.sessionRepo.listSessions({ includeArchived: false });
      return sessions.map((s) => s.folder);
    } catch {
      return [];
    }
  }

  function guardedPath(rawPath: string): string | null {
    return guardPath(workspaceRoot, rawPath, getSessionFolders());
  }

  // Merge in Phase 7c batch handlers, passing guardedPath so they share
  // the same traversal logic without duplicating it.
  const batchHandlers = createFsBatchHandlers(ctx, guardedPath);

  return {
    // -------------------------------------------------------
    // fs.read — read a file
    // -------------------------------------------------------
    'fs.read': async (ws, id, payload) => {
      const targetPath = resolveWorkspacePath(workspaceRoot, String(payload.path ?? ''));
      const content = readFileSync(targetPath, 'utf-8');
      sendJson(ws, makeSuccess(id, { content }));
    },

    // -------------------------------------------------------
    // fs.write — write a file (creates dirs as needed)
    // -------------------------------------------------------
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

    // -------------------------------------------------------
    // fs.create — create a new file or directory
    // -------------------------------------------------------
    'fs.create': async (ws, id, payload) => {
      const rawPath = String(payload.path ?? '');
      if (!rawPath) {
        sendJson(ws, makeFailure(id, 'path is required'));
        return;
      }

      const targetPath = guardedPath(rawPath);
      if (!targetPath) {
        sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots'));
        return;
      }

      const type = String(payload.type ?? 'file');

      try {
        if (type === 'directory') {
          mkdirSync(targetPath, { recursive: true });
        } else {
          // Create file — ensure parent dirs exist
          ensureDirFor(targetPath);
          const content = String(payload.content ?? '');
          writeFileSync(targetPath, content, 'utf-8');
        }
        sendJson(ws, makeSuccess(id, { ok: true }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Failed to create'));
      }
    },

    // -------------------------------------------------------
    // fs.rename — rename (or move) a file/directory
    // -------------------------------------------------------
    'fs.rename': async (ws, id, payload) => {
      const rawFrom = String(payload.from ?? '');
      const rawTo = String(payload.to ?? '');

      if (!rawFrom || !rawTo) {
        sendJson(ws, makeFailure(id, '"from" and "to" are required'));
        return;
      }

      const fromPath = guardedPath(rawFrom);
      if (!fromPath) {
        sendJson(ws, makeFailure(id, 'Source path is outside allowed workspace roots'));
        return;
      }

      const toPath = guardedPath(rawTo);
      if (!toPath) {
        sendJson(ws, makeFailure(id, 'Destination path is outside allowed workspace roots'));
        return;
      }

      try {
        ensureDirFor(toPath);
        renameSync(fromPath, toPath);
        sendJson(ws, makeSuccess(id, { ok: true }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Failed to rename'));
      }
    },

    // -------------------------------------------------------
    // fs.delete — delete a file or directory
    // -------------------------------------------------------
    'fs.delete': async (ws, id, payload) => {
      const rawPath = String(payload.path ?? '');
      if (!rawPath) {
        sendJson(ws, makeFailure(id, 'path is required'));
        return;
      }

      const targetPath = guardedPath(rawPath);
      if (!targetPath) {
        sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots'));
        return;
      }

      const recursive = Boolean(payload.recursive ?? false);

      try {
        rmSync(targetPath, { recursive, force: false });
        sendJson(ws, makeSuccess(id, { ok: true }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Failed to delete'));
      }
    },

    // -------------------------------------------------------
    // fs.list — list a directory
    // showHidden: boolean — when true, do NOT filter HIDDEN_DIRS or dot-files
    // -------------------------------------------------------
    'fs.list': async (ws, id, payload) => {
      const relPath = String(payload.path ?? '.');
      const showHidden = Boolean(payload.showHidden ?? false);
      const targetPath = resolveWorkspacePath(workspaceRoot, relPath);

      if (!existsSync(targetPath)) {
        sendJson(ws, makeFailure(id, `Directory not found: ${relPath}`));
        return;
      }

      try {
        const dirents = readdirSync(targetPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = [];

        for (const dirent of dirents) {
          if (!showHidden) {
            if (HIDDEN_DIRS.has(dirent.name)) continue;
            if (
              dirent.name.startsWith('.') &&
              dirent.name !== '.env' &&
              dirent.name !== '.env.local'
            ) continue;
          }

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

    // -------------------------------------------------------
    // fs.search — fuzzy search + optional exact-path read
    // -------------------------------------------------------
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

    // -------------------------------------------------------
    // fs.grep — full-text ripgrep search
    // -------------------------------------------------------
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

    // Phase 7c batch + zip handlers (fs.stat, fs.batchDelete,
    // fs.batchMove, fs.batchCopy, fs.zip, fs.unzip) — spread from fs-batch.ts
    ...batchHandlers,
  };
}
