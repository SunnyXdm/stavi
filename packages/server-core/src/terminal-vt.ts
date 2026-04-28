// WHAT: Server-side VT parser + dirty-row diff emitter (Phase C1).
// WHY:  Skia and native terminal backends consume pre-parsed cell grids
//       rather than re-parsing ANSI themselves. This module owns the
//       per-session headless xterm, the debounced diff loop, and the
//       color/flags normalization that produces TerminalFrame payloads.
// SEE:  packages/shared/src/terminal.ts,
//       packages/server-core/src/handlers/terminal.ts,
//       plans/13-roadmap.md Phase C1.

import { Terminal } from '@xterm/headless';
import type {
  CellDiff,
  TerminalFrame,
} from '@stavi/shared';
import {
  CELL_FLAG_BOLD,
  CELL_FLAG_ITALIC,
  CELL_FLAG_UNDERLINE,
  CELL_FLAG_INVERSE,
  CELL_COLOR_RGB_FLAG,
} from '@stavi/shared';

/** Per-row signature string used for cheap diffing. */
type RowSignature = string;

export interface VtSessionState {
  term: Terminal;
  /** Last fully-snapshotted buffer, indexed by row. Used for diffing. */
  lastSnapshot: RowSignature[];
  /** Debounce timer for the diff loop (null when idle). */
  flushTimer: ReturnType<typeof setTimeout> | null;
  /** Emit a TerminalFrame to all `cells`-mode subscribers. */
  emit: (frame: TerminalFrame) => void;
}

/**
 * Encode fg/bg color per the shared wire format:
 *   undefined → default | 0..255 → palette index | 0x01000000|rgb → truecolor
 */
function encodeColor(
  isDefault: boolean,
  isRgb: boolean,
  value: number,
): number | undefined {
  if (isDefault) return undefined;
  if (isRgb) return CELL_COLOR_RGB_FLAG | (value & 0xffffff);
  // palette (0..255)
  return value & 0xff;
}

function encodeFlags(cell: {
  isBold(): number;
  isItalic(): number;
  isUnderline(): number;
  isInverse(): number;
}): number {
  let f = 0;
  if (cell.isBold()) f |= CELL_FLAG_BOLD;
  if (cell.isItalic()) f |= CELL_FLAG_ITALIC;
  if (cell.isUnderline()) f |= CELL_FLAG_UNDERLINE;
  if (cell.isInverse()) f |= CELL_FLAG_INVERSE;
  return f;
}

/**
 * Serialize one row into a compact signature string used both as the
 * cached snapshot entry (for diffing) and as the source of truth for
 * cell content/attrs. Encoded fields are separated by \u0001; cells
 * by \u0002.
 */
function serializeRow(term: Terminal, rowIdx: number): {
  sig: string;
  cells: CellDiff['cells'];
} {
  const buf = term.buffer.active;
  const cols = term.cols;
  const line = buf.getLine(buf.viewportY + rowIdx);
  const cells: CellDiff['cells'] = [];
  if (!line) {
    const empty = ' ';
    const sigParts: string[] = [];
    for (let c = 0; c < cols; c++) {
      cells.push({ ch: empty });
      sigParts.push(`${empty}\u0001\u0001\u00010`);
    }
    return { sig: sigParts.join('\u0002'), cells };
  }
  const sigParts: string[] = [];
  const cell = buf.getNullCell();
  for (let c = 0; c < cols; c++) {
    line.getCell(c, cell);
    const chRaw = cell.getChars();
    const ch = chRaw.length === 0 ? ' ' : chRaw;
    const fg = encodeColor(cell.isFgDefault(), cell.isFgRGB(), cell.getFgColor());
    const bg = encodeColor(cell.isBgDefault(), cell.isBgRGB(), cell.getBgColor());
    const flags = encodeFlags(cell);
    const out: CellDiff['cells'][number] = { ch };
    if (fg !== undefined) out.fg = fg;
    if (bg !== undefined) out.bg = bg;
    if (flags !== 0) out.flags = flags;
    cells.push(out);
    sigParts.push(
      `${ch}\u0001${fg ?? ''}\u0001${bg ?? ''}\u0001${flags}`,
    );
  }
  return { sig: sigParts.join('\u0002'), cells };
}

