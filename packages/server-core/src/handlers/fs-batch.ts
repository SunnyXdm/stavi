// WHAT: Phase 7c bulk filesystem RPC handlers: fs.stat, fs.batchDelete,
//       fs.batchMove, fs.batchCopy.
// WHY:  Extracted from fs.ts to keep each file under 400 lines. These handlers
//       serve the Explorer's multi-select bulk operations and EntryMetaSheet.
//       All batch RPCs stream Chunk messages for per-item progress (same mechanism
//       as subscribeTerminalEvents) so the mobile UI can render a progress bar.
// HOW:  Every path is validated via the guardedPath() callback (shared with fs.ts)
//       before any fs operation. Chunk format:
//         { type:'progress', path, index, total }
//         { type:'error', path, error }
//       Final response: Exit.Success with { type:'done', ...count }.
// SEE:  packages/server-core/src/handlers/fs.ts (guard + core ops),
//       packages/server-core/src/handlers/fs-zip.ts (zip/unzip),
//       docs/PROTOCOL.md §5.5

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs';
import { stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ServerContext, RpcHandler } from '../context';
import { createFsZipHandlers } from './fs-zip';

export function createFsBatchHandlers(
  ctx: ServerContext,
  guardedPath: (raw: string) => string | null,
): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  function ensureDirFor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  const zipHandlers = createFsZipHandlers(ctx, guardedPath);

  return {

    // -------------------------------------------------------
    // fs.stat — file/directory metadata (size, mtime, permissions, type)
    // Phase 7c: used by EntryMetaSheet to display file info.
    // Response: { size, mtime, atime, mode (octal string), isDirectory, isFile, isSymlink }
    // -------------------------------------------------------
    'fs.stat': async (ws, id, payload) => {
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

      try {
        const s = await stat(targetPath);
        // Permissions as octal string e.g. '0755' (Unix convention)
        const mode = (s.mode & 0o7777).toString(8).padStart(4, '0');
        sendJson(ws, makeSuccess(id, {
          size: s.size,
          mtime: s.mtimeMs,
          atime: s.atimeMs,
          mode,
          isDirectory: s.isDirectory(),
          isFile: s.isFile(),
          isSymlink: s.isSymbolicLink(),
        }));
      } catch (err) {
        sendJson(ws, makeFailure(id, err instanceof Error ? err.message : 'stat failed'));
      }
    },

    // -------------------------------------------------------
    // fs.batchDelete — delete multiple paths, stream per-item progress
    // Phase 7c: Explorer multi-select delete.
    // -------------------------------------------------------
    'fs.batchDelete': async (ws, id, payload) => {
      const rawPaths = Array.isArray(payload.paths) ? payload.paths as unknown[] : [];
      if (rawPaths.length === 0) {
        sendJson(ws, makeFailure(id, 'paths array is required and must be non-empty'));
        return;
      }

      // Guard all paths up-front (fail-fast on traversal attempt)
      const resolvedPaths: string[] = [];
      for (const raw of rawPaths) {
        const p = guardedPath(String(raw));
        if (!p) {
          sendJson(ws, makeFailure(id, `Path is outside allowed workspace roots: ${raw}`));
          return;
        }
        resolvedPaths.push(p);
      }

      const total = resolvedPaths.length;
      let deletedCount = 0;

      for (let i = 0; i < resolvedPaths.length; i++) {
        const filePath = resolvedPaths[i];
        try {
          rmSync(filePath, { recursive: true, force: false });
          deletedCount++;
          sendJson(ws, makeChunk(id, [{ type: 'progress', path: filePath, index: i + 1, total }]));
        } catch (err) {
          sendJson(ws, makeChunk(id, [{
            type: 'error',
            path: filePath,
            error: err instanceof Error ? err.message : 'delete failed',
          }]));
        }
      }

      sendJson(ws, makeSuccess(id, { type: 'done', deletedCount }));
    },

    // -------------------------------------------------------
    // fs.batchMove — move multiple paths into a destination directory
    // Phase 7c: Explorer multi-select move.
    // -------------------------------------------------------
    'fs.batchMove': async (ws, id, payload) => {
      const rawPaths = Array.isArray(payload.paths) ? payload.paths as unknown[] : [];
      const rawDest = String(payload.destination ?? '');

      if (rawPaths.length === 0) {
        sendJson(ws, makeFailure(id, 'paths array is required and must be non-empty'));
        return;
      }
      if (!rawDest) {
        sendJson(ws, makeFailure(id, 'destination is required'));
        return;
      }

      const destPath = guardedPath(rawDest);
      if (!destPath) {
        sendJson(ws, makeFailure(id, 'Destination path is outside allowed workspace roots'));
        return;
      }

      const resolvedPaths: string[] = [];
      for (const raw of rawPaths) {
        const p = guardedPath(String(raw));
        if (!p) {
          sendJson(ws, makeFailure(id, `Source path is outside allowed workspace roots: ${raw}`));
          return;
        }
        resolvedPaths.push(p);
      }

      try {
        mkdirSync(destPath, { recursive: true });
      } catch (err) {
        sendJson(ws, makeFailure(id, `Cannot create destination directory: ${err instanceof Error ? err.message : err}`));
        return;
      }

      const total = resolvedPaths.length;
      let movedCount = 0;

      for (let i = 0; i < resolvedPaths.length; i++) {
        const srcPath = resolvedPaths[i];
        const fileName = srcPath.split('/').pop() ?? srcPath;
        const targetPath = join(destPath, fileName);
        try {
          renameSync(srcPath, targetPath);
          movedCount++;
          sendJson(ws, makeChunk(id, [{ type: 'progress', path: srcPath, index: i + 1, total }]));
        } catch (err) {
          sendJson(ws, makeChunk(id, [{
            type: 'error',
            path: srcPath,
            error: err instanceof Error ? err.message : 'move failed',
          }]));
        }
      }

      sendJson(ws, makeSuccess(id, { type: 'done', movedCount }));
    },

    // -------------------------------------------------------
    // fs.batchCopy — copy multiple paths into a destination directory
    // Phase 7c: Explorer multi-select copy.
    // -------------------------------------------------------
    'fs.batchCopy': async (ws, id, payload) => {
      const rawPaths = Array.isArray(payload.paths) ? payload.paths as unknown[] : [];
      const rawDest = String(payload.destination ?? '');

      if (rawPaths.length === 0) {
        sendJson(ws, makeFailure(id, 'paths array is required and must be non-empty'));
        return;
      }
      if (!rawDest) {
        sendJson(ws, makeFailure(id, 'destination is required'));
        return;
      }

      const destPath = guardedPath(rawDest);
      if (!destPath) {
        sendJson(ws, makeFailure(id, 'Destination path is outside allowed workspace roots'));
        return;
      }

      const resolvedPaths: string[] = [];
      for (const raw of rawPaths) {
        const p = guardedPath(String(raw));
        if (!p) {
          sendJson(ws, makeFailure(id, `Source path is outside allowed workspace roots: ${raw}`));
          return;
        }
        resolvedPaths.push(p);
      }

      try {
        mkdirSync(destPath, { recursive: true });
      } catch (err) {
        sendJson(ws, makeFailure(id, `Cannot create destination directory: ${err instanceof Error ? err.message : err}`));
        return;
      }

      const total = resolvedPaths.length;
      let copiedCount = 0;

      for (let i = 0; i < resolvedPaths.length; i++) {
        const srcPath = resolvedPaths[i];
        const fileName = srcPath.split('/').pop() ?? srcPath;
        const targetPath = join(destPath, fileName);
        try {
          const s = statSync(srcPath);
          if (s.isDirectory()) {
            copyDirRecursive(srcPath, targetPath);
          } else {
            ensureDirFor(targetPath);
            copyFileSync(srcPath, targetPath);
          }
          copiedCount++;
          sendJson(ws, makeChunk(id, [{ type: 'progress', path: srcPath, index: i + 1, total }]));
        } catch (err) {
          sendJson(ws, makeChunk(id, [{
            type: 'error',
            path: srcPath,
            error: err instanceof Error ? err.message : 'copy failed',
          }]));
        }
      }

      sendJson(ws, makeSuccess(id, { type: 'done', copiedCount }));
    },

    // Zip and unzip handlers (fs.zip, fs.unzip) live in fs-zip.ts
    ...zipHandlers,
  };
}

// -------------------------------------------------------
// Internal helper — recursive directory copy
// -------------------------------------------------------

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const entries = readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}
