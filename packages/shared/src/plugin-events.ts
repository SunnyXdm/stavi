// ============================================================
// Well-Known Plugin Events — typed cross-plugin event contracts
// ============================================================

// Event name constants
export const PluginEvents = {
  // Terminal events
  TERMINAL_SESSION_CREATED: 'terminal:session:created',
  TERMINAL_SESSION_DIED: 'terminal:session:died',
  TERMINAL_SESSION_ATTACHED: 'terminal:session:attached',
  TERMINAL_OUTPUT: 'terminal:output',

  // Editor events
  FILE_OPENED: 'editor:file:opened',
  FILE_SAVED: 'editor:file:saved',
  FILE_CHANGED: 'editor:file:changed',
  FILE_CLOSED: 'editor:file:closed',

  // Git events
  GIT_STATUS_CHANGED: 'git:status:changed',
  GIT_BRANCH_CHANGED: 'git:branch:changed',
  GIT_COMMIT: 'git:commit',

  // AI events
  AI_TURN_STARTED: 'ai:turn:started',
  AI_TURN_COMPLETED: 'ai:turn:completed',
  AI_TURN_INTERRUPTED: 'ai:turn:interrupted',
  AI_APPROVAL_REQUESTED: 'ai:approval:requested',
  AI_ACTIVITY: 'ai:activity',

  // Navigation
  NAVIGATE_TO_FILE: 'nav:file',
  NAVIGATE_TO_TERMINAL: 'nav:terminal',
  NAVIGATE_TO_AI: 'nav:ai',

  // Plugin lifecycle
  PLUGIN_ACTIVATED: 'plugin:activated',
  PLUGIN_DEACTIVATED: 'plugin:deactivated',

  // Return-when-done (the brainrot pattern)
  RETURN_WHEN_DONE_REGISTERED: 'ui:return:registered',
  RETURN_WHEN_DONE_TRIGGERED: 'ui:return:triggered',

  // Editor cross-plugin events (Phase 4a)
  EDITOR_OPEN_FILE: 'editor.openFile',
  TERMINAL_OPEN_HERE: 'terminal.openHere',
} as const;

// Type-safe event payload map
export interface PluginEventPayloads {
  [PluginEvents.TERMINAL_SESSION_CREATED]: { sessionId: string; workingDir: string; name?: string };
  [PluginEvents.TERMINAL_SESSION_DIED]: { sessionId: string; exitCode?: number };
  [PluginEvents.TERMINAL_SESSION_ATTACHED]: { sessionId: string };
  [PluginEvents.TERMINAL_OUTPUT]: { sessionId: string; data: string; seq: number };

  [PluginEvents.FILE_OPENED]: { path: string; language: string };
  [PluginEvents.FILE_SAVED]: { path: string };
  [PluginEvents.FILE_CHANGED]: { path: string; dirty: boolean };
  [PluginEvents.FILE_CLOSED]: { path: string };

  [PluginEvents.GIT_STATUS_CHANGED]: { branch: string; staged: number; unstaged: number; untracked: number };
  [PluginEvents.GIT_BRANCH_CHANGED]: { from: string; to: string };
  [PluginEvents.GIT_COMMIT]: { hash: string; message: string };

  [PluginEvents.AI_TURN_STARTED]: { threadId: string; turnId: string; backend: string };
  [PluginEvents.AI_TURN_COMPLETED]: { threadId: string; turnId: string; backend: string };
  [PluginEvents.AI_TURN_INTERRUPTED]: { threadId: string; turnId: string };
  [PluginEvents.AI_APPROVAL_REQUESTED]: { threadId: string; requestId: string; tool: string; description: string };
  [PluginEvents.AI_ACTIVITY]: { threadId: string; type: string; description: string };

  [PluginEvents.NAVIGATE_TO_FILE]: { path: string; line?: number; column?: number };
  [PluginEvents.NAVIGATE_TO_TERMINAL]: { sessionId?: string };
  [PluginEvents.NAVIGATE_TO_AI]: { threadId?: string };

  [PluginEvents.PLUGIN_ACTIVATED]: { pluginId: string; instanceId: string };
  [PluginEvents.PLUGIN_DEACTIVATED]: { pluginId: string; instanceId: string };

  [PluginEvents.RETURN_WHEN_DONE_REGISTERED]: { sourcePluginId: string; targetPluginId: string };
  [PluginEvents.RETURN_WHEN_DONE_TRIGGERED]: { sourcePluginId: string; targetPluginId: string };

  // Editor cross-plugin events (Phase 4a)
  'editor.openFile': { sessionId: string; path: string; line?: number; column?: number };
  'terminal.openHere': { sessionId: string; cwd: string };
}

// Utility type to extract payload for a given event
export type EventPayload<E extends keyof PluginEventPayloads> = PluginEventPayloads[E];
