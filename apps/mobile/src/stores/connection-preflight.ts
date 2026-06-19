// WHAT: Pre-flight helper that opens a throwaway WebSocket to learn a server's
//       remote serverId and hostname, AND to prove the server is actually
//       reachable + the token valid before it's saved.
// WHY:  addServer used to swallow all preflight errors, so a server that
//       didn't exist (or a bad token) was saved anyway and the failure was
//       invisible — the user just got a dead entry with no explanation.
//       Now reachability is reported so addServer can refuse + surface why.
// HOW:  Creates a StaviClient, connects (this is the reachability+auth proof),
//       calls server.getConfig (best-effort for serverId/hostname), disconnects.
// SEE:  apps/mobile/src/stores/connection.ts

import { createStaviClient } from './stavi-client';

export interface ServerPreflight {
  /** True iff the WebSocket actually opened (server reachable + token valid). */
  reachable: boolean;
  serverId: string | null;
  hostname: string | null;
  /** Raw connect error when unreachable — caller classifies for display. */
  error?: unknown;
}

/**
 * Connects to the server at (host, port, bearerToken) using a throwaway
 * StaviClient. `reachable` reflects whether the connection opened at all;
 * serverId/hostname are best-effort (a reachable old server may lack getConfig).
 * The throwaway client is always disconnected before this returns.
 */
export async function prefetchServerInfo(
  host: string,
  port: number,
  bearerToken: string,
  tls?: boolean,
): Promise<ServerPreflight> {
  const client = createStaviClient();
  try {
    // connect() = fetch ws-token (8s abort) + open WS. Success here is the
    // authoritative "server exists and accepted the token" signal.
    await client.connect({ host, port, bearerToken, tls });
  } catch (error) {
    client.disconnect();
    return { reachable: false, serverId: null, hostname: null, error };
  }
  // Reachable — getConfig is best-effort (older servers may not implement it).
  try {
    const result = await client.request<{ serverId?: string; hostname?: string }>(
      'server.getConfig',
      {},
      10000,
    );
    return {
      reachable: true,
      serverId: result.serverId ?? null,
      hostname: result.hostname ?? null,
    };
  } catch {
    return { reachable: true, serverId: null, hostname: null };
  } finally {
    client.disconnect();
  }
}

/** @deprecated Use prefetchServerInfo */
export async function prefetchServerId(
  host: string,
  port: number,
  bearerToken: string,
  tls?: boolean,
): Promise<string | null> {
  const info = await prefetchServerInfo(host, port, bearerToken, tls);
  return info.serverId;
}
