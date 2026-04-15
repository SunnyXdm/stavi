// WHAT: NativeTerminal — unified terminal surface for Android and iOS.
// WHY:  Android uses the Fabric NativeTerminalView (Termux TerminalView) for
//       native performance. iOS uses xterm.js in a WebView as an equivalent.
//       Both expose the same NativeTerminalRef API to the plugin layer.
// HOW:  Android: Fabric codegen Commands forwarded to native view.
//       iOS: HTML built with token-interpolated colors and font at module load
//       time (static — no runtime theme switching), passed to WebView as source.
//       Messages bridge input/resize/ready events via postMessage/onMessage.
// SEE:  apps/mobile/src/theme/tokens.ts (terminal color tokens),
//       apps/mobile/src/plugins/workspace/terminal/index.tsx (plugin layer)

import React, {
  useRef,
  useCallback,
  useImperativeHandle,
  forwardRef,
} from 'react';
import {
  Platform,
  StyleSheet,
  type ViewStyle,
  type StyleProp,
} from 'react-native';
import WebView from 'react-native-webview';
import { XTERM_CSS, XTERM_JS, XTERM_FIT_JS } from './xtermBundle';
import NativeTerminalViewComponent, {
  Commands,
  type NativeTerminalViewProps,
} from '../specs/NativeTerminalViewNativeComponent';
import { colors, typography } from '../theme';

// ----------------------------------------------------------
// Public types
// ----------------------------------------------------------

export interface NativeTerminalRef {
  /** Write output data (from server) into the terminal emulator */
  write: (data: string) => void;
  /** Resize the terminal to given cols/rows */
  resize: (cols: number, rows: number) => void;
  /** Hard-reset the terminal (clear scrollback, reapply colors) */
  reset: () => void;
}

interface NativeTerminalProps {
  style?: StyleProp<ViewStyle>;
  /** Fired when user types (keyboard/IME or special keys) */
  onTerminalInput?: (data: string) => void;
  /** Fired when terminal dimensions change */
  onTerminalResize?: (cols: number, rows: number) => void;
  /** Fired once after session init with initial cols/rows */
  onTerminalReady?: (cols: number, rows: number) => void;
  /** Fired on BEL character */
  onTerminalBell?: () => void;
}

// ----------------------------------------------------------
// Android — real Termux TerminalView via Fabric
// ----------------------------------------------------------

const AndroidTerminal = forwardRef<NativeTerminalRef, NativeTerminalProps>(
  ({ style, onTerminalInput, onTerminalResize, onTerminalReady, onTerminalBell }, ref) => {
    const nativeRef = useRef<React.ElementRef<typeof NativeTerminalViewComponent>>(null);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          if (nativeRef.current) {
            Commands.write(nativeRef.current, data);
          }
        },
        resize: (cols: number, rows: number) => {
          if (nativeRef.current) {
            Commands.resize(nativeRef.current, cols, rows);
          }
        },
        reset: () => {
          if (nativeRef.current) {
            Commands.reset(nativeRef.current);
          }
        },
      }),
      [],
    );

    return (
      <NativeTerminalViewComponent
        ref={nativeRef}
        style={[styles.nativeTerminal, style]}
        onTerminalInput={(event) => {
          onTerminalInput?.(event.nativeEvent.data);
        }}
        onTerminalResize={(event) => {
          onTerminalResize?.(event.nativeEvent.cols, event.nativeEvent.rows);
        }}
        onTerminalReady={(event) => {
          onTerminalReady?.(event.nativeEvent.cols, event.nativeEvent.rows);
        }}
        onTerminalBell={() => {
          onTerminalBell?.();
        }}
      />
    );
  },
);

AndroidTerminal.displayName = 'AndroidTerminal';

// ----------------------------------------------------------
// iOS — xterm.js terminal via WebView
// ----------------------------------------------------------
// Architecture:
//   RN → WebView: postMessage({ type: 'write'|'reset', data })
//   WebView → RN: onMessage with { type: 'input'|'resize'|'ready', ... }

// iOS — xterm.js terminal via WebView
// Architecture:
//   RN → WebView: postMessage({ type: 'write'|'reset'|'fit', data })
//   WebView → RN: onMessage with { type: 'input'|'resize'|'ready', ... }
//
// HTML is built once at module load from token values. Token values are static
// (no runtime theme switching), so interpolation is safe. The '#fff' values
// below are intentional: '#fff' for the bright-white ANSI colour is a terminal
// convention, not a UI design choice.
function buildXtermHtml(): string {
  const bg = colors.bg.base;
  const fg = colors.terminal.white;
  const cursor = colors.fg.secondary;
  const { black, red, green, yellow, blue, magenta, cyan, white } = colors.terminal;
  const { brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightMagenta, brightCyan, brightWhite } = colors.terminal;
  // Mono font: token name first, then platform fallbacks
  const fontFamily = `${typography.fontFamily.mono}, ${typography.fontFamily.monoFallback}, Menlo, Monaco, monospace`;

  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: ${bg}; overflow: hidden; }
  #terminal { width: 100%; height: 100%; }
  .xterm { padding: 4px; }
  ${XTERM_CSS}
