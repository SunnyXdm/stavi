// WHAT: Shared types for server-side VT parsing / cell-diff terminal mode.
// WHY:  Skia and native terminal backends consume pre-parsed cell grids
//       rather than re-parsing ANSI themselves. Server emits TerminalFrame.
// SEE:  packages/server-core/src/handlers/terminal.ts,
//       plans/13-roadmap.md Phase C1.

/**
 * Per-cell style attributes.
 *
 * `fg` / `bg` encoding (single number, sentinel-tagged):
 *   - undefined  → default fg/bg (client chooses from theme)
 *   - 0..255     → ANSI palette index (CSI 3(0-7), 9(0-7), 38;5;N, 48;5;N)
 *   - 0x01000000 | 0xRRGGBB → 24-bit truecolor (bit 24 flag distinguishes
 *     from palette range; actual RGB occupies low 24 bits)
 *
 * `flags` is a bitmask:
 *   bold=1, italic=2, underline=4, inverse=8
 * Additional flags (dim, blink, strikethrough, etc.) are intentionally
 * omitted in v1; extend the bitmask when needed.
 */
export type CellStyle = { fg?: number; bg?: number; flags?: number };

/** A single row's worth of cells. The whole row is sent when any cell changes. */
export type CellDiff = {
  /** 0-indexed row within the visible viewport (not scrollback). */
  row: number;
  cells: Array<{ ch: string } & CellStyle>;
};

/** A frame emitted by the server VT parser to `cells`-mode subscribers. */
export type TerminalFrame = {
  cols: number;
  rows: number;
  /** Changed rows since last frame. Empty when full=false means no-op (skip emit). */
  dirty: CellDiff[];
  cursor: { row: number; col: number; visible: boolean };
  /**
   * True when this frame is a full snapshot — sent on subscription start
   * and after a resize. Clients should reset their local grid on `full`.
   */
  full?: boolean;
};

/** Subscription mode requested by a client in `terminal.open` / subscribe calls. */
export type TerminalSubscribeMode = 'raw' | 'cells';

// Flag constants (mirror the bitmask documented above)
export const CELL_FLAG_BOLD = 1;
export const CELL_FLAG_ITALIC = 2;
export const CELL_FLAG_UNDERLINE = 4;
export const CELL_FLAG_INVERSE = 8;

/** Bit-24 marker indicating the fg/bg low 24 bits are 0xRRGGBB truecolor. */
export const CELL_COLOR_RGB_FLAG = 0x01000000;
