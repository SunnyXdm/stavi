// ============================================================
// SkiaTerminalView — Phase C2.3 (scroll + scrollback + paste)
// ============================================================
// Builds on C2.1 (rendering) and C2.2 (input + cursor blink). New in C2.3:
//   • Client-side scrollback ring buffer (~2000 rows beyond viewport)
//   • Pan-to-scroll via GestureDetector + react-native-reanimated
//   • Long-press → clipboard paste (bracketed, ESC[200~ ... ESC[201~)
//   • Hide cursor while scrolled back, auto-return on new frame
//
// Scroll detection heuristic (recommended "easier v1"):
//   On every dirty-row frame we compare the OLD grid's top row to the NEW
//   grid's top row. If they differ AND the OLD top row is "leaving" the
//   viewport (i.e. content scrolled up by one), we push the OLD top row
//   into the ring. This is cheap (one row compare per frame), catches
//   newline-driven scrolls (the common case), and leaves full repaints
//   alone. We intentionally do NOT attempt to detect multi-row scrolls or
//   fancy server-side events — that would require a server contract change.
//
// Deferred to C2.4: text selection + copy.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  PixelRatio,
  TextInput,
  Pressable,
  Platform,
  Clipboard,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from 'react-native';
import {
  Canvas,
  Rect,
  Text as SkText,
  Group,
  Line,
  vec,
  useCanvasRef,
  Skia,
  matchFont,
} from '@shopify/react-native-skia';
import type { SkFont } from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { TerminalFrame, CellDiff } from '@stavi/shared';
import {
  CELL_FLAG_INVERSE,
  CELL_FLAG_BOLD,
  CELL_FLAG_ITALIC,
  CELL_FLAG_UNDERLINE,
  CELL_COLOR_RGB_FLAG,
} from '@stavi/shared';
import { useTheme, typography } from '../../../../theme';
import { useConnectionStore } from '../../../../stores/connection';
import { useSessionsStore } from '../../../../stores/sessions-store';
import { usePluginSetting } from '../../../../stores/plugin-settings-store';

// ----------------------------------------------------------
// Types
// ----------------------------------------------------------

type Cell = { ch: string; fg?: number; bg?: number; flags?: number };
type Grid = Cell[][]; // [row][col]

interface SkiaTerminalViewProps {
  sessionId: string;
  threadId: string;
  terminalId?: string;
  cols?: number;
  rows?: number;
}

type TerminalPalette = {
  black: string; red: string; green: string; yellow: string;
  blue: string; magenta: string; cyan: string; white: string;
  brightBlack: string; brightRed: string; brightGreen: string;
  brightYellow: string; brightBlue: string; brightMagenta: string;
  brightCyan: string; brightWhite: string;
};

// ----------------------------------------------------------
// Scrollback ring buffer
// ----------------------------------------------------------
//
// Fixed-capacity ring. Index 0 = most recently evicted row (i.e. the row
// the user would see first when scrolling up by one). Older rows have
// higher indices. `size` caps at RING_CAPACITY; new pushes evict the
// oldest row.
// ----------------------------------------------------------

const RING_CAPACITY = 2000;

class ScrollbackRing {
  private buf: (Cell[] | null)[] = new Array(RING_CAPACITY).fill(null);
  private head = 0; // points at slot for next push
  private _size = 0;

  get size(): number {
    return this._size;
  }

  push(row: Cell[]): void {
    this.buf[this.head] = row;
    this.head = (this.head + 1) % RING_CAPACITY;
    if (this._size < RING_CAPACITY) this._size++;
  }

  /** Get the Nth-most-recent row. N=0 → most recent. Returns null if out of range. */
  get(n: number): Cell[] | null {
    if (n < 0 || n >= this._size) return null;
    const idx = (this.head - 1 - n + RING_CAPACITY) % RING_CAPACITY;
    return this.buf[idx];
  }

  clear(): void {
    this.buf.fill(null);
    this.head = 0;
    this._size = 0;
  }
}

