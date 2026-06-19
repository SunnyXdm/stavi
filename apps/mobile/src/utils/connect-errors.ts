// WHAT: classifyConnectError — turn raw transport errors into actionable copy.
// WHY:  Every connect failure surfaced (when it surfaced at all) as a raw
//       string like "Network request failed" — useless on a phone. One choke
//       point maps causes to fixes so Add Server, the QR flow, ServersSheet,
//       and home reconnects all explain the SAME failure the same way.
// SEE:  stores/stavi-client.ts (raw error sources), components/AddServerSheet,
//       navigation/PairServerScreen, navigation/SessionsHomeScreen

export interface ClassifiedConnectError {
  title: string;
  message: string;
}

export function classifyConnectError(
  err: unknown,
  target?: { host?: string; port?: number },
): ClassifiedConnectError {
  const raw = err instanceof Error ? err.message : String(err);
  const where = target?.host ? `${target.host}${target.port ? `:${target.port}` : ''}` : 'the server';

  if (/Auth failed \(40[13]\)/.test(raw) || /Invalid bearer token/i.test(raw)) {
    return {
      title: 'Token rejected',
      message:
        `${where} is reachable but rejected the token. Re-scan the QR from the ` +
        `server terminal, or copy the token printed by \`stavi serve\` again — ` +
        `it changes if the server's data directory was reset.`,
    };
  }

  if (/Timed out reaching|timed out waiting/i.test(raw)) {
    return {
      title: `Couldn't reach ${where}`,
      message:
        `No response. Check that:\n` +
        `• the phone and computer are on the SAME Wi-Fi network\n` +
        `• the server is running (\`stavi serve\` in your project)\n` +
        `• macOS Firewall allows incoming connections (System Settings → Network → Firewall)\n` +
        `• your Wi-Fi doesn't isolate devices (guest networks often do)`,
    };
  }

  if (/Network request failed/i.test(raw)) {
    return {
      title: `Couldn't reach ${where}`,
      message:
        `The connection was refused or blocked. Check that the server is ` +
        `running, the address is your computer's CURRENT Wi-Fi IP (it can ` +
        `change!), and both devices share the same network.`,
    };
  }

  if (/closed before open|WebSocket connection failed/i.test(raw)) {
    return {
      title: 'Server refused the session',
      message:
        `${where} responded but dropped the session channel. The server may ` +
        `have just restarted — try again; if it persists, restart \`stavi serve\`.`,
    };
  }

  if (/RelayTransport/.test(raw)) {
    return {
      title: 'Relay connection failed',
      message:
        `${raw.replace(/^RelayTransport:\s*/, '')}\n` +
        `Relay mode needs \`stavi serve\` running in relay mode AND a reachable ` +
        `relay server.`,
    };
  }

  return { title: 'Connection failed', message: raw };
}
