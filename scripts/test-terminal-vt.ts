// Scratch smoke test for Phase C1 VT parser.
// Run with: bun scripts/test-terminal-vt.ts
// Verifies that feeding 'ls\n' + a simulated listing produces non-empty
// CellDiff[] with expected characters at expected rows/cols.

import {
  createVtSession,
  feedVt,
  emitFullFrame,
} from '../packages/server-core/src/terminal-vt';
import type { TerminalFrame } from '../packages/shared/src/terminal';

async function main() {
  const frames: TerminalFrame[] = [];
  const vt = createVtSession(80, 24, (f) => frames.push(f));

  // Simulated shell prompt + command + output.
  vt.term.write('$ ls\r\nREADME.md  package.json  src\r\n$ ');

  // Wait past the 16ms debounce.
  await new Promise((r) => setTimeout(r, 40));

  const full = emitFullFrame(vt);
  console.log('cols/rows:', full.cols, full.rows);
  console.log('dirty row count (full snapshot):', full.dirty.length);
  console.log('row 0 first 10 cells:', full.dirty[0].cells.slice(0, 10));
  console.log('row 1 first 25 cells ch only:',
    full.dirty[1].cells.slice(0, 25).map(c => c.ch).join(''));
  console.log('cursor:', full.cursor);
  console.log('frames emitted via debounce:', frames.length);
  if (frames.length > 0) {
    console.log('first emit dirty count:', frames[0].dirty.length);
  }

  // Basic assertions (manual — repo has no vitest harness configured).
  const row1Str = full.dirty[1].cells.map((c) => c.ch).join('').trimEnd();
  if (!row1Str.startsWith('README.md')) {
    console.error('FAIL: expected row 1 to start with README.md, got:', row1Str);
    process.exit(1);
  }
  console.log('OK: row 1 starts with README.md');
}

main().catch((e) => { console.error(e); process.exit(1); });
