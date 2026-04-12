// ============================================================
// @stavi/protocol — RPC namespace definitions and message helpers
// ============================================================

import type { RpcMessage, RpcResponse, RpcNamespace, SubscriptionMessage } from '@stavi/shared';

// ----------------------------------------------------------
// Message constructors
// ----------------------------------------------------------

let _msgId = 0;

export function createRpcMessage(
  ns: RpcNamespace,
  action: string,
  payload: Record<string, unknown> = {},
): RpcMessage {
  return {
    v: 1,
    id: `msg_${Date.now()}_${++_msgId}`,
    ns,
    action,
    payload,
  };
}

export function createRpcResponse(
  request: RpcMessage,
  ok: boolean,
  payload: Record<string, unknown> = {},
  error?: { code: string; message: string },
): RpcResponse {
  return {
    v: 1,
    id: request.id,
    ns: request.ns,
    action: request.action,
    ok,
    payload,
    error,
  };
}

export function isRpcResponse(msg: RpcMessage): msg is RpcResponse {
  return 'ok' in msg;
}

export function isSubscriptionMessage(msg: unknown): msg is SubscriptionMessage {
  return (
    typeof msg === 'object' &&
    msg !== null &&
    'seq' in msg &&
    typeof (msg as SubscriptionMessage).seq === 'number'
  );
}

// ----------------------------------------------------------
// Namespace action definitions
// All possible actions per namespace, for documentation and validation
// ----------------------------------------------------------

export const NamespaceActions = {
  terminal: [
    'open',
    'close',
    'write',
    'resize',
    'list',
    'attach',
    'detach',
    'kill',
    'scrollback',
  ],
  fs: [
    'list',
    'read',
    'write',
    'delete',
    'rename',
    'move',
    'mkdir',
    'stat',
    'search',
  ],
  git: [
    'status',
    'diff',
    'log',
    'stage',
    'unstage',
    'commit',
    'push',
    'pull',
    'branches',
    'checkout',
    'createBranch',
  ],
  orchestration: [
    'getSnapshot',
    'dispatchCommand',
    'getTurnDiff',
    'getFullThreadDiff',
    'replayEvents',
  ],
  process: [
    'list',
    'kill',
    'ports',
    'killByPort',
  ],
  system: [
    'info',
    'monitor',
  ],
  server: [
    'getConfig',
    'getSettings',
    'updateSettings',
    'refreshProviders',
  ],
  auth: [
    'validate',
    'pair',
    'revoke',
    'listSessions',
  ],
} as const satisfies Record<RpcNamespace, readonly string[]>;

// ----------------------------------------------------------
// Subscription stream names
// ----------------------------------------------------------

export const Subscriptions = {
  TERMINAL_EVENTS: { ns: 'terminal' as const, action: 'events' },
  ORCHESTRATION_EVENTS: { ns: 'orchestration' as const, action: 'events' },
  GIT_STATUS: { ns: 'git' as const, action: 'statusStream' },
  SYSTEM_MONITOR: { ns: 'system' as const, action: 'monitorStream' },
  SERVER_LIFECYCLE: { ns: 'server' as const, action: 'lifecycle' },
} as const;
