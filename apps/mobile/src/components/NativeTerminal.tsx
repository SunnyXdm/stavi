// ============================================================
// NativeTerminal — Native terminal surface
// ============================================================
// On Android: renders the Fabric NativeTerminalView (Termux
// TerminalView). Imperative write/resize/reset commands are
// forwarded via codegen Commands to the native view.
//
// On iOS: renders an xterm.js terminal inside a WebView.
// Messages are passed via postMessage / onMessage bridge.
//
// The plugin layer always sees the same NativeTerminalRef API.

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

// Build HTML with inlined scripts/styles — no CDN dependency, works offline
function buildXtermHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; background: #161616; overflow: hidden; }
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
    background: '#161616',
    foreground: '#e0e0e0',
    cursor: '#e0e0e0',
    black: '#1e1e1e', red: '#f44747', green: '#6a9955',
    yellow: '#d7ba7d', blue: '#569cd6', magenta: '#c586c0',
    cyan: '#4ec9b0', white: '#d4d4d4',
    brightBlack: '#808080', brightRed: '#f44747', brightGreen: '#b5cea8',
    brightYellow: '#d7ba7d', brightBlue: '#9cdcfe', brightMagenta: '#c586c0',
    brightCyan: '#4ec9b0', brightWhite: '#ffffff',
  },
  fontFamily: 'Menlo, Monaco, monospace',
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

// Send input from terminal to RN
term.onData(function(data) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'input', data: data }));
});

// Send resize events to RN
term.onResize(function(size) {
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'resize', cols: size.cols, rows: size.rows }));
});

// Handle resize when window changes
window.addEventListener('resize', function() {
  fitAddon.fit();
});

// Signal ready with initial dimensions
setTimeout(function() {
  fitAddon.fit();
  window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ready', cols: term.cols, rows: term.rows }));
}, 100);

// Handle messages from RN
document.addEventListener('message', handleMessage);
window.addEventListener('message', handleMessage);
function handleMessage(event) {
  try {
    const msg = JSON.parse(event.data);
    if (msg.type === 'write') {
      term.write(msg.data);
    } else if (msg.type === 'reset') {
      term.reset();
    } else if (msg.type === 'fit') {
      fitAddon.fit();
    }
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
  nativeTerminal: {
    flex: 1,
    backgroundColor: '#161616', // bg.base — must match Kotlin initSession background
  },
  iosTerminal: {
    flex: 1,
    backgroundColor: '#161616',
  },
});
