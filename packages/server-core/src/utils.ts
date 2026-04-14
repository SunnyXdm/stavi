// ============================================================
// utils.ts — Pure utility functions shared across handlers
// ============================================================

import { existsSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { WebSocket } from 'ws';
import type { GitStatusPayload, RpcChunk, RpcExit } from './types';

export const execFileAsync = promisify(execFile);

export const MAX_HISTORY_CHARS = 100_000;
export const GIT_STATUS_POLL_MS = 4000;

// ----------------------------------------------------------
// Time
// ----------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

// ----------------------------------------------------------
// Paths
// ----------------------------------------------------------

export function resolveWorkspacePath(root: string, maybePath: string): string {
  return maybePath.startsWith('/') ? maybePath : resolve(root, maybePath);
}

// ----------------------------------------------------------
// Terminal
// ----------------------------------------------------------

export function truncateHistory(history: string): string {
  if (history.length <= MAX_HISTORY_CHARS) return history;
  return history.slice(history.length - MAX_HISTORY_CHARS);
}

export function getShell(): string {
  if (process.env.STAVI_SHELL) return process.env.STAVI_SHELL;
  if (process.env.SHELL) return process.env.SHELL;
  for (const shell of ['/bin/zsh', '/bin/bash', '/bin/sh']) {
    if (existsSync(shell)) return shell;
  }
  return '/bin/sh';
}

// ----------------------------------------------------------
// RPC message factories
// ----------------------------------------------------------

export function makeChunk(requestId: string, values: unknown[]): RpcChunk {
  return { _tag: 'Chunk', requestId, values };
}

export function makeSuccess(requestId: string, value?: unknown): RpcExit {
  return { _tag: 'Exit', requestId, exit: { _tag: 'Success', value } };
}

export function makeFailure(requestId: string, message: string): RpcExit {
  return {
    _tag: 'Exit',
    requestId,
    exit: { _tag: 'Failure', cause: { _tag: 'Fail', error: { message } } },
  };
}

export function sendJson(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

// ----------------------------------------------------------
// Git
// ----------------------------------------------------------

function mapGitStatus(code: string): string {
  switch (code) {
    case 'A':
    case '?':
      return 'added';
    case 'D':
      return 'deleted';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}

export async function getGitStatus(cwd: string): Promise<GitStatusPayload> {
  try {
    const { stdout } = await execFileAsync('git', ['status', '--porcelain=1', '-b'], { cwd });
    const lines = stdout.split('\n').filter(Boolean);
    const first = lines.shift() ?? '';
    let branch = '';
    let ahead = 0;
    let behind = 0;

    if (first.startsWith('## ')) {
      const branchPart = first.slice(3);
      const [namePart, trackingPart] = branchPart.split('...');
      branch = namePart || '';
      const match = trackingPart?.match(/\[(.*)\]/);
      if (match) {
        for (const part of match[1].split(',')) {
          const trimmed = part.trim();
          if (trimmed.startsWith('ahead ')) ahead = Number.parseInt(trimmed.slice(6), 10) || 0;
          if (trimmed.startsWith('behind ')) behind = Number.parseInt(trimmed.slice(7), 10) || 0;
        }
      }
    }

    const staged: GitStatusPayload['staged'] = [];
    const unstaged: GitStatusPayload['unstaged'] = [];
    const untracked: string[] = [];

    for (const line of lines) {
      const xy = line.slice(0, 2);
      const rawPath = line.slice(3).trim();
      const path = rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() ?? rawPath : rawPath;

      if (xy === '??') {
        untracked.push(path);
        continue;
      }

      const stagedCode = xy[0];
      const unstagedCode = xy[1];

      if (stagedCode && stagedCode !== ' ') {
        staged.push({ path, status: mapGitStatus(stagedCode) });
      }
      if (unstagedCode && unstagedCode !== ' ') {
        unstaged.push({ path, status: mapGitStatus(unstagedCode) });
      }
    }

    return { branch, ahead, behind, staged, unstaged, untracked };
  } catch {
    return { branch: '', ahead: 0, behind: 0, staged: [], unstaged: [], untracked: [] };
  }
}

// ----------------------------------------------------------
// Search
// ----------------------------------------------------------

export async function searchEntries(cwd: string, query: string, limit: number) {
  const normalizedLimit = Math.max(1, Math.min(limit || 200, 1000));
  const entries = new Map<string, { name: string; path: string; type: 'file' | 'directory' }>();

  const addDirectoryAncestors = (relativePath: string) => {
    const parts = relativePath.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i++) {
      const path = parts.slice(0, i).join('/');
      entries.set(path, { name: parts[i - 1], path, type: 'directory' });
    }
  };

  try {
    const { stdout } = await execFileAsync('rg', ['--files', '-g', '!node_modules', '-g', '!.git'], {
      cwd,
      maxBuffer: 5 * 1024 * 1024,
    });
    const matcher = query && query !== '*' ? query.toLowerCase() : null;

    for (const filePath of stdout.split('\n').filter(Boolean)) {
      const haystack = filePath.toLowerCase();
      if (matcher && !haystack.includes(matcher)) continue;
      addDirectoryAncestors(filePath);
      entries.set(filePath, {
        name: filePath.split('/').pop() ?? filePath,
        path: filePath,
        type: 'file',
      });
      if (entries.size >= normalizedLimit) break;
    }
  } catch {
    // Return empty on search failure
  }

  return Array.from(entries.values())
    .sort((a, b) => a.path.localeCompare(b.path))
    .slice(0, normalizedLimit);
}

// ----------------------------------------------------------
// Network
// ----------------------------------------------------------

export function detectLocalIp(): string {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.internal || net.family !== 'IPv4') continue;
      return net.address;
    }
  }
  return '127.0.0.1';
}

// ----------------------------------------------------------
// AI fallback reply
// ----------------------------------------------------------

export function createAssistantReply(
  input: string,
  providerInfos?: Array<{ provider: string; name: string; authenticated: boolean }>,
): string {
  const trimmed = input.trim();
  if (!trimmed) return 'Local Stavi server is running.';

  const lines: string[] = [`No AI provider is currently available.\n`];
  if (providerInfos && providerInfos.length > 0) {
    for (const p of providerInfos) {
      if (p.provider === 'claude') {
        lines.push(p.authenticated
          ? `- **${p.name}**: Connected`
          : `- **${p.name}**: No API key. Set \`ANTHROPIC_API_KEY\` env var or add key in the app settings.`);
      } else if (p.provider === 'codex') {
        lines.push(p.authenticated
          ? `- **${p.name}**: Connected`
          : `- **${p.name}**: CLI not found. Install with \`npm install -g @openai/codex\` and run \`codex auth login\`.`);
      }
    }
  } else {
    lines.push('Set your `ANTHROPIC_API_KEY` or install the Codex CLI to enable AI responses.');
  }

  return lines.join('\n');
}