function cloneRow(row: Cell[]): Cell[] {
  const out: Cell[] = new Array(row.length);
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    out[i] = { ch: c.ch, fg: c.fg, bg: c.bg, flags: c.flags };
  }
  return out;
}

function rowsEqual(a: Cell[] | undefined, b: Cell[] | undefined): boolean {
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.ch !== y.ch || x.fg !== y.fg || x.bg !== y.bg || x.flags !== y.flags) return false;
  }
  return true;
}

// ----------------------------------------------------------
// Palette / grid helpers
// ----------------------------------------------------------

function resolveColor(
  value: number | undefined,
  palette: TerminalPalette,
  fallback: string,
): string {
  if (value === undefined) return fallback;
  if ((value & CELL_COLOR_RGB_FLAG) !== 0) {
    const rgb = value & 0xffffff;
    return '#' + rgb.toString(16).padStart(6, '0');
  }
  switch (value) {
    case 0: return palette.black;
    case 1: return palette.red;
    case 2: return palette.green;
    case 3: return palette.yellow;
    case 4: return palette.blue;
    case 5: return palette.magenta;
    case 6: return palette.cyan;
    case 7: return palette.white;
    case 8: return palette.brightBlack;
    case 9: return palette.brightRed;
    case 10: return palette.brightGreen;
    case 11: return palette.brightYellow;
    case 12: return palette.brightBlue;
    case 13: return palette.brightMagenta;
    case 14: return palette.brightCyan;
    case 15: return palette.brightWhite;
    default:
      return fallback;
  }
}

function emptyGrid(rows: number, cols: number): Grid {
  const g: Grid = new Array(rows);
  for (let r = 0; r < rows; r++) {
    const row: Cell[] = new Array(cols);
    for (let c = 0; c < cols; c++) row[c] = { ch: ' ' };
    g[r] = row;
  }
  return g;
}

function applyDiffs(grid: Grid, diffs: CellDiff[], cols: number): void {
  for (const d of diffs) {
    if (d.row < 0 || d.row >= grid.length) continue;
    const row = grid[d.row];
    for (let c = 0; c < d.cells.length && c < cols; c++) {
      row[c] = d.cells[c];
    }
    for (let c = d.cells.length; c < cols; c++) row[c] = { ch: ' ' };
  }
}

// ----------------------------------------------------------
// Special-key mapping (RN onKeyPress → bytes to send)
// ----------------------------------------------------------

function keyToBytes(key: string): string | null {
  switch (key) {
    case 'Enter':     return '\r';
    case 'Backspace': return '\x7f';
    case 'Tab':       return '\t';
    case 'Escape':    return '\x1b';
    case 'ArrowUp':    return '\x1b[A';
    case 'ArrowDown':  return '\x1b[B';
    case 'ArrowRight': return '\x1b[C';
    case 'ArrowLeft':  return '\x1b[D';
    default:          return null;
  }
}

// ----------------------------------------------------------
// Font bundle: regular + bold + italic variants
// ----------------------------------------------------------

interface FontBundle {
  regular: SkFont | null;
  bold: SkFont | null;
  italic: SkFont | null;
  boldItalic: SkFont | null;
}

function buildFont(
  weight: 'normal' | 'bold',
  style: 'normal' | 'italic',
  size: number,
): SkFont | null {
  try {
    return matchFont({
      fontFamily: typography.fontFamily.mono,
      fontSize: size,
      fontStyle: style,
      fontWeight: weight,
    });
  } catch {
    try {
      return Skia.Font(undefined, size);
    } catch {
      return null;
    }
  }
}

