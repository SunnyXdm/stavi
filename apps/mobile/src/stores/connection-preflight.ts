// WHAT: Pre-flight helper that opens a throwaway WebSocket to learn a server's
//       remote serverId before the server is added to the connection store.
// WHY:  Phase 5 requires dedup-by-serverId on addServer. We need the remote
//       serverId before creating the SavedConnection record.
// HOW:  Creates a StaviClient, connects, calls server.getConfig, disconnects.
//       Returns null on any error (non-blocking — dedup is best-effort).
// SEE:  apps/mobile/src/stores/connection.ts

import { createStaviClient } from './stavi-client';

/**
 * Connects to the server at (host, port, bearerToken) using a throwaway
 * StaviClient, reads server.getConfig, and returns the remote serverId.
 * Returns null if the server is unreachable or doesn't support getConfig.
 * The throwaway client is always disconnected before this function returns.
 */
export async function prefetchServerId(
  host: string,
  port: number,
  bearerToken: string,
  tls?: boolean,
): Promise<string | null> {
  const client = createStaviClient();
  try {
    await client.connect({ host, port, bearerToken, tls });
    const result = await client.request<{ serverId?: string }>(
      'server.getConfig',
      {},
      10000,
    );
    return result.serverId ?? null;
  } catch {
    return null;
  } finally {
    client.disconnect();
  }
}
