#!/usr/bin/env node

// ============================================================
// Stavi CLI — Mobile IDE for AI Coding Agents
// ============================================================
// WHAT: Node.js CLI that starts the Stavi local server.
//       Phase 6 adds --relay <url> for E2E tunnel mode.
// WHY:  LAN access is convenient at home; relay lets users connect
//       from anywhere without port-forwarding.
// HOW:  --relay: connect to relay as server role, run Noise NK
//       responder on first mobile peer connection, route decrypted
//       frames to the local Stavi server's WebSocket handler.
//       Server static keypair stored in ~/.stavi/userdata/server-keypair.json
//       for reproducible QR codes across restarts.
// SEE:  packages/crypto/src/node-primitives.ts (CryptoPrimitives),
//       packages/crypto/src/noise.ts (Noise NK state machine),
//       apps/relay/src/index.ts (relay server)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { randomUUID, randomBytes } from 'node:crypto';
import {
  DEFAULT_PORT,
  createServerConnectionConfig,
  detectLanCandidates,
  issueOrReadBearerToken,
  startStaviServer,
} from '@stavi/server-core';
import { nodePrimitives } from '@stavi/crypto/node-primitives';
import {
  buildFrame,
  parseFrameHeader,
  FrameType,
  respondHandshake,
  noiseDecrypt,
  noiseEncrypt,
  type NoiseSession,
  type NoiseKeypair,
} from '@stavi/crypto';
// Use createRequire to load 'ws' (CommonJS module) in ESM context.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import { createRequire } from 'node:module';
const _nodeRequire = createRequire(import.meta.url);
type WsConstructor = {
  new(url: string): {
    on(event: 'open', cb: () => void): void;
    on(event: 'close', cb: () => void): void;
    on(event: 'error', cb: (err: Error) => void): void;
    on(event: 'message', cb: (data: Buffer | ArrayBuffer | Buffer[]) => void): void;
    send(data: Buffer | Uint8Array): void;
    close(): void;
  };
};
// eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
const WS = _nodeRequire('ws') as { WebSocket: WsConstructor };
import qrcode from 'qrcode-terminal';
import type { PairingPayload } from '@stavi/shared';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const STAVI_HOME = resolve(homedir(), '.stavi');
const KEYPAIR_PATH = join(STAVI_HOME, 'userdata', 'server-keypair.json');

// ----------------------------------------------------------
// Server static keypair persistence
// ----------------------------------------------------------

function loadOrGenerateKeypair(): NoiseKeypair {
  if (existsSync(KEYPAIR_PATH)) {
    const raw = JSON.parse(readFileSync(KEYPAIR_PATH, 'utf-8')) as {
      publicKey: string;
      secretKey: string;
    };
    return {
      publicKey: Buffer.from(raw.publicKey, 'base64'),
      secretKey: Buffer.from(raw.secretKey, 'base64'),
    };
  }

  const kp = nodePrimitives.generateKeypair();
  writeFileSync(
    KEYPAIR_PATH,
    JSON.stringify({
      publicKey: Buffer.from(kp.publicKey).toString('base64'),
      secretKey: Buffer.from(kp.secretKey).toString('base64'),
    }),
    { mode: 0o600 },
  );
  return kp;
}

// ----------------------------------------------------------
// Banner
// ----------------------------------------------------------