function pickFont(bundle: FontBundle, bold: boolean, italic: boolean): SkFont | null {
  if (bold && italic) return bundle.boldItalic ?? bundle.bold ?? bundle.regular;
  if (bold) return bundle.bold ?? bundle.regular;
  if (italic) return bundle.italic ?? bundle.regular;
  return bundle.regular;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function SkiaTerminalView({
  sessionId,
  threadId,
  terminalId = 'default',
  cols: initialCols = 80,
  rows: initialRows = 24,
}: SkiaTerminalViewProps) {
  const { colors } = useTheme();
  const canvasRef = useCanvasRef();
  const textInputRef = useRef<TextInput>(null);

  // --- Font size from plugin settings (see terminal plugin schema) ---
  const fontSizeSetting = usePluginSetting<number>('terminal', 'fontSize');
  const fontSize = typeof fontSizeSetting === 'number' && fontSizeSetting > 0
    ? fontSizeSetting
    : 13;

  // --- Font bundle (regular/bold/italic/boldItalic) ---
  const fontBundle: FontBundle = useMemo(() => ({
    regular:    buildFont('normal', 'normal', fontSize),
    bold:       buildFont('bold',   'normal', fontSize),
    italic:     buildFont('normal', 'italic', fontSize),
    boldItalic: buildFont('bold',   'italic', fontSize),
  }), [fontSize]);

  const font = fontBundle.regular;

  // --- Cell metrics (recomputed when font/size changes) ---
  const cellMetrics = useMemo(() => {
    if (!font) return { width: fontSize * 0.6, height: fontSize * 1.2, ascent: fontSize };
    const adv = font.getGlyphWidths(font.getGlyphIDs('M'))[0] ?? fontSize * 0.6;
    const m = font.getMetrics();
    const lineHeight = Math.ceil(-m.ascent + m.descent + (m.leading ?? 0));
    return {
      width: Math.ceil(adv),
      height: Math.max(lineHeight, Math.ceil(fontSize * 1.2)),
      ascent: Math.ceil(-m.ascent),
    };
  }, [font, fontSize]);

  // --- Grid + cursor refs (avoid re-renders per frame) ---
  const gridRef = useRef<Grid>(emptyGrid(initialRows, initialCols));
  const cursorRef = useRef<{ row: number; col: number; visible: boolean }>({
    row: 0, col: 0, visible: true,
  });
  const dimsRef = useRef<{ cols: number; rows: number }>({
    cols: initialCols,
    rows: initialRows,
  });
  const [dims, setDims] = useState(dimsRef.current);

  // --- Scrollback ring ---
  const ringRef = useRef<ScrollbackRing>(new ScrollbackRing());
  // scrollOffset: 0 = live viewport. N = N rows scrolled back into history.
  // React state (not SharedValue) — pan gesture is relatively low-frequency
  // for terminal scroll; we commit updates from the gesture worklet via
  // runOnJS. This keeps the render path plain React (no worklet-side Skia).
  const [scrollOffset, setScrollOffset] = useState(0);
  const scrollOffsetRef = useRef(0);
  scrollOffsetRef.current = scrollOffset;
  const isPanningRef = useRef(false);

  // --- Cursor blink state ---
  const [cursorOn, setCursorOn] = useState(true);
  const lastInputAtRef = useRef<number>(0);

  useEffect(() => {
    const BLINK_MS = 530;
    const TYPING_GRACE_MS = 500;
    const id = setInterval(() => {
      const sinceInput = Date.now() - lastInputAtRef.current;
      if (sinceInput < TYPING_GRACE_MS) {
        setCursorOn(true);
        return;
      }
      setCursorOn((v) => !v);
    }, BLINK_MS);
    return () => clearInterval(id);
  }, []);

  // --- Resolve client helper ---
  const getClient = useCallback(() => {
    const session = useSessionsStore.getState().getSession(sessionId);
    const serverId = session?.serverId;
    if (!serverId) return null;
    return useConnectionStore.getState().getClientForServer(serverId);
  }, [sessionId]);

  // --- Subscribe to cells-mode frames ---
  useEffect(() => {
    const client = getClient();
    if (!client) return;

    let closed = false;

    client
      .request('terminal.open', {
        threadId,
        terminalId,
        cwd: '.',
        cols: dimsRef.current.cols,
        rows: dimsRef.current.rows,
        mode: 'cells',
      })
      .catch((err) => {
        console.warn('[SkiaTerminalView] terminal.open failed:', err);
      });

    const unsub = client.subscribe(
      'subscribeTerminalEvents',
      { threadId, terminalId, mode: 'cells' },
      (event: any) => {
        if (closed) return;
        if (event?.type !== 'frame') return;
        if (event.threadId !== threadId) return;
        const frame = event.frame as TerminalFrame | undefined;
        if (!frame) return;

        const dimChanged =
          frame.cols !== dimsRef.current.cols ||
          frame.rows !== dimsRef.current.rows;

        if (frame.full || dimChanged) {
          // Full repaint: reset both grid AND ring (server has changed state
          // wholesale — any scrollback we had no longer lines up).
          gridRef.current = emptyGrid(frame.rows, frame.cols);
          ringRef.current.clear();
          dimsRef.current = { cols: frame.cols, rows: frame.rows };
          if (dimChanged) setDims(dimsRef.current);
        } else {
          // Scroll-detect: snapshot the current top row BEFORE applying
          // diffs. After applying, if row 0 changed AND looks like the
          // old row 1 shifted up (i.e. newline scroll), push the old top
          // row into the ring.
          const oldTop = gridRef.current[0] ? cloneRow(gridRef.current[0]) : undefined;
          const oldRow1 = gridRef.current[1] ? cloneRow(gridRef.current[1]) : undefined;
          applyDiffs(gridRef.current, frame.dirty, frame.cols);
          const newTop = gridRef.current[0];
          if (oldTop && oldRow1 && newTop && !rowsEqual(oldTop, newTop) && rowsEqual(oldRow1, newTop)) {
            ringRef.current.push(oldTop);
          }
        }

        if (frame.full || dimChanged) {
          // Apply diffs for a full frame (server still sends them against
          // the fresh grid).
          applyDiffs(gridRef.current, frame.dirty, frame.cols);
        }

        cursorRef.current = frame.cursor;

        // Auto-return to live on new frame if user isn't panning.
        if (scrollOffsetRef.current !== 0 && !isPanningRef.current) {
          setScrollOffset(0);
        }

        canvasRef.current?.redraw();
      },
      (err) => {
        console.warn('[SkiaTerminalView] subscription error:', err);
      },
    );

    return () => {
      closed = true;
      unsub();
    };
  }, [threadId, terminalId, canvasRef, getClient]);

  // --- User input → terminal.write ---
  const sendBytes = useCallback(
    (data: string) => {
      if (!data) return;
      lastInputAtRef.current = Date.now();
      setCursorOn(true);
      const client = getClient();
      if (!client || client.getState() !== 'connected') return;
      client.request('terminal.write', { threadId, data }).catch((err) => {
        console.warn('[SkiaTerminalView] terminal.write failed:', err);
      });
    },
    [threadId, getClient],
  );

  const [inputValue, setInputValue] = useState('');
  const handleChangeText = useCallback(
    (next: string) => {
      if (next.length > 0) {
        sendBytes(next);
      }
      if (next !== '') setInputValue('');
    },
    [sendBytes],
  );

  const handleKeyPress = useCallback(
    (e: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = e.nativeEvent.key;
      const bytes = keyToBytes(key);
      if (bytes !== null) {
        sendBytes(bytes);
      }
    },
    [sendBytes],
  );

  const focusInput = useCallback(() => {
    textInputRef.current?.focus();
  }, []);

  // --- Clipboard paste ---
  // Bracketed paste ON by default (modern shells handle it and distinguish
  // pasted text from typed text — useful for multi-line commands and editors).
  // TODO: gate via terminal mode detection once the server reports the
  // active terminal mode in TerminalFrame (DECSET 2004 state).
  const BRACKETED_PASTE = true;
  const paste = useCallback(async () => {
    try {
      const text = await Clipboard.getString();
      if (!text) return;
      if (BRACKETED_PASTE) {
        sendBytes('\x1b[200~' + text + '\x1b[201~');
      } else {
        sendBytes(text);
      }
    } catch (err) {
      console.warn('[SkiaTerminalView] paste failed:', err);
    }
  }, [sendBytes]);

  // --- Pan gesture → scrollOffset ---
  //
  // We commit scrollOffset updates from the worklet via runOnJS. For a
  // terminal, the pan gesture is short and low-rate (compared to a photo
  // gallery), so the JS-thread state approach is perfectly fine and keeps
  // the render tree plain React.
  //
  // Momentum: onEnd uses a simple velocity-based decay loop on the JS
  // thread. Avoids Reanimated `withDecay` binding to a SharedValue we
  // don't have (scrollOffset is React state). This is "good enough" for
  // terminal scroll; tune friction if it feels off.
  const panStartOffsetRef = useRef(0);
  const clampOffset = useCallback((n: number): number => {
    const max = ringRef.current.size;
    if (n < 0) return 0;
    if (n > max) return max;
    return n;
  }, []);

  const onPanStart = useCallback(() => {
    isPanningRef.current = true;
    panStartOffsetRef.current = scrollOffsetRef.current;
  }, []);

  const onPanUpdate = useCallback((translationY: number) => {
    const rows = Math.round(translationY / cellMetrics.height);
    // Drag down = scroll up into history (positive offset).
    const next = clampOffset(panStartOffsetRef.current + rows);
    if (next !== scrollOffsetRef.current) setScrollOffset(next);
    canvasRef.current?.redraw();
  }, [cellMetrics.height, clampOffset, canvasRef]);

  const onPanEnd = useCallback((velocityY: number) => {
    isPanningRef.current = false;
    // Simple momentum: decay velocity over time, update offset each tick.
    const FRICTION = 0.92; // per frame
    const THRESHOLD = 20;  // px/s — stop below this
    let v = velocityY;
    if (Math.abs(v) < THRESHOLD) return;
    const tick = () => {
      if (Math.abs(v) < THRESHOLD) return;
      const dyPerFrame = v / 60; // assume 60fps
      const rows = dyPerFrame / cellMetrics.height;
      const next = clampOffset(scrollOffsetRef.current + rows);
      if (next !== scrollOffsetRef.current) setScrollOffset(next);
      v *= FRICTION;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, [cellMetrics.height, clampOffset]);

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(4)
        .onStart(() => {
          runOnJS(onPanStart)();
        })
        .onUpdate((e) => {
          runOnJS(onPanUpdate)(e.translationY);
        })
        .onEnd((e) => {
          runOnJS(onPanEnd)(e.velocityY);
        }),
    [onPanStart, onPanUpdate, onPanEnd],
  );

  const longPress = useMemo(
    () =>
      Gesture.LongPress()
        .minDuration(450)
        .onStart(() => {
          runOnJS(paste)();
        }),
    [paste],
  );

  const composedGesture = useMemo(
    () => Gesture.Exclusive(panGesture, longPress),
    [panGesture, longPress],
  );

  // --- Styles ---
  const styles = useMemo(
    () =>
      StyleSheet.create({
        container: {
          flex: 1,
          backgroundColor: colors.bg.base,
        },
        canvas: { flex: 1 },
        pressLayer: {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
        },
        gestureLayer: {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
        },
        hiddenInput: {
          position: 'absolute',
          top: 0, left: 0, right: 0, bottom: 0,
          opacity: 0,
          color: 'transparent',
        },
        scrollIndicator: {
          position: 'absolute',
          right: 2,
          width: 3,
          backgroundColor: colors.fg.muted ?? colors.fg.primary,
          opacity: 0.4,
          borderRadius: 2,
        },
      }),
    [colors],
  );

  const canvasWidth = dims.cols * cellMetrics.width;
  const canvasHeight = dims.rows * cellMetrics.height;

  const defaultFg = colors.fg.primary;
  const defaultBg = colors.bg.base;
  const palette = colors.terminal as TerminalPalette;
  const cursorColor = colors.accent?.primary ?? defaultFg;

  const pr = PixelRatio.get();
  void pr;

  // --- Composed view grid (ring + live) for scrolled-back state ---
  // When scrollOffset=0 we render gridRef directly. Otherwise we build a
  // viewport of `dims.rows` rows: first `scrollOffset` rows from the top
  // come from the ring (oldest of the shown window first), then the
  // remaining `dims.rows - scrollOffset` rows come from the top of the
  // live grid.
  const viewGrid: Grid = useMemo(() => {
    if (scrollOffset <= 0) return gridRef.current;
    const out: Grid = new Array(dims.rows);
    // The top of the viewport is `scrollOffset` rows back in history.
    // Ring index 0 = most recent evicted row. So viewport row 0
    // corresponds to ring index (scrollOffset - 1), row 1 →
    // (scrollOffset - 2), etc. Rows below the ring window come from the
    // live grid, offset so live grid row 0 sits at viewport row
    // `scrollOffset`.
    const blank: Cell[] = new Array(dims.cols).fill(null).map(() => ({ ch: ' ' }));
    for (let r = 0; r < dims.rows; r++) {
      const ringPos = scrollOffset - 1 - r;
      if (ringPos >= 0) {
        out[r] = ringRef.current.get(ringPos) ?? blank;
      } else {
        const liveRow = r - scrollOffset;
        out[r] = gridRef.current[liveRow] ?? blank;
      }
    }
    return out;
    // Intentionally re-build when scrollOffset / dims change; grid/ring
    // mutations drive a canvas redraw via the redraw() call at their site.
  }, [scrollOffset, dims.cols, dims.rows]);

  const scrollIndicator = (() => {
    const ringSize = ringRef.current.size;
    if (scrollOffset <= 0 || ringSize <= 0) return null;
    const trackH = canvasHeight;
    const thumbH = Math.max(20, (dims.rows / (dims.rows + ringSize)) * trackH);
    // offset=0 → thumb at bottom, offset=ringSize → thumb at top
    const frac = 1 - scrollOffset / ringSize;
    const top = Math.max(0, Math.min(trackH - thumbH, frac * (trackH - thumbH)));
    return { top, height: thumbH };
  })();

  const cursorHidden = scrollOffset > 0;

  return (
    <View style={styles.container}>
      <Canvas ref={canvasRef} style={styles.canvas}>
        <Rect x={0} y={0} width={canvasWidth} height={canvasHeight} color={defaultBg} />

        <Group>
          {renderBackgrounds(viewGrid, cellMetrics, palette, defaultBg)}
        </Group>

        <Group>
          {renderGlyphs(viewGrid, cellMetrics, palette, defaultFg, fontBundle)}
        </Group>

        <Group>
          {renderUnderlines(viewGrid, cellMetrics, palette, defaultFg)}
        </Group>

        {!cursorHidden && cursorRef.current.visible && (
          <Rect
            x={cursorRef.current.col * cellMetrics.width}
            y={cursorRef.current.row * cellMetrics.height}
            width={cellMetrics.width}
            height={cellMetrics.height}
            color={cursorColor}
            opacity={cursorOn ? 1 : 0}
          />
        )}
      </Canvas>

      {/* Optional scroll indicator — a thin thumb on the right while scrolled */}
      {scrollIndicator && (
        <View
          pointerEvents="none"
          style={[styles.scrollIndicator, { top: scrollIndicator.top, height: scrollIndicator.height }]}
        />
      )}

      {/* Offscreen input: captures keystrokes and routes to terminal.write */}
      <TextInput
        ref={textInputRef}
        style={styles.hiddenInput}
        value={inputValue}
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        autoCorrect={false}
        autoCapitalize="none"
        spellCheck={false}
        keyboardType={Platform.OS === 'android' ? 'visible-password' : 'default'}
        multiline
        caretHidden
        underlineColorAndroid="transparent"
      />

      {/* Gesture layer: pan for scroll, long-press for paste. Sits above the
          pressable focus layer but below the hidden TextInput? — actually RN
          renders later siblings on top, so the input sits on top and receives
          focus taps; the gesture layer handles drags / long press. A plain
          tap inside GestureDetector still falls through to the Pressable
          below for focus (we use Gesture.Pan with minDistance). */}
      <GestureDetector gesture={composedGesture}>
        <View style={styles.gestureLayer} />
      </GestureDetector>

      {/* Pressable overlay: tap anywhere on the canvas to focus the input */}
      <Pressable style={styles.pressLayer} onPress={focusInput} />
    </View>
  );
}

// ----------------------------------------------------------
// Render helpers
// ----------------------------------------------------------

function renderBackgrounds(
  grid: Grid,
  m: { width: number; height: number; ascent: number },
  palette: TerminalPalette,
  defaultBg: string,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const bg = cell.bg;
      const inverse = (cell.flags ?? 0) & CELL_FLAG_INVERSE;
      if (bg === undefined && !inverse) continue;
      const color = inverse
        ? resolveColor(cell.fg, palette, '#ffffff')
        : resolveColor(bg, palette, defaultBg);
      out.push(
        <Rect
          key={`bg-${r}-${c}`}
          x={c * m.width}
          y={r * m.height}
          width={m.width}
          height={m.height}
          color={color}
        />,
      );
    }
  }
  return out;
}

