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
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import type { ServerContext, RpcHandler } from '../context';
import { execFileAsync, searchEntries } from '../utils';
import { createFsBatchHandlers } from './fs-batch';
import ignoreModule from 'ignore';

// `ignore` ships as CJS with a callable default plus a `.default` alias; the
// shape Bun/tsc hands back differs, so normalize to the factory either way.
const createIgnore = ((ignoreModule as unknown as { default?: typeof ignoreModule }).default
  ?? ignoreModule) as typeof ignoreModule;

const HIDDEN_DIRS = new Set([
  '.git', 'node_modules', '.turbo', 'dist', 'build',
  '.next', '.cache', 'Pods', '.gradle',
]);

/**
 * Build a gitignore matcher for `dir`, mirroring how a developer's editor hides
 * ignored files (lunel does the same in its file walks). Finds the project root
 * — the nearest ancestor of `dir`, at or below `boundary`, that contains a
 * `.git` — then layers every `.gitignore` from that root down to `dir`. Paths
 * passed to `.ignores()` must be relative to the returned `root`.
 */
function buildGitignore(dir: string, boundary: string): { ig: ReturnType<typeof createIgnore>; root: string } {
  // Ancestor chain from `boundary` (inclusive) down to `dir` (inclusive).
  const chain: string[] = [];
  let cur = dir;
  for (;;) {
    chain.push(cur);
    if (cur === boundary) break;
    const parent = dirname(cur);
    if (parent === cur) break; // hit filesystem root before boundary
    cur = parent;
  }
  chain.reverse(); // boundary first … dir last

  // Project root = highest ancestor in range that is a git repo; else boundary.
  let root = boundary;
  for (const c of chain) {
    if (existsSync(join(c, '.git'))) { root = c; break; }
  }

  const ig = createIgnore();
  ig.add('.git'); // never surface the git dir itself
  let started = false;
  for (const c of chain) {
    if (c === root) started = true;
    if (!started) continue;
    const gi = join(c, '.gitignore');
    if (existsSync(gi)) {
      try { ig.add(readFileSync(gi, 'utf-8')); } catch { /* unreadable .gitignore */ }
    }
  }
  return { ig, root };
}

function ensureDirFor(filePath: string) {
  mkdirSync(dirname(filePath), { recursive: true });
}

/**
 * Guard a path against traversal attacks. Accepts the path only if it
 * falls within workspaceRoot or one of the known session folders.
 *
 * Returns the (symlink-resolved) absolute path on success, or null on
 * rejection. Exported so fs-batch.ts can receive it as a parameter.
 *
 * Two layers of defense:
 *  1. Lexical prefix check — node:path resolve/normalize collapse `../`
 *     before the check, so traversal payloads and string-prefix siblings
 *     (e.g. /a/bc under /a/b) are rejected here.
 *  2. realpath check — a symlink living textually inside the workspace but
 *     pointing outside passes layer 1; realpath() follows it so we can
 *     re-check the canonical target. The leaf often doesn't exist yet
 *     (create/write/rename destinations), so we realpath the nearest
 *     EXISTING ancestor and re-append the not-yet-created remainder — this
 *     still catches an escaping symlink anywhere along the existing portion.
 */
