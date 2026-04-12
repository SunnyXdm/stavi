// ============================================================
// Provider Types — Shared interface for AI provider adapters
// ============================================================
// Plain async TypeScript with async generators. No framework
// dependencies — just interfaces and type unions.

// ----------------------------------------------------------
// Provider identity
// ----------------------------------------------------------

export type ProviderKind = 'claude' | 'codex';

// ----------------------------------------------------------
// Model information
// ----------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  provider: ProviderKind;
  supportsThinking: boolean;
  maxTokens: number;
  contextWindow: number;
  isDefault?: boolean;
}

export interface ProviderInfo {
  provider: ProviderKind;
  name: string;
  installed: boolean;
  authenticated: boolean;
  models: ModelInfo[];
  error?: string;
}

// ----------------------------------------------------------
// Model selection (from client)
// ----------------------------------------------------------

export interface ModelSelection {
  provider: ProviderKind;
  modelId: string;
  thinking?: boolean;
  thinkingBudget?: number;
  effort?: 'low' | 'medium' | 'high';
}

// ----------------------------------------------------------
// Provider events (streaming output)
// ----------------------------------------------------------

export type ProviderEventType =
  // Text streaming
  | 'text-delta'
  | 'text-done'
  // Thinking/reasoning
  | 'thinking-delta'
  | 'thinking-done'
  // Tool use
  | 'tool-use-start'
  | 'tool-use-delta'
  | 'tool-use-done'
  | 'tool-result'
  // Approval
  | 'approval-required'
  | 'approval-resolved'
  // Turn lifecycle
  | 'turn-start'
  | 'turn-complete'
  | 'turn-error'
  // Session lifecycle
  | 'session-ready'
  | 'session-error';

export interface ProviderEvent {
  type: ProviderEventType;
  threadId: string;
  turnId?: string;
  data: Record<string, unknown>;
}

// Convenience constructors
export function textDelta(threadId: string, text: string, turnId?: string): ProviderEvent {
  return { type: 'text-delta', threadId, turnId, data: { text } };
}

export function textDone(threadId: string, fullText: string, turnId?: string): ProviderEvent {
  return { type: 'text-done', threadId, turnId, data: { text: fullText } };
}

export function thinkingDelta(threadId: string, text: string, turnId?: string): ProviderEvent {
  return { type: 'thinking-delta', threadId, turnId, data: { text } };
}

export function thinkingDone(threadId: string, fullText: string, turnId?: string): ProviderEvent {
  return { type: 'thinking-done', threadId, turnId, data: { text: fullText } };
}

export function toolUseStart(
  threadId: string,
  toolName: string,
  toolId: string,
  input: unknown,
  turnId?: string,
): ProviderEvent {
  return { type: 'tool-use-start', threadId, turnId, data: { toolName, toolId, input } };
}

export function toolUseDone(
  threadId: string,
  toolId: string,
  result: unknown,
  turnId?: string,
): ProviderEvent {
  return { type: 'tool-use-done', threadId, turnId, data: { toolId, result } };
}

export function turnComplete(threadId: string, turnId?: string, usage?: { inputTokens: number; outputTokens: number }): ProviderEvent {
  return { type: 'turn-complete', threadId, turnId, data: { usage: usage ?? null } };
}

export function turnError(threadId: string, error: string, turnId?: string): ProviderEvent {
  return { type: 'turn-error', threadId, turnId, data: { error } };
}

export function approvalRequired(
  threadId: string,
  requestId: string,
  toolName: string,
  toolInput: unknown,
  turnId?: string,
): ProviderEvent {
  return {
    type: 'approval-required',
    threadId,
    turnId,
    data: { requestId, toolName, toolInput },
  };
}

// ----------------------------------------------------------
// Approval decisions
// ----------------------------------------------------------

export type ApprovalDecision = 'accept' | 'reject' | 'always-allow';

// ----------------------------------------------------------
// Provider adapter interface
// ----------------------------------------------------------

export interface SendTurnInput {
  threadId: string;
  text: string;
  modelSelection?: ModelSelection;
  interactionMode?: 'default' | 'plan';
  attachments?: Array<{ type: string; data: string }>;
}

export interface ProviderAdapter {
  readonly provider: ProviderKind;

  /**
   * Initialize the adapter. Called once at server startup.
   * Returns true if the adapter is ready to accept sessions.
   */
  initialize(): Promise<boolean>;

  /**
   * Check if this provider is authenticated and ready.
   */
  isReady(): boolean;

  /**
   * Get available models for this provider.
   */
  getModels(): ModelInfo[];

  /**
   * Start a new session for a thread.
   */
  startSession(threadId: string, cwd: string): Promise<void>;

  /**
   * Send a user turn and stream back events.
   * Returns an async iterable of ProviderEvents.
   */
  sendTurn(input: SendTurnInput): AsyncGenerator<ProviderEvent>;

  /**
   * Interrupt the current turn.
   */
  interruptTurn(threadId: string): Promise<void>;

  /**
   * Respond to a pending approval request.
   */
  respondToApproval(
    threadId: string,
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<void>;

  /**
   * Stop a session and clean up resources.
   */
  stopSession(threadId: string): Promise<void>;

  /**
   * Stop all sessions (server shutdown).
   */
  stopAll(): Promise<void>;
}

// ----------------------------------------------------------
// Settings
// ----------------------------------------------------------

export interface StaviSettings {
  anthropicApiKey?: string;
  defaultProvider?: ProviderKind;
  defaultModel?: string;
  codexBinaryPath?: string;
}

export function settingsPath(baseDir: string): string {
  return `${baseDir}/userdata/settings.json`;
}