function renderGlyphs(
  grid: Grid,
  m: { width: number; height: number; ascent: number },
  palette: TerminalPalette,
  defaultFg: string,
  bundle: FontBundle,
): React.ReactNode {
  if (!bundle.regular) return null;
  const out: React.ReactNode[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    let runStartCol = 0;
    let runText = '';
    let runColor = '';
    let runBold = false;
    let runItalic = false;

    const flushRun = () => {
      if (!runText.length) return;
      const f = pickFont(bundle, runBold, runItalic) ?? bundle.regular;
      if (!f) { runText = ''; return; }
      out.push(
        <SkText
          key={`t-${r}-${runStartCol}-${runBold ? 'b' : ''}${runItalic ? 'i' : ''}`}
          x={runStartCol * m.width}
          y={r * m.height + m.ascent}
          text={runText}
          font={f}
          color={runColor || defaultFg}
        />,
      );
      runText = '';
    };

    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const flags = cell.flags ?? 0;
      const inverse = flags & CELL_FLAG_INVERSE;
      const bold = !!(flags & CELL_FLAG_BOLD);
      const italic = !!(flags & CELL_FLAG_ITALIC);
      const fg = inverse
        ? resolveColor(cell.bg, palette, palette.black)
        : resolveColor(cell.fg, palette, defaultFg);

      const startsNewRun =
        runText.length === 0 ||
        fg !== runColor ||
        bold !== runBold ||
        italic !== runItalic;

      if (startsNewRun) {
        flushRun();
        runStartCol = c;
        runColor = fg;
        runBold = bold;
        runItalic = italic;
        runText = cell.ch || ' ';
      } else {
        runText += cell.ch || ' ';
      }
    }
    flushRun();
  }
  return out;
}

