#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawnSync, spawn } from 'node:child_process';

const repoRoot = path.resolve(import.meta.dirname, '..');
const mobileRoot = path.join(repoRoot, 'apps', 'mobile');
const cliRoot = path.join(repoRoot, 'apps', 'cli');
const devConfigPath = path.join(mobileRoot, 'src', 'generated', 'dev-config.ts');
const staviHome = path.join(homedir(), '.stavi');

const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const positional = args.filter((arg) => !arg.startsWith('--'));
const shouldStartMetro = !flags.has('--no-metro');
const projectRoot = positional[0] ? path.resolve(positional[0]) : repoRoot;

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
  for (let i = 0; i < 20; i += 1) {
    if (await canListen(start + i)) return start + i;
  }
  throw new Error(`No open port found starting at ${start}`);
}

function issueToken() {
  const result = spawnSync(
    'bun',
    ['run', path.join(cliRoot, 'src', 'index.ts'), 'token'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  if (result.status !== 0) {
    throw new Error(result.stderr || 'Failed to issue Stavi token');
  }

  return result.stdout.trim();
}

function readToken() {
  const credPath = path.join(staviHome, 'userdata', 'credentials.json');
  if (!existsSync(credPath)) {
    return issueToken();
  }

  try {
    const creds = JSON.parse(readFileSync(credPath, 'utf8'));
    if (typeof creds.bearerToken === 'string' && creds.bearerToken.length > 0) {
      return creds.bearerToken;
    }
  } catch {
    return issueToken();
  }

  return issueToken();
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
  console.log(`  Turbo:    \x1b[1mserver${shouldStartMetro ? ' + metro' : ''}\x1b[0m`);
  console.log('');
  console.log('  \x1b[2mServer hot reload runs through Bun watch.\x1b[0m');
  console.log('  \x1b[2mMetro runs through the mobile package dev task.\x1b[0m');
  console.log('');
}

async function main() {
  mkdirSync(path.join(staviHome, 'userdata'), { recursive: true });

  const address = getLocalIp();
  const port = Number(process.env.STAVI_PORT) || (await findPort());
  const token = readToken();

  writeDevConfig({ address, port, token });
  printBanner({ address, port, token });

  const turboArgs = ['turbo', 'dev', '--filter=stavi'];
  if (shouldStartMetro) {
    turboArgs.push('--filter=@stavi/mobile');
  }

  const child = spawn(process.platform === 'win32' ? 'yarn.cmd' : 'yarn', turboArgs, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: {
      ...process.env,
      STAVI_PORT: String(port),
      STAVI_HOST: '0.0.0.0',
      STAVI_PROJECT_ROOT: projectRoot,
    },
  });

  const shutdown = (code = 0) => {
    if (!child.killed) {
      child.kill('SIGTERM');
    }
    process.exit(code);
  };

  process.on('SIGINT', () => shutdown(0));
  process.on('SIGTERM', () => shutdown(0));

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
