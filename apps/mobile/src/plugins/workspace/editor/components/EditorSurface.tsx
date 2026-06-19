// WHAT: Editor content area — WebView hosting CodeMirror 6 (Phase 4b).
// WHY:  Replaces the Phase 4a plain-text placeholder with a real code editor.
//       One WebView per Editor plugin instance; tab switching = loadFile call.
// HOW:  Loads apps/mobile/assets/editor/index.html via file:// URI (Android) or
//       bundle dir (iOS). Drives the editor via postMessage bridge. Queues all
//       messages until the WebView emits 'ready'. Large file guard: >2MB prompt,
//       >10MB refuse. Binary files show a card (no WebView).
// SEE:  apps/mobile/assets/editor/src/bridge.ts (wire types),
//       apps/mobile/src/plugins/workspace/editor/language-map.ts,
//       apps/mobile/src/plugins/workspace/editor/store.ts

import React, { useRef, useEffect, useCallback, useId, useMemo } from 'react';
import {
  View,
  Text,
  Image,
  StyleSheet,
  Platform,
  ActivityIndicator,
} from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { FileText, AlertCircle } from 'lucide-react-native';
import { SvgXml } from 'react-native-svg';
import { useTheme, typography, spacing } from '../../../../theme';
import { showAlert, showConfirm } from '../../../../components/sheets/AppSheets';
import { useEditorStore } from '../store';
import { useConnectionStore } from '../../../../stores/connection';
import { usePluginSetting } from '../../../../stores/plugin-settings-store';
import { isBinary, isImage, isSvg, detectLanguage } from '../language-map';
import type { EditorAction } from './EditorToolbar';
import type { OpenFile } from '../store';

// ----------------------------------------------------------
// Constants
// ----------------------------------------------------------

const LARGE_FILE_WARN_BYTES = 2 * 1024 * 1024;  // 2 MB
const LARGE_FILE_REFUSE_BYTES = 10 * 1024 * 1024; // 10 MB

// ----------------------------------------------------------
// Bridge message types
// ----------------------------------------------------------

type JsToWeb =
  | { type: 'loadFile'; path: string; content: string; language: string | null }
  | { type: 'setTheme'; theme: string }
  | { type: 'requestContent'; requestId: string }
  | { type: 'find' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'insertText'; text: string };

type WebToJs =
  | { type: 'ready' }
  | { type: 'contentChanged'; content: string; dirty: boolean }
  | { type: 'cursorMoved'; line: number; col: number }
  | { type: 'contentResponse'; requestId: string; content: string }
  | { type: 'saveRequested' }
  | { type: 'error'; message: string };

// ----------------------------------------------------------
// Asset URI helper
// ----------------------------------------------------------

function getEditorUri(): string {
  if (Platform.OS === 'android') {
    return 'file:///android_asset/editor/index.html';
  }
  // iOS: the editor assets are copied into the app bundle's editor/ dir by an
  // Xcode build phase. RN does NOT expose the main-bundle path to JS, so we read
  // it from the StaviBundle native module (ios/Stavi/StaviBundle.{swift,m}).
  // NOTE: do NOT revert this to getDevServer/bundlePath — RN has no bundlePath
  // constant, so that path silently returns an unresolvable relative URI and
  // breaks the iOS editor. The native constant is required.
  const { StaviBundle } = require('react-native').NativeModules as {
    StaviBundle?: { mainBundlePath?: string; getConstants?: () => { mainBundlePath?: string } };
  };
  const dir = StaviBundle?.getConstants?.().mainBundlePath ?? StaviBundle?.mainBundlePath;
  if (!dir) {
    // Native module not registered yet (e.g. before the iOS rebuild that adds
    // StaviBundle). Degrade to a relative path rather than throwing — the editor
    // will be blank on iOS until the native module ships, but the app won't crash.
    return 'editor/index.html';
  }
  return `file://${dir}/editor/index.html`;
}

