// ============================================================
// handlers/system.ts — system.* RPC handlers (processes, ports, stats)
// ============================================================

import type { ServerContext, RpcHandler } from '../context';
import { execFileAsync } from '../utils';

export function createSystemHandlers(ctx: ServerContext): Record<string, RpcHandler> {
  const { workspaceRoot, sendJson, makeSuccess, makeFailure } = ctx;

  return {
    'system.processes': async (ws, id) => {
      try {
        let stdout = '';
        try {
          ({ stdout } = await execFileAsync(
            'ps', ['-eo', 'pid,ppid,user,%cpu,%mem,stat,comm', '--sort=-%cpu', '--no-headers'],
            { timeout: 5000 },
          ));
        } catch {
          ({ stdout } = await execFileAsync('ps', ['aux'], { timeout: 5000 }));
        }
        const lines = stdout.trim().split('\n').filter(Boolean).slice(0, 60);
        const processes = lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return {
            pid: parts[0] ?? '',
            user: parts[2] ?? '',
            cpu: parts[3] ?? '',
            mem: parts[4] ?? '',
            name: parts.slice(10).join(' ') || parts[parts.length - 1] || '',
          };
        });
        sendJson(ws, makeSuccess(id, { processes }));
      } catch {
        sendJson(ws, makeFailure(id, 'Failed to list processes'));
      }
    },

    'system.ports': async (ws, id) => {
      try {
        let stdout = '';
        try {
          // macOS / BSD
          ({ stdout } = await execFileAsync(
            'lsof', ['-i', '-n', '-P', '-sTCP:LISTEN'],
            { timeout: 5000 },
          ));
        } catch {
          try {
            // Linux
            ({ stdout } = await execFileAsync('ss', ['-tlnp'], { timeout: 5000 }));
          } catch {
            ({ stdout } = await execFileAsync('netstat', ['-tlnp'], { timeout: 5000 }));
          }
        }
        const lines = stdout.trim().split('\n').filter(Boolean).slice(1);
        const ports: Array<{ port: string; pid: string; process: string; address: string }> = [];
        for (const line of lines) {
          const parts = line.trim().split(/\s+/);
          if (parts.length < 9) continue;
          const name = parts[0] ?? '';
          const pid = parts[1] ?? '';
          const addr = parts[8] ?? '';
          const portMatch = addr.match(/:(\d+)$/);
          if (!portMatch) continue;
          ports.push({ port: portMatch[1], pid, process: name, address: addr });
        }
        sendJson(ws, makeSuccess(id, { ports }));
      } catch {
        sendJson(ws, makeFailure(id, 'Failed to list ports'));
      }
    },

    'system.stats': async (ws, id) => {
      try {
        const [diskResult, memResult] = await Promise.allSettled([
          execFileAsync('df', ['-h', workspaceRoot], { timeout: 5000 }),
          execFileAsync('vm_stat', [], { timeout: 5000 }).catch(() =>
            execFileAsync('free', ['-h'], { timeout: 5000 }),
          ),
        ]);
        const disk = diskResult.status === 'fulfilled' ? diskResult.value.stdout : '';
        const mem = memResult.status === 'fulfilled'
          ? (memResult.value as { stdout: string }).stdout
          : '';

        const diskLines = disk.trim().split('\n').slice(1);
        const diskInfo = diskLines[0]?.trim().split(/\s+/) ?? [];
        const diskStats = {
          filesystem: diskInfo[0] ?? '',
          size: diskInfo[1] ?? '',
          used: diskInfo[2] ?? '',
          avail: diskInfo[3] ?? '',
          usePercent: diskInfo[4] ?? '',
        };

        sendJson(ws, makeSuccess(id, { disk: diskStats, memRaw: mem }));
      } catch {
        sendJson(ws, makeFailure(id, 'Failed to get system stats'));
      }
    },
  };
}