/**
 * Build a full snapshot of every row. Used for the initial `full: true`
 * frame on subscription start and after resize.
 */
function buildFullFrame(term: Terminal): {
  dirty: CellDiff[];
  snapshot: RowSignature[];
} {
  const dirty: CellDiff[] = [];
  const snapshot: RowSignature[] = [];
  for (let r = 0; r < term.rows; r++) {
    const { sig, cells } = serializeRow(term, r);
    snapshot.push(sig);
    dirty.push({ row: r, cells });
  }
  return { dirty, snapshot };
}

export function createVtSession(
  cols: number,
  rows: number,
  emit: (frame: TerminalFrame) => void,
): VtSessionState {
  const term = new Terminal({
    cols,
    rows,
    allowProposedApi: true,
    // Scrollback is intentionally kept; however we only DIFF the visible
    // viewport. Clients maintain their own scrollback ring from received
    // frames (see plans/13-roadmap.md Phase C1 risks).
    scrollback: 1000,
  });
  return {
    term,
    lastSnapshot: [],
    flushTimer: null,
    emit,
  };
}

/** Feed raw pty bytes into the VT parser. */
export function feedVt(state: VtSessionState, data: string | Uint8Array): void {
  // @xterm/headless accepts string | Uint8Array
  state.term.write(data as any);
  scheduleFlush(state);
}

/**
 * Emit a full-snapshot frame. Called on subscription start and after
 * resize. Also resets the diff baseline.
 */
export function emitFullFrame(state: VtSessionState): TerminalFrame {
  const { dirty, snapshot } = buildFullFrame(state.term);
  state.lastSnapshot = snapshot;
  const frame: TerminalFrame = {
    cols: state.term.cols,
    rows: state.term.rows,
    dirty,
    cursor: {
      row: state.term.buffer.active.cursorY,
      col: state.term.buffer.active.cursorX,
      visible: true,
    },
    full: true,
  };
  return frame;
}

/**
 * Resize both dimensions; caller is responsible for emitting a full frame
 * afterwards to all `cells` subscribers.
 */
export function resizeVt(
  state: VtSessionState,
  cols: number,
  rows: number,
): void {
  state.term.resize(cols, rows);
  // Force full-snapshot baseline on next flush.
  state.lastSnapshot = [];
}

/** Debounced (~16ms) dirty-row diff pass. */
function scheduleFlush(state: VtSessionState): void {
  if (state.flushTimer) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    flushDiff(state);
  }, 16);
}

function flushDiff(state: VtSessionState): void {
  const { term } = state;
  // Naive O(rows × cols) diff. At 80×24 that's 1920 compares per 16ms
  // tick — trivial. For 200×50 widescreens consider row-hashing later.
  // Scrollback changes are NOT emitted; clients maintain their own ring.
  const dirty: CellDiff[] = [];
  const nextSnapshot: RowSignature[] = [];
  const baseline = state.lastSnapshot;
  const hadBaseline = baseline.length === term.rows;

  for (let r = 0; r < term.rows; r++) {
    const { sig, cells } = serializeRow(term, r);
    nextSnapshot.push(sig);
    if (!hadBaseline || baseline[r] !== sig) {
      dirty.push({ row: r, cells });
    }
  }

  state.lastSnapshot = nextSnapshot;

  if (dirty.length === 0 && hadBaseline) {
    // Still emit cursor updates — cursor can move without the buffer
    // text changing. But to keep traffic tight, only emit when cursor
    // actually moved or we'd have sent dirty rows.
    // For v1, skip no-op frames entirely. (Cursor-only movement is
    // infrequent compared to text changes and clients can tolerate a
    // small delay.)
    return;
  }

  const frame: TerminalFrame = {
    cols: term.cols,
    rows: term.rows,
    dirty,
    cursor: {
      row: term.buffer.active.cursorY,
      col: term.buffer.active.cursorX,
      visible: true,
    },
    // If there was no baseline (first-ever flush, or post-resize with
    // no subscriber yet) we mark the frame as full so clients can reset.
    full: !hadBaseline,
  };
  state.emit(frame);
}
