// ============================================================
// utils/event-helpers.ts — Pure helpers: server payload → AIMessage / AIPart
// ============================================================

import type { AIMessage, AIPart } from '../types';
import { applyMessageUpdate } from '../streaming';

export function rawMessageToAIMessage(raw: any, threadId: string): AIMessage {
  const text: string = raw.text ?? '';
  const parts: AIPart[] = text ? [{ type: 'text', text }] : [];
  return {
    messageId: raw.messageId ?? raw.id ?? `msg-${Date.now()}`,
    threadId,
    role: raw.role ?? 'assistant',
    parts,
    turnId: raw.turnId,
    streaming: raw.streaming ?? false,
    createdAt: raw.createdAt ?? new Date().toISOString(),
  };
}

export { applyMessageUpdate };

/**
 * Convert a server activity event payload into an AIPart for merging
 * into the active assistant message.
 *
 * The server sends: { threadId, turnId, type: 'reasoning'|'tool-use'|'tool-result', text?, toolName?, ... }
 */
export function activityPayloadToAIPart(payload: any): AIPart | null {
  const kind: string = payload.type ?? '';

  if (kind === 'reasoning') {
    return { type: 'reasoning', text: payload.text ?? '' };
  }
  if (kind === 'tool-use') {
    return {
      type: 'tool-call',
      id: payload.toolId,
      toolName: payload.toolName ?? 'tool',
      state: payload.state ?? 'running',
      input: payload.input,
    };
  }
  if (kind === 'tool-result') {
    return {
      type: 'tool-result',
      id: payload.toolId,
      toolName: payload.toolName ?? 'tool',
      output: payload.result,
    };
  }
  return null;
}

/**
 * Merge an activity-derived AIPart into the last assistant message's parts.
 * For reasoning: accumulate text onto existing reasoning part.
 * For tool-use/tool-result: add or update by toolId.
 */
export function mergeActivityPart(messages: AIMessage[], part: AIPart, turnId?: string): AIMessage[] {
  if (messages.length === 0) return messages;

  let targetIdx = -1;
  if (turnId) {
    targetIdx = messages.findIndex((m) => m.role === 'assistant' && m.turnId === turnId);
  }
  if (targetIdx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') { targetIdx = i; break; }
    }
  }
  if (targetIdx === -1) return messages;

  const msg = messages[targetIdx];
  const parts = [...msg.parts];

  if (part.type === 'reasoning') {
    const existingIdx = parts.findIndex((p) => p.type === 'reasoning');
    if (existingIdx >= 0) {
      const existing = parts[existingIdx] as any;
      parts[existingIdx] = { ...existing, text: (existing.text ?? '') + (part as any).text };
    } else {
      const firstTextIdx = parts.findIndex((p) => p.type === 'text');
      if (firstTextIdx >= 0) { parts.splice(firstTextIdx, 0, part); } else { parts.push(part); }
    }
  } else if (part.type === 'tool-call' || part.type === 'tool-result') {
    const partId = (part as any).id;
    if (partId) {
      const existingIdx = parts.findIndex((p) => (p as any).id === partId);
      if (existingIdx >= 0) {
        parts[existingIdx] = { ...parts[existingIdx], ...part };
      } else {
        parts.push(part);
      }
    } else {
      parts.push(part);
    }
  } else {
    parts.push(part);
  }

  const updated = [...messages];
  updated[targetIdx] = { ...msg, parts };
  return updated;
}
