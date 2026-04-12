#!/usr/bin/env node

// ============================================================
// Stavi — Dev Environment Orchestrator
// ============================================================
// Starts the Stavi server (server-core), writes dev-config.ts
// for the mobile app, and launches Metro.
//
// Usage:
//   yarn dev                   Start everything
//   yarn dev --no-metro        Server only (you start Metro yourself)
//   yarn dev [project-dir]     Use a specific project directory
//
// Environment variables:
//   STAVI_PORT          Override default port (3773)
//   STAVI_SHELL         Shell for terminal sessions (default: /bin/zsh or /bin/sh)

import { $ } from 'zx';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';

$.verbose = false;

// ----------------------------------------------------------
// Paths
// ----------------------------------------------------------

const repoRoot = path.resolve(import.meta.dirname, '..');
const mobileRoot = path.join(repoRoot, 'apps', 'mobile');
const cliRoot = path.join(repoRoot, 'apps', 'cli');
const devConfigPath = path.join(mobileRoot, 'src', 'generated', 'dev-config.ts');
const staviHome = path.join(homedir(), '.stavi');

// ----------------------------------------------------------
// CLI flags
// ----------------------------------------------------------

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const shouldStartMetro = !flags.has('--no-metro');
const projectRoot = positional[0] ? path.resolve(positional[0]) : repoRoot;

// ----------------------------------------------------------
// Helpers
// ----------------------------------------------------------

function getLocalIp() {
  const nets = networkInterfaces();
  for (const interfaces of Object.values(nets)) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

function canListen(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => server.close(() => resolve(true)));
    server.listen(port, '0.0.0.0');
  });
}

async function findPort(start = 3773) {
  for (let i = 0; i < 20; i++) {
    if (await canListen(start + i)) return start + i;
  }
  throw new Error(`No open port found starting at ${start}`);
}

function writeDevConfig({ address, port, token }) {
  mkdirSync(path.dirname(devConfigPath), { recursive: true });
  writeFileSync(
    devConfigPath,
    `export interface DevConnectionConfig {
  name: string;
  androidHost: string;
  iosHost: string;
  port: number;
  bearerToken: string;
}

export const devConnectionConfig: DevConnectionConfig | null = {
  name: "This Machine",
  androidHost: "10.0.2.2",
  iosHost: "${address}",
  port: ${port},
  bearerToken: "${token}",
};
`,
    'utf8',
  );
}

function printBanner({ address, port, token }) {
  console.log('');
  console.log('\x1b[32m  ◆ Stavi dev environment\x1b[0m');
  console.log('');
  console.log(`  Address:  \x1b[1m${address}:${port}\x1b[0m`);
  console.log(`  Token:    \x1b[36m${token}\x1b[0m`);
  console.log(`  Project:  \x1b[1m${projectRoot}\x1b[0m`);
  console.log('');
  console.log('  \x1b[2mMobile app:  Enter the address + token, or use "Connect to This Machine"\x1b[0m');
  console.log('  \x1b[2mAndroid:     npx react-native run-android  (from apps/mobile)\x1b[0m');
  console.log('  \x1b[2miOS:         npx react-native run-ios      (from apps/mobile)\x1b[0m');
  console.log('  \x1b[2mPress Ctrl+C to stop.\x1b[0m');
  console.log('');
}

// ----------------------------------------------------------
// Main
// ----------------------------------------------------------

async function main() {
  mkdirSync(path.join(staviHome, 'userdata'), { recursive: true });

  const port = Number(process.env.STAVI_PORT) || (await findPort());
  const address = getLocalIp();

  console.log('\x1b[2m  Starting Stavi server...\x1b[0m');

  // Start the server using the CLI entry point (which uses server-core)
  const server = $`bun run ${path.join(cliRoot, 'src', 'index.ts')} serve --port ${port} --host 0.0.0.0 ${projectRoot}`;

  // Wait for the server to be ready by polling the health endpoint
  let ready = false;
  const startedAt = Date.now();
  while (!ready && Date.now() - startedAt < 30_000) {
    try {
      const resp = await fetch(`http://127.0.0.1:${port}/health`);
      if (resp.ok) {
        ready = true;
        break;
      }
    } catch {
      // Server not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  if (!ready) {
    console.error('\x1b[31m  Server failed to start within 30 seconds.\x1b[0m');
    process.exit(1);
  }

  // Read the bearer token from the credentials file
  const credPath = path.join(staviHome, 'userdata', 'credentials.json');
  let token = '';
  if (existsSync(credPath)) {
    try {
      const creds = JSON.parse(await $`cat ${credPath}`.then((r) => r.stdout));
      token = creds.bearerToken;
    } catch {
      // Fall through
    }
  }

  if (!token) {
    // Issue a token via CLI
    const result = await $`bun run ${path.join(cliRoot, 'src', 'index.ts')} token`;
    token = result.stdout.trim();
  }

  // Write dev config for mobile app
  writeDevConfig({ address, port, token });

  // Print the banner
  printBanner({ address, port, token });

  // Start Metro if requested
  let metro;
  if (shouldStartMetro) {
    console.log('  \x1b[2mStarting Metro bundler...\x1b[0m');
    metro = $({ cwd: mobileRoot })`npx react-native start --host 0.0.0.0`;
    metro.catch((err) => {
      console.error('\x1b[31m  Metro failed to start:\x1b[0m', err.stderr || err.message || err);
      console.error('  \x1b[2mTry: cd apps/mobile && yarn install && npx react-native start\x1b[0m');
    });
  }

  // Cleanup on exit
  const cleanup = () => {
    server.kill();
    metro?.kill();
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);

  // Keep alive
  await new Promise(() => {});
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