// ----------------------------------------------------------
// Bridge helper — holds queue until ready
// ----------------------------------------------------------

class EditorBridge {
  private webviewRef: React.RefObject<WebView | null>;
  private ready = false;
  private queue: JsToWeb[] = [];
  private pendingResponses = new Map<string, (content: string) => void>();

  constructor(ref: React.RefObject<WebView | null>) {
    this.webviewRef = ref;
  }

  onReady() {
    this.ready = true;
    for (const msg of this.queue) {
      this.send(msg);
    }
    this.queue = [];
  }

  reset() {
    this.ready = false;
    this.queue = [];
    this.pendingResponses.clear();
  }

  send(msg: JsToWeb) {
    if (!this.ready) {
      this.queue.push(msg);
      return;
    }
    const js = `window.dispatchEvent(new MessageEvent('message',{data:${JSON.stringify(JSON.stringify(msg))}}));true;`;
    this.webviewRef.current?.injectJavaScript(js);
  }

  async requestContent(requestId: string): Promise<string> {
    return new Promise((resolve) => {
      this.pendingResponses.set(requestId, resolve);
      this.send({ type: 'requestContent', requestId });
      // Timeout after 10s
      setTimeout(() => {
        if (this.pendingResponses.has(requestId)) {
          this.pendingResponses.delete(requestId);
          resolve('');
        }
      }, 10_000);
    });
  }

  handleContentResponse(requestId: string, content: string) {
    const resolve = this.pendingResponses.get(requestId);
    if (resolve) {
      this.pendingResponses.delete(requestId);
      resolve(content);
    }
  }
}

// ----------------------------------------------------------
// Props
// ----------------------------------------------------------

interface EditorSurfaceProps {
  activeFile: OpenFile | undefined;
  sessionId: string;
  serverId: string;
  onAction?: (action: EditorAction) => void;
  onCursorMoved?: (line: number, col: number) => void;
  /** Forwarded from index.tsx so toolbar Save calls the bridge */
  bridgeRef?: React.MutableRefObject<EditorBridgeHandle | null>;
}

export interface EditorBridgeHandle {
  save(): Promise<void>;
  undo(): void;
  redo(): void;
  find(): void;
  /** Insert text at the cursor (symbols quick-insert bar). */
  insertText(text: string): void;
}

// ----------------------------------------------------------
// Component
// ----------------------------------------------------------

