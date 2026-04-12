// ============================================================
// AI Plugin — Core Types
// ============================================================
// AIPart-based message model. Every message is an array of
// typed parts — text, tool calls, reasoning blocks, file diffs,
// step markers, etc. Maps cleanly onto the server's orchestration
// domain events.

// ----------------------------------------------------------
// Parts
// ----------------------------------------------------------

export type AIPart =
  | TextPart
  | ReasoningPart
  | ToolPart
  | ToolCallPart
  | ToolResultPart
  | FileChangePart
  | FilePart
  | StepStartPart
  | StepFinishPart;

export interface TextPart {
  type: 'text';
  id?: string;
  text: string;
}

export interface ReasoningPart {
  type: 'reasoning';
  id?: string;
  text: string;
}

export interface ToolPart {
  type: 'tool';
  id?: string;
  name: string;
  toolName?: string;
  state?: 'pending' | 'running' | 'completed' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
}

export interface ToolCallPart {
  type: 'tool-call';
  id?: string;
  name?: string;
  toolName: string;
  state?: 'pending' | 'running' | 'completed' | 'error';
  input?: unknown;
}

export interface ToolResultPart {
  type: 'tool-result';
  id?: string;
  name?: string;
  toolName: string;
  output?: unknown;
  error?: string;
}

export interface FileChangePart {
  type: 'file-change';
  id?: string;
  path?: string;
  diff?: string;
  action?: 'edit' | 'create' | 'delete' | 'rename';
}

export interface FilePart {
  type: 'file';
  id?: string;
  filename?: string;
  mime?: string;
  url?: string;
}

export interface StepStartPart {
  type: 'step-start';
  id?: string;
  title?: string;
}

export interface StepFinishPart {
  type: 'step-finish';
  id?: string;
  tokens?: {
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
  cost?: number;
  time?: { start?: number; end?: number };
}

// ----------------------------------------------------------
// Message
// ----------------------------------------------------------

export interface AIMessage {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  parts: AIPart[];
  turnId?: string;
  streaming?: boolean;
  createdAt: string;
  /** localStatus is set for optimistic messages before server confirms */
  localStatus?: 'sending' | 'sent';
}

// ----------------------------------------------------------
// Approval / Permission
// ----------------------------------------------------------

export interface AIPermission {
  id: string;
  requestId: string;
  threadId: string;
  type: string;
  title: string;
  command?: string;
  cwd?: string;
  reason?: string;
}

// ----------------------------------------------------------
// Server orchestration event shapes
// ----------------------------------------------------------

/**
 * Raw server message from subscribeOrchestrationDomainEvents.
 * The server sends flat `text` strings on thread.message-sent.
 * We map these to AIPart[] in useOrchestration.
 */
export interface RawOrchestrationMessage {
  messageId: string;
  threadId: string;
  role: 'user' | 'assistant';
  text: string;
  turnId?: string;
  streaming?: boolean;
  createdAt: string;
}

export interface OrchestrationEvent {
  type: string;
  occurredAt: string;
  sequence?: number;
  payload?: unknown;
}
