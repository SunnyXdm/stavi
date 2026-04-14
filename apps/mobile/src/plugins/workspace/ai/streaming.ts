// ============================================================
// AI Plugin — Streaming Utilities
// ============================================================
// Handles both accumulating streams (full string each event)
// and delta streams (incremental chunks).

import type { AIPart, AIMessage } from './types';

// ----------------------------------------------------------
// Text merging — handles both accumulating and delta streams
// ----------------------------------------------------------

/**
 * Merge an incoming streaming text chunk with the previously accumulated text.
 *
 * Two backends produce different stream shapes:
 *   - Accumulating: each event is the full string so far ("He" → "Hello" → "Hello world")
 *   - Delta: each event is only the new chars ("He" → "llo" → " world")
 *
 * This function handles both without knowing which mode is active, by detecting
 * prefix overlap between previous and incoming.
 */
export function mergeStreamingText(previous: string, incoming: string): string {
  if (!incoming) return previous;
  if (!previous) return incoming;

  // Incoming is a superset of previous — use it wholesale (accumulating mode)
  if (incoming.startsWith(previous)) return incoming;

  // Previous already contains incoming — keep previous (stale / out-of-order event)
  if (previous.startsWith(incoming)) return previous;

  // Find longest suffix of previous that is a prefix of incoming,
  // then concatenate the non-overlapping remainder (delta mode with overlap)
  const maxOverlap = Math.min(previous.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap--) {
    if (previous.slice(-overlap) === incoming.slice(0, overlap)) {
      return previous + incoming.slice(overlap);
    }
  }

  // No overlap found — pure delta, just append
  return previous + incoming;
}

// ----------------------------------------------------------
// Part index lookup for in-flight streaming parts
// ----------------------------------------------------------

/**
 * Find the index of an existing part that should be updated by an incoming
 * streaming event. For text/reasoning parts without a stable id, search
 * backward for the last part of the same type. For tool parts, match by name.
 *
 * Returns -1 if no match found (should push a new part instead).
 */
export function findStreamingPartIndex(parts: AIPart[], incoming: AIPart): number {
  const incomingType = incoming.type;

  if (incomingType === 'text' || incomingType === 'reasoning') {
    // Scan backward — find last part of same type without a stable id
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type !== incomingType) continue;
      if ((parts[i] as any).id) continue; // has stable id — different code path handles it
      return i;
    }
    return -1;
  }

  if (incomingType === 'tool' || incomingType === 'tool-call' || incomingType === 'tool-result') {
    const incomingName =
      (incoming as any).name ?? (incoming as any).toolName ?? '';
    for (let i = parts.length - 1; i >= 0; i--) {
      if (parts[i].type !== incomingType) continue;
      if ((parts[i] as any).id) continue;
      const candidateName =
        String((parts[i] as any).name ?? (parts[i] as any).toolName ?? '');
      if (candidateName === incomingName) return i;
    }
  }

  return -1;
}

// ----------------------------------------------------------
// Part merging
// ----------------------------------------------------------

/**
 * Merge an incoming streaming part update into an existing part.
 * For text/reasoning: merge text with overlap detection.
 * For everything else: spread (later fields win).
 */
export function mergePartUpdate(
  previous: AIPart,
  incoming: AIPart,
  options?: { replaceText?: boolean },
): AIPart {
  if (incoming.type === 'text' || incoming.type === 'reasoning') {
    return {
      ...previous,
      ...incoming,
      text: options?.replaceText
        ? (incoming as any).text ?? ''
        : mergeStreamingText((previous as any).text ?? '', (incoming as any).text ?? ''),
    };
  }
  return { ...previous, ...incoming };
}

// ----------------------------------------------------------
// Display item grouping
// ----------------------------------------------------------

export type MessageDisplayItem =
  | { kind: 'part'; key: string; part: AIPart }
  | { kind: 'command-group'; key: string; parts: AIPart[] };

/**
 * A part is "groupable" (eligible for CommandPartsDropdown) when it is NOT
 * a plain text part and NOT a file attachment.
 */