</style>
</head>
<body>
<div id="terminal"></div>
<script>${XTERM_JS}</script>
<script>${XTERM_FIT_JS}</script>
<script>
const term = new Terminal({
  theme: {
    background: '${bg}', foreground: '${fg}', cursor: '${cursor}',
    black: '${black}', red: '${red}', green: '${green}',
    yellow: '${yellow}', blue: '${blue}', magenta: '${magenta}',
    cyan: '${cyan}', white: '${white}',
    brightBlack: '${brightBlack}', brightRed: '${brightRed}', brightGreen: '${brightGreen}',
    brightYellow: '${brightYellow}', brightBlue: '${brightBlue}', brightMagenta: '${brightMagenta}',
    brightCyan: '${brightCyan}', brightWhite: '${brightWhite}',
  },
  fontFamily: '${fontFamily}',
  fontSize: 13,
  lineHeight: 1.2,
  cursorBlink: true,
  scrollback: 5000,
  convertEol: false,
});
const fitAddon = new FitAddon.FitAddon();
term.loadAddon(fitAddon);
term.open(document.getElementById('terminal'));
fitAddon.fit();
term.onData(function(data) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data: data }));
});
term.onResize(function(size) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
});
window.addEventListener('resize', function() { fitAddon.fit(); });
setTimeout(function() {
  fitAddon.fit();
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready', cols: term.cols, rows: term.rows }));
}, 100);
document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
function handleMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'write') term.write(msg.data);
    else if (msg.type === 'reset') term.reset();
    else if (msg.type === 'fit') fitAddon.fit();
  } catch(e) {}
}
</script>
</body>
</html>`;
}

const XTERM_HTML = buildXtermHtml();

const IOSXtermTerminal = forwardRef<NativeTerminalRef, NativeTerminalProps>(
  ({ style, onTerminalInput, onTerminalResize, onTerminalReady, onTerminalBell }, ref) => {
    const webviewRef = useRef<WebView>(null);
    const readyRef = useRef(false);
    const pendingRef = useRef<string[]>([]);

    useImperativeHandle(
      ref,
      () => ({
        write: (data: string) => {
          const msg = JSON.stringify({ type: 'write', data });
          if (readyRef.current) {
            webviewRef.current?.postMessage(msg);
          } else {
            // Buffer until ready
            pendingRef.current.push(msg);
          }
        },
        resize: (_cols: number, _rows: number) => {
          // xterm.js handles its own sizing via FitAddon
          webviewRef.current?.postMessage(JSON.stringify({ type: 'fit' }));
        },
        reset: () => {
          webviewRef.current?.postMessage(JSON.stringify({ type: 'reset' }));
        },
      }),
      [],
    );

    const handleMessage = useCallback(
      (event: { nativeEvent: { data: string } }) => {
        try {
          const msg = JSON.parse(event.nativeEvent.data);
          if (msg.type === 'ready') {
            readyRef.current = true;
            // Flush pending writes
            for (const pending of pendingRef.current) {
              webviewRef.current?.postMessage(pending);
            }
            pendingRef.current = [];
            onTerminalReady?.(msg.cols ?? 80, msg.rows ?? 24);
          } else if (msg.type === 'input') {
            onTerminalInput?.(msg.data);
          } else if (msg.type === 'resize') {
            onTerminalResize?.(msg.cols, msg.rows);
          }
        } catch { /* ignore malformed */ }
      },
      [onTerminalInput, onTerminalResize, onTerminalReady],
    );

    return (
      <WebView
        ref={webviewRef}
        style={[styles.iosTerminal, style]}
        source={{ html: XTERM_HTML }}
        onMessage={handleMessage}
        originWhitelist={['*']}
        javaScriptEnabled
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="compatibility"
        cacheEnabled={false}
      />
    );
  },
);

IOSXtermTerminal.displayName = 'IOSXtermTerminal';

// ----------------------------------------------------------
// Platform-switched export
// ----------------------------------------------------------

const NativeTerminal = Platform.OS === 'android' ? AndroidTerminal : IOSXtermTerminal;

export default NativeTerminal;
export type { NativeTerminalProps };

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  // bg.base must match the Kotlin TerminalView background color set in initSession
  nativeTerminal: { flex: 1, backgroundColor: colors.bg.base },
  iosTerminal:    { flex: 1, backgroundColor: colors.bg.base },
});
