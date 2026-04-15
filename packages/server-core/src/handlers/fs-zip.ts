// WHAT: Phase 7c zip RPC handlers: fs.zip and fs.unzip.
// WHY:  Split from fs-batch.ts to keep every file under 400 lines.
//       Zip is a distinct operational concern (streaming archive creation vs
//       simple batch file ops) — clean seam.
// HOW:  fs.zip uses `archiver` (npm) to stream a zip archive to a destination
//       file, emitting a Chunk per entry. fs.unzip uses `unzipper` (npm) to
//       stream-extract, emitting a Chunk per entry. Both include path-traversal
//       guards on every source path AND a zip-slip guard during extraction.
//       Chunk format:
//         { type:'progress', path }     — one per file added/extracted
//         { type:'error', error }       — non-fatal error (operation continues)
//       Final response: Exit.Success with { type:'done', size, destination } (zip)
//                       or { type:'done', extractedCount } (unzip).
// SEE:  packages/server-core/src/handlers/fs-batch.ts,
//       docs/PROTOCOL.md §5.5 (fs.zip, fs.unzip)

import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  statSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import archiver from 'archiver';
import unzipper from 'unzipper';
import type { ServerContext, RpcHandler } from '../context';

export function createFsZipHandlers(
  ctx: ServerContext,
  guardedPath: (raw: string) => string | null,
): Record<string, RpcHandler> {
  const { sendJson, makeSuccess, makeFailure, makeChunk } = ctx;

  function ensureDirFor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
  }

  return {

    // -------------------------------------------------------
    // fs.zip — create a zip archive from a list of paths
    // Uses `archiver` npm package (streaming write). Each 'entry' event
    // on the archiver drives a progress Chunk so the client can update
    // a progress bar as the archive is built.
    // -------------------------------------------------------
    'fs.zip': async (ws, id, payload) => {
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

      // Guard all source paths before starting
      const resolvedPaths: string[] = [];
      for (const raw of rawPaths) {
        const p = guardedPath(String(raw));
        if (!p) {
          sendJson(ws, makeFailure(id, `Source path is outside allowed workspace roots: ${raw}`));
          return;
        }
        resolvedPaths.push(p);
      }

      ensureDirFor(destPath);

      await new Promise<void>((resolveFn, rejectFn) => {
        const output = createWriteStream(destPath);
        const archive = archiver('zip', { zlib: { level: 6 } });

        output.on('close', () => {
          const size = archive.pointer();
          sendJson(ws, makeSuccess(id, { type: 'done', size, destination: destPath }));
          resolveFn();
        });

        archive.on('error', (err: Error) => {
          sendJson(ws, makeChunk(id, [{ type: 'error', error: err.message }]));
          rejectFn(err);
        });

        // Each 'entry' event = one file committed to the archive
        archive.on('entry', (entry: { name: string }) => {
          sendJson(ws, makeChunk(id, [{ type: 'progress', path: entry.name }]));
        });

        archive.pipe(output);

        for (const srcPath of resolvedPaths) {
          const name = srcPath.split('/').pop() ?? srcPath;
          try {
            const s = statSync(srcPath);
            if (s.isDirectory()) {
              archive.directory(srcPath, name);
            } else {
              archive.file(srcPath, { name });
            }
          } catch (err) {
            sendJson(ws, makeChunk(id, [{
              type: 'error',
              error: `Cannot stat ${srcPath}: ${err instanceof Error ? err.message : err}`,
            }]));
          }
        }

        archive.finalize();
      }).catch(() => { /* errors already sent as chunks */ });
    },

    // -------------------------------------------------------
    // fs.unzip — extract a zip archive to a destination directory
    // Uses `unzipper` npm package (streaming parse). Each 'entry' event
    // drives a progress Chunk. Zip-slip protection: extracted paths are
    // validated to stay within destPath.
    // -------------------------------------------------------
    'fs.unzip': async (ws, id, payload) => {
      const rawSource = String(payload.source ?? '');
      const rawDest = String(payload.destination ?? '');

      if (!rawSource) {
        sendJson(ws, makeFailure(id, 'source is required'));
        return;
      }
      if (!rawDest) {
        sendJson(ws, makeFailure(id, 'destination is required'));
        return;
      }

      const sourcePath = guardedPath(rawSource);
      if (!sourcePath) {
        sendJson(ws, makeFailure(id, 'Source path is outside allowed workspace roots'));
        return;
      }

      const destPath = guardedPath(rawDest);
      if (!destPath) {
        sendJson(ws, makeFailure(id, 'Destination path is outside allowed workspace roots'));
        return;
      }

      try {
        mkdirSync(destPath, { recursive: true });
      } catch (err) {
        sendJson(ws, makeFailure(id, `Cannot create destination directory: ${err instanceof Error ? err.message : err}`));
        return;
      }

      let extractedCount = 0;

      await new Promise<void>((resolveFn, rejectFn) => {
        const stream = createReadStream(sourcePath)
          .pipe(unzipper.Parse({ forceStream: true }));

        stream.on('entry', (entry: unzipper.Entry) => {
          const entryPath = entry.path;
          const fullDest = join(destPath, entryPath);
          const type = entry.type; // 'Directory' | 'File'

          sendJson(ws, makeChunk(id, [{ type: 'progress', path: entryPath }]));

          if (type === 'Directory') {
            mkdirSync(fullDest, { recursive: true });
            entry.autodrain();
          } else {
            // Zip-slip protection: skip entries whose resolved path escapes destPath
            if (!fullDest.startsWith(destPath + '/') && fullDest !== destPath) {
              entry.autodrain();
              return;
            }
            ensureDirFor(fullDest);
            entry.pipe(createWriteStream(fullDest))
              .on('finish', () => { extractedCount++; })
              .on('error', (err: Error) => {
                sendJson(ws, makeChunk(id, [{ type: 'error', error: err.message }]));
              });
          }
        });

        stream.on('finish', () => {
          sendJson(ws, makeSuccess(id, { type: 'done', extractedCount }));
          resolveFn();
        });

        stream.on('error', (err: Error) => {
          sendJson(ws, makeChunk(id, [{ type: 'error', error: err.message }]));
          rejectFn(err);
        });
      }).catch(() => { /* errors already sent as chunks */ });
    },
  };
}
