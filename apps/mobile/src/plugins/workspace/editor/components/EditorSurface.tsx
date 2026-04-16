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

import React, { useRef, useEffect, useCallback, useId } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import { FileText, AlertCircle } from 'lucide-react-native';
import { colors, typography, spacing } from '../../../../theme';
import { useEditorStore } from '../store';
import { isBinary, detectLanguage } from '../language-map';
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
  | { type: 'setTheme'; theme: 'dark' | 'light' }
  | { type: 'requestContent'; requestId: string }
  | { type: 'find' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'format' };

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
  // iOS: bundle resources are in the main bundle at assets/editor/
  const { bundlePath } = require('react-native/Libraries/Core/Devtools/getDevServer');
  // Production build — the file is in the bundle directory
  return `${bundlePath || ''}editor/index.html`;
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
  const webviewRef = useRef<WebView>(null);
  const bridgeInstance = useRef(new EditorBridge(webviewRef));
  const lastLoadedPath = useRef<string | null>(null);
  const { setFileDirty, setFileContent } = useEditorStore.getState();

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
          Alert.alert('Save failed', err instanceof Error ? err.message : 'Unknown error');
        }
      },
      undo: () => bridge.send({ type: 'undo' }),
      redo: () => bridge.send({ type: 'redo' }),
      find: () => bridge.send({ type: 'find' }),
    };
  }, [activeFile, sessionId, serverId, bridgeRef, setFileContent]);

  // Load file when activeFile changes
  useEffect(() => {
    if (!activeFile || activeFile.loading || activeFile.error) return;
    if (isBinary(activeFile.path)) return;
    if (lastLoadedPath.current === activeFile.path) return;

    const byteSize = activeFile.content.length; // UTF-16 length; good-enough proxy for byte size
    if (byteSize > LARGE_FILE_REFUSE_BYTES) {
      Alert.alert('File too large', 'Files over 10 MB cannot be opened in the editor.');
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
      Alert.alert(
        'Large file',
        `This file is ${(byteSize / 1024 / 1024).toFixed(1)} MB. Opening may be slow.`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Open anyway', onPress: doLoad },
        ],
      );
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
  const showBinary = !showEmpty && !showLoading && !showError && isBinary(activeFile.path);
  const showOverlay = showEmpty || showLoading || showError || showBinary;

  return (
    <View style={styles.container}>
      {/* WebView is always mounted — never conditionally rendered */}
      <WebView
        ref={webviewRef}
        style={styles.webview}
        source={{ uri: 'file:///android_asset/editor/index.html' }}
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

// ----------------------------------------------------------
// Styles
// ----------------------------------------------------------

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bg.base,
  },
  // Overlay covers the WebView for empty/loading/error/binary states.
  // Uses bg.base background so the WebView beneath is fully hidden.
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg.base,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing[3],
    padding: spacing[6],
  },
  emptyText: {
    fontSize: typography.fontSize.sm,
    color: colors.fg.muted,
    textAlign: 'center',
  },
  binaryPath: {
    fontSize: typography.fontSize.xs,
    color: colors.fg.muted,
    fontFamily: typography.fontFamily.mono,
  },
});