function printBanner(address: string, port: number, token: string, cwd: string) {
  // All plausible LAN addresses (Wi-Fi/Ethernet first, VPN/virtual excluded).
  // The app probe-races them so a stale primary doesn't strand the pairing.
  const lan = detectLanCandidates();
  const merged = [...new Set([address, ...lan])].filter((h) => h !== '0.0.0.0');
  const routable = merged.filter((h) => h !== '127.0.0.1');
  const candidates = routable.length ? routable : merged;

  const payload: PairingPayload = {
    roomId: '',
    serverPublicKey: '',
    token,
    lanHost: candidates[0] ?? address,
    lanHosts: candidates,
    port,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

  console.log('');
  console.log('\x1b[32m  ◆ Stavi server running (local mode)\x1b[0m');
  console.log('');
  for (let i = 0; i < candidates.length; i++) {
    console.log(`  Address${candidates.length > 1 ? ` ${i + 1}` : ''}:  \x1b[1m${candidates[i]}:${port}\x1b[0m`);
  }
  console.log(`  Token:    \x1b[36m${token}\x1b[0m`);
  console.log(`  Project:  \x1b[1m${cwd}\x1b[0m`);
  console.log('');
  console.log('  Scan this QR code with the Stavi mobile app (same Wi-Fi):');
  console.log('');
  qrcode.generate(encoded, { small: true });
  console.log('');
  console.log('  Or paste this pairing code into the app (Add Server → paste):');
  console.log(`  \x1b[36m${encoded}\x1b[0m`);
  console.log('');
  console.log('  \x1b[2mPhone can\u2019t connect? Check: both devices on the same Wi-Fi,\x1b[0m');
  console.log('  \x1b[2mmacOS Firewall allows incoming connections (System Settings →\x1b[0m');
  console.log('  \x1b[2mNetwork → Firewall), and guest/AP-isolation Wi-Fi is off.\x1b[0m');
  console.log('  \x1b[2mPress Ctrl+C to stop.\x1b[0m');
  console.log('');
}

/**
 * Interactive connection-mode picker shown when `stavi serve` starts on a TTY
 * without an explicit --local/--relay flag.
 *   local   → LAN address (e.g. 192.168.1.8) + QR, no middleman
 *   proxied → relay tunnel (E2E encrypted) for connections from anywhere
 */
async function promptConnectionMode(defaultRelayUrl: string | null): Promise<{ mode: 'local' } | { mode: 'relay'; relayUrl: string }> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q: string) => new Promise<string>((res) => rl.question(q, res));
  try {
    console.log('');
    console.log('  How should the mobile app connect to this server?');
    console.log('');
    console.log('    \x1b[1m1)\x1b[0m Local    — same Wi-Fi, LAN address (fastest, no middleman)');
    console.log('    \x1b[1m2)\x1b[0m Proxied  — relay tunnel, works from anywhere (E2E encrypted, requires a relay server)');
    console.log('');
    const answer = (await ask('  Choose [1/2] (default 1): ')).trim();
    if (answer === '2') {
      const hint = defaultRelayUrl ? ` (default ${defaultRelayUrl})` : ' (e.g. wss://relay.example.com — self-host apps/relay)';
      const relayAnswer = (await ask(`  Relay URL${hint}: `)).trim();
      const chosen = relayAnswer || defaultRelayUrl;
      if (!chosen) {
        console.log('  \x1b[33mNo relay URL provided — falling back to local mode.\x1b[0m');
        return { mode: 'local' };
      }
      return { mode: 'relay', relayUrl: chosen.replace(/\/$/, '') };
    }
    return { mode: 'local' };
  } finally {
    rl.close();
  }
}

