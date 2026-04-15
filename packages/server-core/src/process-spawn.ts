// WHAT: Managed process and terminal spawning helpers for the Stavi server.
// WHY:  context.ts exceeded 400 lines; process/terminal spawn logic is a clear seam.
// HOW:  Exports createProcessHelpers() (spawnManagedProcess, serializeManagedProcess,
//       createTerminalSession). Called once by createServerContext().
// SEE:  packages/server-core/src/context.ts, packages/server-core/src/handlers/process.ts,
//       packages/server-core/src/handlers/terminal.ts

import type { ManagedProcess, TerminalSession } from './types';
import { resolveWorkspacePath, truncateHistory, getShell } from './utils';

// ----------------------------------------------------------
// Factory
// ----------------------------------------------------------

export function createProcessHelpers(
  managedProcesses: Map<string, ManagedProcess>,
  terminalSessions: Map<string, TerminalSession>,
  state: { managedProcessCounter: number },
  workspaceRoot: string,
  emitProcessEvent: (event: Record<string, unknown>) => void,
  emitTerminalEvent: (event: Record<string, unknown>) => void,
): {
  spawnManagedProcess: (command: string, args: string[], cwd: string) => ManagedProcess;
  serializeManagedProcess: (p: ManagedProcess) => object;
  createTerminalSession: (
    threadId: string,
    terminalId: string,
    cwdInput: string,
    cols?: number,
    rows?: number,
  ) => TerminalSession;
} {
  const serializeManagedProcess = (p: ManagedProcess) => ({
    id: p.id,
    command: p.command,
    args: p.args,
    cwd: p.cwd,
    pid: p.pid,
    status: p.status,
    startTime: p.startTime,
    output: p.output,
  });

  const spawnManagedProcess = (command: string, args: string[], cwd: string): ManagedProcess => {
    const id = `proc-${++state.managedProcessCounter}`;
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0];
    const cmdArgs = [...parts.slice(1), ...args].filter(Boolean);
    const resolvedCwd = resolveWorkspacePath(workspaceRoot, cwd || '.');

    const managed: ManagedProcess = {
      id,
      command,
      args: cmdArgs,
      cwd: resolvedCwd,
      pid: 0,
      status: 'running',
      startTime: Date.now(),
      output: '',
      proc: null as any,
    };
    managedProcesses.set(id, managed);

    const proc = Bun.spawn([cmd, ...cmdArgs], {
      cwd: resolvedCwd,
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: 'ignore',
      env: { ...process.env },
    });

    managed.proc = proc;
    managed.pid = proc.pid;

    const appendOutput = (text: string) => {
      managed.output = managed.output.length > 200_000
        ? managed.output.slice(-100_000) + text
        : managed.output + text;
      emitProcessEvent({ type: 'output', id, data: text });
    };

    (async () => {
      try {
        for await (const chunk of proc.stdout as AsyncIterable<Uint8Array>) {
          appendOutput(new TextDecoder().decode(chunk));
        }
      } catch { /* process ended */ }
    })();

    (async () => {
      try {
        for await (const chunk of proc.stderr as AsyncIterable<Uint8Array>) {
          appendOutput(new TextDecoder().decode(chunk));
        }
      } catch { /* process ended */ }
    })();

    (async () => {
      try {
        const exitCode = await proc.exited;
        managed.status = 'exited';
        emitProcessEvent({ type: 'exited', id, exitCode });
      } catch { /* ignore */ }
    })();

    emitProcessEvent({ type: 'started', id, process: serializeManagedProcess(managed) });
    return managed;
  };

  const createTerminalSession = (
    threadId: string,
    terminalId: string,
    cwdInput: string,
    cols?: number,
    rows?: number,
  ): TerminalSession => {
    if (!threadId) throw new Error('threadId is required');
    const key = `${threadId}:${terminalId}`;
    const existing = terminalSessions.get(key);
    if (existing) return existing;

    const cwd = resolveWorkspacePath(workspaceRoot, cwdInput || '.');
    const shell = getShell();

    const session: TerminalSession = {
      threadId,
      terminalId,
      cwd,
      history: '',
      proc: null as any,
      status: 'running',
    };
    terminalSessions.set(key, session);

    const proc = Bun.spawn([shell], {
      cwd,
      env: { ...process.env, TERM: 'xterm-256color' },
      terminal: {
        cols: cols ?? 80,
        rows: rows ?? 24,
        data(_terminal: any, chunk: Uint8Array) {
          const text = new TextDecoder().decode(chunk);
          session.history = truncateHistory(session.history + text);
          emitTerminalEvent({ type: 'output', threadId, terminalId, data: text });
        },
        exit(_terminal: any) {
          session.status = 'exited';
          emitTerminalEvent({
            type: 'exited',
            threadId,
            terminalId,
            exitCode: proc.exitCode ?? 0,
          });
        },
      },
    });

    session.proc = proc;
    return session;
  };

  return { spawnManagedProcess, serializeManagedProcess, createTerminalSession };
}
