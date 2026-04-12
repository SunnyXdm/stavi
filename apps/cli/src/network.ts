import { networkInterfaces } from 'node:os';

/**
 * Get the machine's LAN IPv4 address.
 * Returns the first non-internal IPv4 address found.
 * Falls back to '127.0.0.1' if none found.
 */
export function getLocalIP(): string {
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      // Skip internal/loopback and IPv6
      if (net.internal || net.family !== 'IPv4') continue;
      return net.address;
    }
  }

  return '127.0.0.1';
}