function printRelayBanner(
  relayUrl: string,
  roomId: string,
  bearerToken: string,
  publicKey: string,
  port: number,
  lanHost: string,
) {
  const payload: PairingPayload = {
    relay: relayUrl,
    roomId,
    serverPublicKey: publicKey,
    token: bearerToken,
    lanHost,
    port,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');

  console.log('');
  console.log('\x1b[32m  ◆ Stavi server running (relay mode)\x1b[0m');
  console.log('');
  console.log(`  Relay:    \x1b[1m${relayUrl}\x1b[0m`);
  console.log(`  Room:     \x1b[36m${roomId}\x1b[0m`);
  console.log(`  LAN:      \x1b[2m${lanHost}:${port}\x1b[0m`);
  console.log('');
  console.log('  Scan this QR code with the Stavi mobile app:');
  console.log('');
  qrcode.generate(encoded, { small: true });
  console.log('');
  console.log(`  Or paste this pairing string into the app:`);
  console.log(`  \x1b[36m${encoded}\x1b[0m`);
  console.log('');
  console.log('  \x1b[2mPress Ctrl+C to stop.\x1b[0m');
  console.log('');
}

// ----------------------------------------------------------
// Relay connection (server side)
// ----------------------------------------------------------

/**
 * Connects to the relay as "server", runs Noise NK responder on the first
 * mobile peer, and returns send/receive hooks to bridge with the local server.
 *
 * Returns a function to close the relay WS.
 */
async function connectToRelay(
  relayUrl: string,
  roomId: string,
  bearerToken: string,
  staticKeypair: NoiseKeypair,
  onDecrypted: (data: Buffer) => void,
  onPeerReset?: () => void,
): Promise<{ send: (data: Buffer) => void; close: () => void }> {
  const wsUrl = `${relayUrl}/room/${roomId}?role=server&token=${bearerToken}`;

  return new Promise((resolve, reject) => {
    const ws = new WS.WebSocket(wsUrl);
    let noiseSession: NoiseSession | null = null;
    let ready = false;

    ws.on('error', (err: Error) => {
      if (!ready) reject(err);
      else console.error('[relay] WebSocket error:', err.message);
    });

    ws.on('close', () => {
      if (!ready) reject(new Error('Relay WS closed before session established'));
      else console.log('[relay] Disconnected from relay');
    });

    ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[], isBinary?: boolean) => {
      // Relay signals come as JSON TEXT frames. ws v8 delivers text frames as
      // Buffer too — `instanceof Buffer` can NOT discriminate; the isBinary
      // flag is the only correct signal. (With the old check, peer_connected/
      // peer_disconnected were silently dropped → noiseSession was never
      // reset → a reconnecting phone's fresh handshake was ignored forever.)
      if (isBinary === false) {
        const rawBuf = raw instanceof Buffer ? raw : Buffer.from(raw as ArrayBuffer);
        let msg: { type: string };
        try {
          msg = JSON.parse(rawBuf.toString()) as { type: string };
        } catch {
          return;
        }

        if (msg.type === 'peer_connected') {
          console.log('[relay] Mobile peer connected — starting Noise handshake');
        } else if (msg.type === 'peer_disconnected') {
          console.log('[relay] Mobile peer disconnected');
          noiseSession = null;
          onPeerReset?.();
        }
        return;
      }

      // Binary frame — normalize every ws delivery shape to Uint8Array
      const buf = raw instanceof Buffer
        ? raw
        : Array.isArray(raw)
          ? Buffer.concat(raw)
          : Buffer.from(raw as ArrayBuffer);
      const bytes = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
      const frame = parseFrameHeader(bytes);
      if (!frame) return;

      if (frame.type === FrameType.HANDSHAKE) {
        // msg1 from mobile — respond. A fresh msg1 while a session exists
        // means the peer restarted (signals can be missed); replace it.
        if (noiseSession) {
          console.log('[relay] New handshake while session active — resetting peer');
          noiseSession = null;
          onPeerReset?.();
        }
        try {
          const { msg2, session } = respondHandshake(nodePrimitives, staticKeypair, frame.payload);
          noiseSession = session;

          const handshakeFrame = buildFrame(FrameType.HANDSHAKE, 0, msg2);
          ws.send(handshakeFrame);
          console.log('[relay] Noise NK handshake complete — session established');

          if (!ready) {
            ready = true;
            resolve({
              send: (data: Buffer) => {
                if (!noiseSession) return;
                const { ciphertext, nonce } = noiseEncrypt(
                  noiseSession,
                  nodePrimitives,
                  new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
                );
                ws.send(buildFrame(FrameType.DATA, nonce, ciphertext));
              },
              close: () => ws.close(),
            });
          }
        } catch (err) {
          console.error('[relay] Handshake failed:', err);
        }
        return;
      }

      if (frame.type === FrameType.DATA && noiseSession) {
        try {
          const plaintext = noiseDecrypt(
            noiseSession,
            nodePrimitives,
            frame.payload,
            frame.nonce,
          );
          onDecrypted(Buffer.from(plaintext));
        } catch (err) {
          console.error('[relay] Decrypt failed:', err);
        }
      }
    });

    ws.on('open', () => {
      console.log(`[relay] Connected to relay room ${roomId}`);
    });
  });
}

// ----------------------------------------------------------
// Relay → local-server bridge
// ----------------------------------------------------------