export function guardPath(
  workspaceRoot: string,
  rawPath: string,
  sessionFolders: string[],
): string | null {
  // 1) Resolve to an absolute, lexically-normalized path.
  const abs = rawPath.startsWith('/')
    ? normalize(rawPath)
    : resolve(workspaceRoot, rawPath);

  const allowed = [workspaceRoot, ...sessionFolders];
  // '/' literal (not sep): repo is Unix-only, and this exactly preserves the
  // prior cross-sibling rejection — root='/a/b' must reject target='/a/bc'.
  const isUnder = (p: string) =>
    allowed.some((root) => p === root || p.startsWith(root + '/'));

  // 2) Lexical prefix check (rejects ../ traversal and prefix siblings).
  if (!isUnder(abs)) return null;

  // 3) Symlink-escape check — realpath the nearest existing ancestor.
  let cur = abs;
  const remainder: string[] = []; // collected leaf-first
  for (;;) {
    try {
      const realCur = realpathSync(cur);
      const realAbs =
        remainder.length > 0
          ? resolve(realCur, remainder.slice().reverse().join('/'))
          : realCur;
      return isUnder(realAbs) ? realAbs : null;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      // ENOENT/ENOTDIR = this component doesn't exist yet → walk up. Any
      // other error (EACCES, ELOOP, …) fails closed: we cannot prove safety.
      if (code !== 'ENOENT' && code !== 'ENOTDIR') return null;
      const parent = dirname(cur);
      if (parent === cur) return null; // reached filesystem root, gave up
      remainder.push(cur.slice(parent.length + 1));
      cur = parent;
    }
  }
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
      const targetPath = guardedPath(String(payload.path ?? ''));
      if (!targetPath) { sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots')); return; }
      const content = readFileSync(targetPath, 'utf-8');
      sendJson(ws, makeSuccess(id, { content }));
    },

    // -------------------------------------------------------
    // fs.write — write a file (creates dirs as needed)
    // -------------------------------------------------------
    'fs.write': async (ws, id, payload) => {
      const targetPath = guardedPath(String(payload.path ?? ''));
      if (!targetPath) { sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots')); return; }
      ensureDirFor(targetPath);
      writeFileSync(targetPath, String(payload.content ?? ''), 'utf-8');
      sendJson(ws, makeSuccess(id, { ok: true }));
    },

    // Alias used by some older plugin code
    'projects.writeFile': async (ws, id, payload) => {
      const targetPath = guardedPath(String(payload.path ?? ''));
      if (!targetPath) { sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots')); return; }
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
    // fs.listDirs — browse DIRECTORIES under the user's home folder.
    // Used by the workspace-folder picker: unlike fs.list (scoped to
    // workspaceRoot + session folders), this is rooted at os.homedir() so
    // users can pick any project on the machine, cross-platform
    // (/Users/x on macOS, /home/x on Linux, C:\Users\x on Windows).
    // Directories only — never file contents — and never above home.
    // -------------------------------------------------------
    'fs.listDirs': async (ws, id, payload) => {
      const home = normalize(homedir());
      const raw = String(payload.path ?? '~');

      // Expand "~" / "~/sub" and resolve relative input against home.
      const expanded =
        raw === '~' || raw === ''
          ? home
          : raw.startsWith('~/') || raw.startsWith('~\\')
            ? join(home, raw.slice(2))
            : raw;
      const abs = normalize(resolve(home, expanded));

      if (abs !== home && !abs.startsWith(home + sep)) {
        sendJson(ws, makeFailure(id, 'Path is outside your home folder'));
        return;
      }
      if (!existsSync(abs) || !statSync(abs).isDirectory()) {
        sendJson(ws, makeFailure(id, `Directory not found: ${raw}`));
        return;
      }

      try {
        const dirents = readdirSync(abs, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'directory' }> = [];
        for (const dirent of dirents) {
          if (!dirent.isDirectory()) continue;
          if (dirent.name.startsWith('.')) continue;
          if (HIDDEN_DIRS.has(dirent.name)) continue;
          entries.push({ name: dirent.name, type: 'directory' });
        }
        entries.sort((a, b) => a.name.localeCompare(b.name));

        sendJson(ws, makeSuccess(id, {
          path: abs,
          home,
          parent: abs === home ? null : dirname(abs),
          entries,
        }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'Failed to list directory'));
      }
    },

    // -------------------------------------------------------
    // fs.list — list a directory
    // showHidden: boolean — when true, do NOT filter HIDDEN_DIRS or dot-files
    // -------------------------------------------------------
    'fs.list': async (ws, id, payload) => {
      const relPath = String(payload.path ?? '.');
      const showHidden = Boolean(payload.showHidden ?? false);
      const targetPath = guardedPath(relPath);
      if (!targetPath) { sendJson(ws, makeFailure(id, 'Path is outside allowed workspace roots')); return; }

      if (!existsSync(targetPath)) {
        sendJson(ws, makeFailure(id, `Directory not found: ${relPath}`));
        return;
      }

      try {
        const dirents = readdirSync(targetPath, { withFileTypes: true });
        const entries: Array<{ name: string; type: 'file' | 'directory'; size?: number }> = [];

        // Respect .gitignore so the explorer mirrors what's tracked, like a
        // desktop editor (and lunel) — unless the caller explicitly wants hidden.
        // Bound the .gitignore walk to whichever allowed root contains the
        // target (workspaceRoot or a session folder), never above it.
        const allowedRoots = [workspaceRoot, ...getSessionFolders()];
        const boundary =
          allowedRoots.find((r) => targetPath === r || targetPath.startsWith(r + sep)) ?? workspaceRoot;
        const { ig, root } = showHidden
          ? { ig: null as ReturnType<typeof createIgnore> | null, root: targetPath }
          : buildGitignore(targetPath, boundary);

        for (const dirent of dirents) {
          if (!showHidden) {
            if (HIDDEN_DIRS.has(dirent.name)) continue;
            if (
              dirent.name.startsWith('.') &&
              dirent.name !== '.env' &&
              dirent.name !== '.env.local'
            ) continue;
            if (ig) {
              const rel = relative(root, join(targetPath, dirent.name));
              if (rel && ig.ignores(dirent.isDirectory() ? `${rel}/` : rel)) continue;
            }
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
      const exactPath = guardedPath(query);
      let content: string | undefined;
      if (exactPath && existsSync(exactPath)) {
        try { content = readFileSync(exactPath, 'utf-8'); } catch { /* ignore */ }
      }
      const entries = await searchEntries(workspaceRoot, query, limit);
      sendJson(ws, makeSuccess(id, { entries, content }));
    },

    // Alias used by explorer plugin
    'projects.searchEntries': async (ws, id, payload) => {
      const query = String(payload.query ?? payload.path ?? '*');
      const limit = Number(payload.limit ?? 200);
      const exactPath = guardedPath(query);
      let content: string | undefined;
      if (exactPath && existsSync(exactPath)) {
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