export function EditorSurface({
  activeFile,
  sessionId,
  serverId,
  onCursorMoved,
  bridgeRef,
}: EditorSurfaceProps) {
  const { colors } = useTheme();
  // Platform-constant editor asset URI (Android asset path / iOS bundle path).
  const editorUri = useMemo(() => getEditorUri(), []);
  const styles = useMemo(() => StyleSheet.create({
    container: { flex: 1 },
    webview: { flex: 1, backgroundColor: colors.bg.base },
    overlay: { ...StyleSheet.absoluteFill, backgroundColor: colors.bg.base, alignItems: 'center', justifyContent: 'center', gap: spacing[3], padding: spacing[6] },
    emptyText: { fontSize: typography.fontSize.sm, color: colors.fg.muted, textAlign: 'center' },
    binaryPath: { fontSize: typography.fontSize.xs, color: colors.fg.muted, fontFamily: typography.fontFamily.mono },
  }), [colors]);

  const webviewRef = useRef<WebView>(null);
  const bridgeInstance = useRef(new EditorBridge(webviewRef));
  const lastLoadedPath = useRef<string | null>(null);
  const { setFileDirty, setFileContent } = useEditorStore.getState();

  // Editor theme is user-selectable (Settings → Editor → Appearance).
  // Inject on mount and whenever the chosen theme changes.
  const editorTheme = usePluginSetting<string>('editor', 'theme');
  useEffect(() => {
    bridgeInstance.current.send({ type: 'setTheme', theme: editorTheme ?? 'stavi-dark' });
  }, [editorTheme]);

  // Expose bridge handle to parent (for toolbar actions)
  useEffect(() => {
    if (!bridgeRef) return;
    const bridge = bridgeInstance.current;
    bridgeRef.current = {
      save: async () => {
        if (!activeFile) return;
        const requestId = `save-${Date.now()}`;
        const content = await bridge.requestContent(requestId);
        if (!content) return;
        try {
          const { useConnectionStore } = await import('../../../../stores/connection');
          const client = useConnectionStore.getState().getClientForServer(serverId);
          if (!client) throw new Error('Not connected');
          await client.request('fs.write', { path: activeFile.path, content });
          setFileContent(sessionId, activeFile.path, content);
        } catch (err) {
          void showAlert({ title: 'Save failed', message: err instanceof Error ? err.message : 'Unknown error' });
        }
      },
      undo: () => bridge.send({ type: 'undo' }),
      redo: () => bridge.send({ type: 'redo' }),
      find: () => bridge.send({ type: 'find' }),
      insertText: (text: string) => bridge.send({ type: 'insertText', text }),
    };
  }, [activeFile, sessionId, serverId, bridgeRef, setFileContent]);

  // Load file when activeFile changes
  useEffect(() => {
    if (!activeFile || activeFile.loading || activeFile.error) return;
    if (isBinary(activeFile.path)) return;
    if (lastLoadedPath.current === activeFile.path) return;

    const byteSize = activeFile.content.length; // UTF-16 length; good-enough proxy for byte size
    if (byteSize > LARGE_FILE_REFUSE_BYTES) {
      void showAlert({ title: 'File too large', message: 'Files over 10 MB cannot be opened in the editor.' });
      return;
    }

    const doLoad = () => {
      lastLoadedPath.current = activeFile.path;
      bridgeInstance.current.send({
        type: 'loadFile',
        path: activeFile.path,
        content: activeFile.content,
        language: detectLanguage(activeFile.path),
      });
    };

    if (byteSize > LARGE_FILE_WARN_BYTES) {
      void showConfirm({
        title: 'Large file',
        message: `This file is ${(byteSize / 1024 / 1024).toFixed(1)} MB. Opening may be slow.`,
        confirmLabel: 'Open anyway',
      }).then((ok) => { if (ok) doLoad(); });
    } else {
      doLoad();
    }
  }, [activeFile]);

  // Handle messages from the WebView
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let msg: WebToJs;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      switch (msg.type) {
        case 'ready':
          bridgeInstance.current.onReady();
          break;

        case 'contentChanged':
          if (activeFile) {
            setFileDirty(sessionId, activeFile.path, msg.dirty);
          }
          break;

        case 'cursorMoved':
          onCursorMoved?.(msg.line, msg.col);
          break;

        case 'contentResponse':
          bridgeInstance.current.handleContentResponse(msg.requestId, msg.content);
          break;

        case 'saveRequested':
          // User pressed Ctrl/Cmd+S inside the editor
          bridgeRef?.current?.save();
          break;

        case 'error':
          console.error('[EditorSurface] WebView error:', msg.message);
          break;
      }
    },
    [activeFile, sessionId, setFileDirty, onCursorMoved, bridgeRef],
  );

  // When path changes (new tab switch), load the new file
  useEffect(() => {
    if (activeFile?.path !== lastLoadedPath.current) {
      lastLoadedPath.current = null;
    }
  }, [activeFile?.path]);

  // ----------------------------------------------------------
  // Determine overlay state (shown on top of the always-mounted WebView)
  // ----------------------------------------------------------
  // The WebView is ALWAYS in the component tree — never conditionally rendered.
  // Fabric (New Architecture) requires each native view to have exactly one
  // parent; mounting/unmounting the WebView across tab switches causes
  // "addViewAt: failed to insert view … child already has a parent".
  // Fix: render all states as absoluteFill overlays over the persistent WebView.

  const showEmpty = !activeFile;
  const showLoading = !showEmpty && activeFile.loading;
  const showError = !showEmpty && !showLoading && Boolean(activeFile.error);
  // Image previews take precedence over the generic binary card.
  const showImage = !showEmpty && !showLoading && !showError && isImage(activeFile.path);
  const showSvg = !showEmpty && !showLoading && !showError && isSvg(activeFile.path) && !!activeFile.content;
  const showBinary = !showEmpty && !showLoading && !showError && !showImage && !showSvg && isBinary(activeFile.path);
  const showOverlay = showEmpty || showLoading || showError || showImage || showSvg || showBinary;

  // Authenticated file URL for raster previews (same pattern as the browser's
  // /proxy usage — query token because <Image> URIs are header-less).
  const savedConnection = useConnectionStore((s) =>
    s.savedConnections.find((c) => c.id === serverId),
  );
  const imageUri = showImage && savedConnection
    ? `${savedConnection.tls ? 'https' : 'http'}://${savedConnection.host}:${savedConnection.port}/file?path=${encodeURIComponent(activeFile!.path)}&token=${encodeURIComponent(savedConnection.bearerToken)}`
    : null;

  return (
    <View style={styles.container}>
      {/* WebView is always mounted — never conditionally rendered */}
      <WebView
        ref={webviewRef}
        style={styles.webview}
        source={{ uri: editorUri }}
        originWhitelist={['*']}
        onMessage={handleMessage}
        onLoadStart={() => {
          // Reset bridge state on reload (e.g., hot-reload during dev)
          bridgeInstance.current.reset();
          lastLoadedPath.current = null;
        }}
        javaScriptEnabled
        allowFileAccess
        allowUniversalAccessFromFileURLs
        allowFileAccessFromFileURLs
        mixedContentMode="always"
        bounces={false}
        scrollEnabled={false}
        keyboardDisplayRequiresUserAction={false}
      />

      {/* Overlay states sit on top of the WebView and visually hide it */}
      {showOverlay && (
        <View style={styles.overlay}>
          {showEmpty && (
            <>
              <FileText size={32} color={colors.fg.muted} />
              <Text style={styles.emptyText}>Open a file from the tree</Text>
            </>
          )}
          {showLoading && (
            <ActivityIndicator size="small" color={colors.accent.primary} />
          )}
          {showError && (
            <>
              <AlertCircle size={24} color={colors.semantic.error} />
              <Text style={[styles.emptyText, { color: colors.semantic.error }]}>
                {activeFile!.error}
              </Text>
            </>
          )}
          {showImage && (
            imageUri ? (
              <Image
                source={{ uri: imageUri }}
                style={imagePreviewStyle}
                resizeMode="contain"
              />
            ) : (
              <Text style={styles.emptyText}>Connect to the server to preview images</Text>
            )
          )}
          {showSvg && (
            <View style={imagePreviewStyle}>
              <SvgErrorBoundary fallback={<Text style={styles.emptyText}>Could not render SVG</Text>}>
                <SvgXml xml={activeFile!.content} width="100%" height="100%" />
              </SvgErrorBoundary>
            </View>
          )}
          {showBinary && (
            <>
              <FileText size={32} color={colors.fg.muted} />
              <Text style={styles.emptyText}>Binary file — preview not available</Text>
              <Text style={styles.binaryPath}>{activeFile!.path.split('/').pop()}</Text>
            </>
          )}
        </View>
      )}
    </View>
  );
}

// Fills the overlay; images letterbox via resizeMode="contain".
const imagePreviewStyle = { width: '100%', height: '100%', flex: 1 } as const;

/** SvgXml throws synchronously on malformed XML — contain it. */
class SvgErrorBoundary extends React.Component<
  { fallback: React.ReactNode; children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

// Styles computed dynamically via useMemo — see component body.
