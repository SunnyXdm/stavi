#!/usr/bin/env node

// ============================================================
// Stavi CLI — Mobile IDE for AI Coding Agents
// ============================================================
// Runs Stavi's local server. Users get a native mobile client
// with terminal, file browser, git status, and local chat.
//
// Commands:
//   stavi serve [--port] [--host] [cwd]  Start server
//   stavi token                          Issue a bearer token
//   stavi --help                         Show usage

import { mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { homedir } from 'node:os';
import {
  DEFAULT_PORT,
  createServerConnectionConfig,
  issueOrReadBearerToken,
  startStaviServer,
} from '@stavi/server-core';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const STAVI_HOME = resolve(homedir(), '.stavi');
function printBanner(address: string, port: number, token: string, cwd: string) {
  const addr = `${address}:${port}`;

  console.log('');
  console.log('\x1b[32m  ◆ Stavi server running\x1b[0m');
  console.log('');
  console.log(`  Address:  \x1b[1m${addr}\x1b[0m`);
  console.log(`  Token:    \x1b[36m${token}\x1b[0m`);
  console.log(`  Project:  \x1b[1m${cwd}\x1b[0m`);
  console.log('');
  console.log('  \x1b[2mEnter these in the Stavi mobile app to connect.\x1b[0m');
  console.log('  \x1b[2mPress Ctrl+C to stop.\x1b[0m');
  console.log('');
}

// ----------------------------------------------------------
// Commands
// ----------------------------------------------------------

async function serveCommand(args: string[]) {
  // Parse flags
  let port = DEFAULT_PORT;
  let host = '0.0.0.0';
  let cwd = process.cwd();

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
    } else if (!arg.startsWith('-')) {
      cwd = resolve(arg);
    }
  }

  // Ensure base dir exists
  mkdirSync(join(STAVI_HOME, 'userdata'), { recursive: true });

  console.log('\x1b[2m  Starting Stavi server...\x1b[0m');

  // Wait for server to be ready
  try {
    const server = await startStaviServer({
      cwd,
      host,
      port,
      baseDir: STAVI_HOME,
    });
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
    process.on('SIGINT', () => {
      void cleanup();
    });
    process.on('SIGTERM', () => {
      void cleanup();
    });

    printBanner(config.host, config.port, config.token, cwd);

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
  [cwd]            Working directory (default: current directory)

\x1b[1mExamples:\x1b[0m
  npx stavi serve                     Start with defaults
  npx stavi serve --port 4000         Custom port
  npx stavi serve ~/projects/my-app   Specific project directory
  npx stavi token                     Print a fresh token
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