function isGroupable(part: AIPart): boolean {
  return part.type !== 'text' && part.type !== 'file';
}

/**
 * Group consecutive non-text parts into command groups.
 * Single isolated groupable parts remain as individual items.
 * Text and file parts are always individual.
 *
 * Example: [text, tool, tool, text, reasoning] →
 *   [part(text), command-group([tool, tool]), part(text), command-group([reasoning])]
 *
 * Wait — single groupable parts become individual items when they're alone.
 * Groups of 2+ consecutive groupable parts become command-group.
 */
export function buildMessageDisplayItems(parts: AIPart[]): MessageDisplayItem[] {
  const items: MessageDisplayItem[] = [];
  let i = 0;

  while (i < parts.length) {
    const part = parts[i];

    if (!isGroupable(part)) {
      items.push({ kind: 'part', key: `part-${i}`, part });
      i++;
      continue;
    }

    // Collect a run of consecutive groupable parts
    const run: AIPart[] = [part];
    let j = i + 1;
    while (j < parts.length && isGroupable(parts[j])) {
      run.push(parts[j]);
      j++;
    }

    if (run.length === 1) {
      // Single groupable part — render individually
      items.push({ kind: 'part', key: `part-${i}`, part: run[0] });
    } else {
      // Multiple consecutive groupable parts — group them
      items.push({
        kind: 'command-group',
        key: `group-${i}-${j - 1}`,
        parts: run,
      });
    }

    i = j;
  }

  return items;
}

// ----------------------------------------------------------
// Group label computation
// ----------------------------------------------------------

export function buildToolGroupLabel(parts: AIPart[]): string {
  let hasReasoning = false;
  let toolCount = 0;

  for (const part of parts) {
    if (part.type === 'reasoning') {
      hasReasoning = true;
    } else if (
      part.type === 'tool' ||
      part.type === 'tool-call' ||
      part.type === 'tool-result'
    ) {
      toolCount++;
    }
  }

  if (hasReasoning && toolCount > 0) {
    return `Thinking · ${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`;
  }
  if (hasReasoning) return 'Thinking';
  if (toolCount > 0) return `${toolCount} ${toolCount === 1 ? 'tool' : 'tools'}`;
  return `${parts.length} steps`;
}

// ----------------------------------------------------------
// Message update helpers
// ----------------------------------------------------------

/**
 * Apply an incoming server message event to the current messages array.
 * Handles both new messages and streaming updates to existing ones.
 */
export function applyMessageUpdate(
  existing: AIMessage[],
  incoming: AIMessage,
): AIMessage[] {
  const idx = existing.findIndex((m) => m.messageId === incoming.messageId);

  if (idx === -1) {
    // New message
    return [...existing, incoming];
  }

  // Update in place — merge parts
  const prev = existing[idx];
  const updatedParts = mergeParts(prev.parts, incoming.parts);
  const updated: AIMessage = {
    ...prev,
    ...incoming,
    parts: updatedParts,
  };
  const next = [...existing];
  next[idx] = updated;
  return next;
}

/**
 * Merge incoming parts onto existing parts, handling streaming updates.
 */
function mergeParts(existing: AIPart[], incoming: AIPart[]): AIPart[] {
  if (incoming.length === 0) return existing;

  let parts = [...existing];

  for (const incomingPart of incoming) {
    const stableId = (incomingPart as any).id;

    if (stableId) {
      // Stable ID match
      const idx = parts.findIndex((p) => (p as any).id === stableId);
      if (idx >= 0) {
        parts[idx] = mergePartUpdate(parts[idx], incomingPart);
      } else {
        parts.push(incomingPart);
      }
    } else {
      // No stable ID — find by type+name match
      const idx = findStreamingPartIndex(parts, incomingPart);
      if (idx >= 0) {
        parts[idx] = mergePartUpdate(parts[idx], incomingPart);
      } else {
        parts.push(incomingPart);
      }
    }
  }

  return parts;
}
