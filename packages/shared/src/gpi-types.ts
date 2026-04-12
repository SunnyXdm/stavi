// ============================================================
// GPI (Global Plugin Interface) — typed cross-plugin APIs
// ============================================================

import type { PluginAPI } from './plugin-types';

// Each plugin that exposes a cross-plugin API defines its interface here.
// The GPI Proxy routes `gPI.terminal.runCommand(cmd)` to the terminal plugin's api() factory.

export interface TerminalPluginAPI extends PluginAPI {
  createSession(workingDir?: string): Promise<{ sessionId: string }>;
  attachSession(sessionId: string): Promise<void>;
  sendInput(sessionId: string, data: string): void;
  listSessions(): Promise<Array<{ id: string; name: string; workingDir: string }>>;
}

export interface EditorPluginAPI extends PluginAPI {
  openFile(path: string, line?: number): Promise<void>;
  saveFile(path: string): Promise<void>;
  getCurrentFile(): string | null;
}

export interface AIPluginAPI extends PluginAPI {
  sendMessage(text: string, threadId?: string): Promise<{ threadId: string; turnId: string }>;
  interruptTurn(threadId?: string): Promise<void>;
  respondToApproval(threadId: string, requestId: string, decision: 'accept' | 'reject' | 'always-allow'): Promise<void>;
  listThreads(): Promise<Array<{ id: string; title: string }>>;
}

export interface GitPluginAPI extends PluginAPI {
  getStatus(): Promise<{ branch: string; staged: string[]; unstaged: string[]; untracked: string[] }>;
  stage(paths: string[]): Promise<void>;
  commit(message: string): Promise<{ hash: string }>;
  diff(path?: string): Promise<string>;
}

export interface ExplorerPluginAPI extends PluginAPI {
  listDirectory(path: string): Promise<Array<{ name: string; type: 'file' | 'directory'; size: number }>>;
  navigateTo(path: string): Promise<void>;
}

export interface SearchPluginAPI extends PluginAPI {
  search(query: string, options?: { glob?: string; caseSensitive?: boolean }): Promise<Array<{ path: string; line: number; text: string }>>;
}

// Registry of all known GPI interfaces — used by the Proxy for type safety
export interface GPIRegistry {
  terminal: TerminalPluginAPI;
  editor: EditorPluginAPI;
  ai: AIPluginAPI;
  git: GitPluginAPI;
  explorer: ExplorerPluginAPI;
  search: SearchPluginAPI;
}
