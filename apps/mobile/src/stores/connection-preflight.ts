// WHAT: Pre-flight helper that opens a throwaway WebSocket to learn a server's
//       remote serverId and hostname before the server is added to the connection store.
// WHY:  Phase 5 requires dedup-by-serverId on addServer. We need the remote
//       serverId before creating the SavedConnection record.
// HOW:  Creates a StaviClient, connects, calls server.getConfig, disconnects.
//       Returns null on any error (non-blocking — dedup is best-effort).
// SEE:  apps/mobile/src/stores/connection.ts

import { createStaviClient } from './stavi-client';

export interface ServerPreflight {
  serverId: string | null;
  hostname: string | null;
}

/**
 * Connects to the server at (host, port, bearerToken) using a throwaway
 * StaviClient, reads server.getConfig, and returns the remote serverId + hostname.
 * Returns null fields if the server is unreachable or doesn't support getConfig.
 * The throwaway client is always disconnected before this function returns.
 */
export async function prefetchServerInfo(
  host: string,
  port: number,
  bearerToken: string,
  tls?: boolean,
): Promise<ServerPreflight> {
  const client = createStaviClient();
  try {
    await client.connect({ host, port, bearerToken, tls });
    const result = await client.request<{ serverId?: string; hostname?: string }>(
      'server.getConfig',
      {},
      10000,
    );
    return {
      serverId: result.serverId ?? null,
      hostname: result.hostname ?? null,
    };
  } catch {
    return { serverId: null, hostname: null };
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