function renderUnderlines(
  grid: Grid,
  m: { width: number; height: number; ascent: number },
  palette: TerminalPalette,
  defaultFg: string,
): React.ReactNode {
  const out: React.ReactNode[] = [];
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r];
    let startCol = -1;
    let color = '';
    const flush = (endCol: number) => {
      if (startCol < 0) return;
      const y = r * m.height + m.ascent + 2;
      out.push(
        <Line
          key={`u-${r}-${startCol}`}
          p1={vec(startCol * m.width, y)}
          p2={vec(endCol * m.width, y)}
          color={color}
          strokeWidth={1}
        />,
      );
      startCol = -1;
    };
    for (let c = 0; c < row.length; c++) {
      const cell = row[c];
      const flags = cell.flags ?? 0;
      if (!(flags & CELL_FLAG_UNDERLINE)) {
        flush(c);
        continue;
      }
      const inverse = flags & CELL_FLAG_INVERSE;
      const fg = inverse
        ? resolveColor(cell.bg, palette, palette.black)
        : resolveColor(cell.fg, palette, defaultFg);
      if (startCol < 0) {
        startCol = c;
        color = fg;
      } else if (fg !== color) {
        flush(c);
        startCol = c;
        color = fg;
      }
    }
    flush(row.length);
  }
  return out;
}

export default SkiaTerminalView;
