// ============================================================
// NativeTerminalView — Fabric Codegen Spec
// ============================================================
// Shared codegen spec for Android (Termux TerminalView) and
// iOS (SwiftTerm). Defines the component interface:
//   - Props (ViewProps only, no fontSize — managed natively)
//   - Direct events (onTerminalInput, onTerminalResize, etc.)
//   - Native commands (write, resize, reset)
//
// The codegen generates both platform bindings from this spec.

import {
  codegenNativeCommands,
  codegenNativeComponent,
  type ViewProps,
} from 'react-native';
import type {
  Int32,
  DirectEventHandler,
} from 'react-native/Libraries/Types/CodegenTypes';

// ----------------------------------------------------------
// Event payloads
// ----------------------------------------------------------

type InputEvent = Readonly<{
  data: string;
}>;

type SizeEvent = Readonly<{
  cols: Int32;
  rows: Int32;
}>;

// ----------------------------------------------------------
// Component props
// ----------------------------------------------------------

export interface NativeTerminalViewProps extends ViewProps {
  /**
   * Fired when the user types (keyboard/IME input or special keys).
   * `data` contains the raw character(s) or escape sequence.
   */
  onTerminalInput?: DirectEventHandler<InputEvent>;

  /**
   * Fired when the terminal dimensions change (font size change,
   * layout change, or explicit resize).
   */
  onTerminalResize?: DirectEventHandler<SizeEvent>;

  /**
   * Fired once after the terminal session is initialized and the
   * emulator has computed its initial cols/rows.
   */
  onTerminalReady?: DirectEventHandler<SizeEvent>;

  /**
   * Fired when the terminal emulator receives a BEL character.
   */
  onTerminalBell?: DirectEventHandler<Readonly<{}>>;
}

// ----------------------------------------------------------
// Component registration
// ----------------------------------------------------------

const NativeTerminalViewComponent =
  codegenNativeComponent<NativeTerminalViewProps>('NativeTerminalView');

export default NativeTerminalViewComponent;

// ----------------------------------------------------------
// Native commands
// ----------------------------------------------------------

type NativeTerminalViewType = typeof NativeTerminalViewComponent;

interface NativeCommands {
  /**
   * Write output data (from WebSocket) into the terminal emulator.
   * The terminal renders the ANSI sequences and updates the screen.
   */
  write: (
    viewRef: React.ElementRef<NativeTerminalViewType>,
    data: string,
  ) => void;

  /**
   * Resize the terminal emulator to the given dimensions.
   */
  resize: (
    viewRef: React.ElementRef<NativeTerminalViewType>,
    cols: Int32,
    rows: Int32,
  ) => void;

  /**
   * Hard-reset the terminal emulator (clear scrollback, reapply colors).
   */
  reset: (viewRef: React.ElementRef<NativeTerminalViewType>) => void;
}

export const Commands = codegenNativeCommands<NativeCommands>({
  supportedCommands: ['write', 'resize', 'reset'],
});
