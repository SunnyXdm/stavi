// @stavi/shared — Shared types for the Stavi mobile IDE
// No build step — consumed as raw TypeScript

// Plugin system
export type {
  PluginScope,
  PluginKind,
  PluginDefinition,
  WorkspacePluginDefinition,
  ServerPluginDefinition,
  PluginInstance,
  PluginStatus,
  PluginPanelProps,
  WorkspacePluginPanelProps,
  ServerPluginPanelProps,
  PluginPermission,
  PluginAPI,
  SessionRegistration,
  SessionEntry,
} from './plugin-types';

// Plugin events
export { PluginEvents } from './plugin-events';
export type { PluginEventPayloads, EventPayload } from './plugin-events';

// GPI (cross-plugin APIs)
export type {
  GPIRegistry,
  TerminalPluginAPI,
  EditorPluginAPI,
  AIPluginAPI,
  GitPluginAPI,
  ExplorerPluginAPI,
  SearchPluginAPI,
} from './gpi-types';

// Transport
export type {
  ConnectionState,
  ConnectionConfig,
  SavedConnection,
  RpcMessage,
  RpcResponse,
  RpcNamespace,
  SubscriptionMessage,
  PairingPayload,
} from './transport-types';

// Domain types
export type {
  TerminalSession,
  TerminalTheme,
  FsEntry,
  GitStatus,
  GitFileChange,
  GitLogEntry,
  GitDiff,
  GitDiffHunk,
  GitDiffLine,
  ProcessInfo,
  PortInfo,
  SystemInfo,
  AIBackend,
  AIThread,
  AIMessage,
  AIActivity,
  AIApprovalRequest,
  AICheckpoint,
  AICheckpointFile,
  Session,
  SessionWithThreads,
  SessionStatus,
  AgentRuntime,
  OrchestrationThread,
} from './domain-types';