/**
 * Bridges decrypted relay traffic to the local Stavi server's own WS endpoint
 * and pipes responses back through the tunnel. This was the missing piece
 * that made relay mode connect-but-dead: handshakes succeeded, then every
 * RPC was silently dropped.
 *
 * Security: the first decrypted message MUST be a RelayAuth frame carrying
 * the bearer token — Noise NK only authenticates the server to the phone,
 * and the relay never validates tokens, so without this check anyone with
 * the roomId could attach.
 */
function createLocalBridge(
  port: number,
  bearerToken: string,
  sendToMobile: (data: Buffer) => void,
) {
  type LocalWs = { ws: InstanceType<typeof WS.WebSocket>; open: boolean };
  let local: LocalWs | null = null;
  let opening: Promise<void> | null = null;
  let authed = false;
  const pending: Buffer[] = [];

  async function openLocalWs(): Promise<void> {
    const res = await fetch(`http://127.0.0.1:${port}/api/auth/ws-token`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${bearerToken}` },
    });
    if (!res.ok) throw new Error(`local ws-token failed (${res.status})`);
    const { token } = (await res.json()) as { token: string };
    await new Promise<void>((resolveWs, rejectWs) => {
      const ws = new WS.WebSocket(`ws://127.0.0.1:${port}/ws?wsToken=${encodeURIComponent(token)}`);
      const entry: LocalWs = { ws, open: false };
      ws.on('open', () => {
        entry.open = true;
        local = entry;
        for (const msg of pending.splice(0)) ws.send(msg);
        resolveWs();
      });
      ws.on('message', (raw: Buffer | ArrayBuffer | Buffer[]) => {
        sendToMobile(Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer));
      });
      ws.on('close', () => { if (local === entry) local = null; });
      ws.on('error', (err: Error) => {
        if (local === entry) local = null;
        rejectWs(err);
      });
    });
  }

  return {
    /** Handle one decrypted frame from the mobile peer. */
    onMobileData: (data: Buffer) => {
      const text = data.toString('utf8');

      if (!authed) {
        // First frame must be RelayAuth with the bearer token.
        try {
          const msg = JSON.parse(text) as { _tag?: string; token?: string };
          if (msg._tag === 'RelayAuth' && msg.token === bearerToken) {
            authed = true;
            console.log('[relay] Mobile peer authenticated');
            return;
          }
        } catch { /* not JSON */ }
        console.error('[relay] Mobile peer failed token auth — dropping frames');
        return;
      }

      const buf = Buffer.from(text, 'utf8');
      if (local?.open) {
        local.ws.send(buf);
        return;
      }
      pending.push(buf);
      if (!opening) {
        opening = openLocalWs()
          .catch((err: Error) => {
            console.error('[relay] Local bridge connect failed:', err.message);
            pending.length = 0;
          })
          .finally(() => { opening = null; });
      }
    },
    /** New mobile peer (re-handshake) — require auth again, drop stale WS. */
    resetPeer: () => {
      authed = false;
      try { local?.ws.close(); } catch { /* noop */ }
      local = null;
      pending.length = 0;
    },
  };
}

// ----------------------------------------------------------
// Commands
// ----------------------------------------------------------

// No hardcoded default relay: relay.stavi.app does not exist. Relay mode
// requires a reachable relay (self-host apps/relay) via --relay or STAVI_RELAY.
const DEFAULT_RELAY_URL = process.env.STAVI_RELAY ?? null;

