// ============================================================
// test/guard-path.test.ts — guardPath traversal + symlink hardening
// ============================================================
// WHAT: Unit tests for guardPath, the sole authz boundary for all fs.*
//       handlers, fs-batch/fs-zip, and the HTTP GET /file endpoint.
// WHY:  Regression coverage for path-traversal AND symlink-escape. The
//       old impl was pure string-prefix and would follow an in-workspace
//       symlink that points outside the tree. realpath resolution closes
//       that gap without breaking not-yet-created target paths.
// SEE:  packages/server-core/src/handlers/fs.ts (guardPath)

import { test, expect, beforeAll, afterAll } from 'bun:test';
import {
  mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, realpathSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { guardPath } from '../src/handlers/fs';

// realpathSync the temp base so expectations match guardPath's canonical
// output on macOS (/var -> /private/var, /tmp -> /private/tmp).
let base: string;       // realpath'd temp root
let workspace: string;  // <base>/ws  — the workspaceRoot
let session: string;    // <base>/sess — a session folder
let outside: string;    // <base>/outside — escape target

beforeAll(() => {
  base = realpathSync(mkdtempSync(join(tmpdir(), 'stavi-guard-')));
  workspace = join(base, 'ws');
  session = join(base, 'sess');
  outside = join(base, 'outside');
  mkdirSync(join(workspace, 'sub'), { recursive: true });
  mkdirSync(session, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workspace, 'sub', 'file.txt'), 'hi');
  writeFileSync(join(outside, 'secret.txt'), 'secret');
  writeFileSync(join(session, 'note.txt'), 'note');
  // In-workspace symlinks that escape the tree:
  symlinkSync(outside, join(workspace, 'evil'));                       // dir symlink
  symlinkSync(join(outside, 'secret.txt'), join(workspace, 'sub', 'link.txt')); // file symlink
  // In-workspace symlink that stays inside the tree (must be allowed):
  symlinkSync(join(workspace, 'sub'), join(workspace, 'innerlink'));   // dir symlink within ws
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

const guard = (p: string) => guardPath(workspace, p, [session]);

// --- traversal (must stay rejected — do not regress) ---
test('plain ../ traversal is rejected', () => {
  expect(guard(join(workspace, '..', 'outside', 'secret.txt'))).toBeNull();
});

test('nested ../../.. traversal is rejected', () => {
  expect(guard(join(workspace, 'sub', '..', '..', '..', 'outside', 'secret.txt'))).toBeNull();
});

test('relative ../ traversal is rejected', () => {
  expect(guard('../outside/secret.txt')).toBeNull();
});

// --- symlink escape (the gap this fix closes) ---
test('symlink-to-dir escape is rejected (intermediate component)', () => {
  // workspace/evil -> outside ; reading evil/secret.txt escapes
  expect(guard(join(workspace, 'evil', 'secret.txt'))).toBeNull();
});

test('symlink-to-dir escape is rejected (leaf is the symlink)', () => {
  expect(guard(join(workspace, 'evil'))).toBeNull();
});

test('symlink-to-file escape is rejected', () => {
  expect(guard(join(workspace, 'sub', 'link.txt'))).toBeNull();
});

test('symlink-escape rejected even for a not-yet-created child', () => {
  // evil/ is a symlink out; a brand-new file under it must NOT be writable
  expect(guard(join(workspace, 'evil', 'newfile.txt'))).toBeNull();
});

// --- in-workspace symlink is allowed ---
test('symlink that stays within the workspace is allowed', () => {
  const r = guard(join(workspace, 'innerlink', 'file.txt'));
  expect(r).toBe(join(workspace, 'sub', 'file.txt'));
});

// --- not-yet-existing targets (create/write/rename dest) ---
test('new file in a real subdir is allowed (realpath of ancestor)', () => {
  expect(guard(join(workspace, 'sub', 'new.txt'))).toBe(join(workspace, 'sub', 'new.txt'));
});

test('new deep directory chain is allowed', () => {
  expect(guard(join(workspace, 'brand', 'new', 'dir', 'f.txt')))
    .toBe(join(workspace, 'brand', 'new', 'dir', 'f.txt'));
});

// --- roots and session folders ---
test('workspace root itself is allowed', () => {
  expect(guard(workspace)).toBe(workspace);
});

test('session folder is allowed', () => {
  expect(guard(join(session, 'note.txt'))).toBe(join(session, 'note.txt'));
});

test('session folder root itself is allowed', () => {
  expect(guard(session)).toBe(session);
});

// --- string-prefix-but-not-subpath (must be rejected; old code already did) ---
test('sibling sharing a string prefix is rejected', () => {
  // root=<base>/ws ; target=<base>/wsX must NOT pass startsWith(root + '/')
  const sibling = workspace + 'X';
  mkdirSync(sibling, { recursive: true });
  try {
    expect(guardPath(workspace, join(sibling, 'f.txt'), [])).toBeNull();
    expect(guardPath(workspace, sibling, [])).toBeNull();
  } finally {
    rmSync(sibling, { recursive: true, force: true });
  }
});

// --- trailing-slash edge cases ---
test('trailing slash on an in-workspace path is allowed', () => {
  // normalize() strips the trailing slash; result is the canonical dir path
  expect(guard(join(workspace, 'sub') + '/')).toBe(join(workspace, 'sub'));
});

test('trailing slash does not let a prefix sibling through', () => {
  const sibling = workspace + 'X';
  expect(guardPath(workspace, sibling + '/', [])).toBeNull();
});