async function serveCommand(args: string[]) {
  let port = DEFAULT_PORT;
  let host = '0.0.0.0';
  let cwd = process.cwd();
  let relayUrl: string | null = null;
  let forceLocal = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--port' && args[i + 1]) {
      port = parseInt(args[++i], 10);
      if (isNaN(port) || port < 1 || port > 65535) {
        console.error('Error: --port must be between 1 and 65535');
        process.exit(1);
      }
    } else if (arg === '--host' && args[i + 1]) {
      host = args[++i];
    } else if (arg === '--relay' && args[i + 1]) {
      relayUrl = args[++i].replace(/\/$/, ''); // strip trailing slash
    } else if (arg === '--local') {
      forceLocal = true;
    } else if (!arg.startsWith('-')) {
      cwd = resolve(arg);
    }
  }

  // No explicit mode flag on an interactive terminal → ask. Non-TTY runs
  // (scripts, services) default to local without prompting.
  if (!relayUrl && !forceLocal && process.stdin.isTTY && process.stdout.isTTY) {
    const choice = await promptConnectionMode(DEFAULT_RELAY_URL);
    if (choice.mode === 'relay') relayUrl = choice.relayUrl;
  }

  mkdirSync(join(STAVI_HOME, 'userdata'), { recursive: true });

  console.log('\x1b[2m  Starting Stavi server...\x1b[0m');

  try {
    const server = await startStaviServer({ cwd, host, port, baseDir: STAVI_HOME });
    const config = createServerConnectionConfig({
      host: server.host,
      port: server.port,
      token: server.bearerToken,
    });

    let stopping = false;
    const cleanup = async () => {
      if (stopping) return;
      stopping = true;
      await server.stop();
      process.exit(0);
    };
    process.on('SIGINT', () => void cleanup());
    process.on('SIGTERM', () => void cleanup());

    if (relayUrl) {
      // Relay mode — generate room, load keypair, print QR
      const staticKeypair = loadOrGenerateKeypair();
      const roomId = randomUUID();
      const publicKeyB64 = Buffer.from(staticKeypair.publicKey).toString('base64');

      printRelayBanner(
        relayUrl,
        roomId,
        server.bearerToken,
        publicKeyB64,
        server.port,
        config.host,
      );

      // Connect to relay and bridge decrypted traffic to the local server.
      let bridgeRef: ReturnType<typeof createLocalBridge> | null = null;
      const relayConn = await connectToRelay(
        relayUrl,
        roomId,
        server.bearerToken,
        staticKeypair,
        (data) => bridgeRef?.onMobileData(data),
        () => bridgeRef?.resetPeer(),
      );
      bridgeRef = createLocalBridge(server.port, server.bearerToken, relayConn.send);
    } else {
      printBanner(config.host, config.port, config.token, cwd);
    }

    await new Promise(() => {});
  } catch (err) {
    console.error(`\x1b[31mError:\x1b[0m ${(err as Error).message}`);
    process.exit(1);
  }
}

async function tokenCommand() {
  mkdirSync(join(STAVI_HOME, 'userdata'), { recursive: true });
  try {
    const token = issueOrReadBearerToken(STAVI_HOME);
    console.log(token);
  } catch (err) {
    console.error(`\x1b[31mError:\x1b[0m ${(err as Error).message}`);
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
\x1b[1mStavi\x1b[0m — Mobile IDE for AI Coding Agents

\x1b[1mUsage:\x1b[0m
  stavi serve [options] [cwd]    Start the Stavi server
  stavi token                    Print the current connection token
  stavi --help                   Show this help

\x1b[1mServe Options:\x1b[0m
  --port <port>    Port to listen on (default: 3773)
  --host <host>    Host to bind to (default: 0.0.0.0)
  --local          Local (LAN) mode — skip the connection-mode prompt
  --relay <url>    Proxied mode via relay server (E2E Noise NK encrypted)
  [cwd]            Working directory (default: current directory)

  Without --local/--relay on an interactive terminal, serve asks which
  connection mode to use. Both modes print a QR code the app can scan.

\x1b[1mExamples:\x1b[0m
  npx stavi serve                                      Start (asks local/proxied)
  npx stavi serve --local --port 4000                  Local mode, custom port
  npx stavi serve ~/projects/my-app                    Specific project directory
  npx stavi serve --relay wss://relay.stavi.app        Proxied (relay) mode
  npx stavi token                                      Print a fresh token
`);
}

// ----------------------------------------------------------
// Main
// ----------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case 'serve':
    serveCommand(args.slice(1));
    break;

  case 'token':
    tokenCommand();
    break;

  case '--help':
  case '-h':
  case 'help':
  case undefined:
    printHelp();
    break;

  default:
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
}
