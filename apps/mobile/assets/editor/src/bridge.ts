// WHAT: PostMessage bridge between React Native (JS) and the WebView (Web).
// WHY:  React Native drives the editor via postMessage; the editor responds with
//       content changes, cursor moves, and save events.
// HOW:  The bridge queues all outgoing JS→Web messages until the editor
//       signals 'ready'. Incoming Web→JS messages are sent via
//       window.ReactNativeWebView.postMessage (Android/iOS).
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx

import type { EditorView } from '@codemirror/view';

// ----------------------------------------------------------
// Wire types (exact shapes from the master plan §Phase 4b)
// ----------------------------------------------------------

export type JsToWeb =
  | { type: 'loadFile'; path: string; content: string; language: string | null }
  | { type: 'setTheme'; theme: 'dark' | 'light' }
  | { type: 'requestContent'; requestId: string }
  | { type: 'find' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'format' };

export type WebToJs =
  | { type: 'ready' }
  | { type: 'contentChanged'; content: string; dirty: boolean }
  | { type: 'cursorMoved'; line: number; col: number }
  | { type: 'contentResponse'; requestId: string; content: string }
  | { type: 'saveRequested' }
  | { type: 'error'; message: string };

// ----------------------------------------------------------
// Send a message to React Native
// ----------------------------------------------------------

function sendToRN(msg: WebToJs) {
  try {
    const w = window as any;
    if (w.ReactNativeWebView?.postMessage) {
      w.ReactNativeWebView.postMessage(JSON.stringify(msg));
    } else {
      // Fallback for debug in a plain browser
      window.parent.postMessage(JSON.stringify(msg), '*');
    }
  } catch (err) {
    console.error('[bridge] sendToRN error', err);
  }
}

// ----------------------------------------------------------
// Bridge setup
// ----------------------------------------------------------

export function setupBridge(view: EditorView, getContent: () => string) {
  // Notify React Native that the editor is ready
  sendToRN({ type: 'ready' });

  // Listen for incoming messages from React Native
  const handleMessage = (event: MessageEvent) => {
    let msg: JsToWeb;
    try {
      msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
    } catch {
      return;
    }
    handleJsToWebMessage(msg, view, getContent);
  };

  window.addEventListener('message', handleMessage);

  return () => {
    window.removeEventListener('message', handleMessage);
  };
}

function handleJsToWebMessage(
  msg: JsToWeb,
  view: EditorView,
  getContent: () => string,
) {
  switch (msg.type) {
    case 'loadFile': {
      // Handled in index.ts (needs language re-init)
      window.dispatchEvent(new CustomEvent('stavi:loadFile', { detail: msg }));
      break;
    }

    case 'setTheme': {
      // Theme is baked into the bundle; ignore in Phase 4b (single dark theme)
      break;
    }

    case 'requestContent': {
      const content = getContent();
      sendToRN({ type: 'contentResponse', requestId: msg.requestId, content });
      break;
    }

    case 'find': {
      // Trigger CodeMirror's built-in search panel
      import('@codemirror/search').then(({ openSearchPanel }) => {
        openSearchPanel(view);
      });
      break;
    }

    case 'undo': {
      import('@codemirror/commands').then(({ undo }) => {
        undo(view);
      });
      break;
    }

    case 'redo': {
      import('@codemirror/commands').then(({ redo }) => {
        redo(view);
      });
      break;
    }

    case 'format': {
      // Phase 4b: no formatter. Could add Prettier integration later.
      break;
    }
  }
}

// ----------------------------------------------------------
// Emit content change to React Native
// ----------------------------------------------------------

export function emitContentChanged(content: string, dirty: boolean) {
  sendToRN({ type: 'contentChanged', content, dirty });
}

// ----------------------------------------------------------
// Emit cursor position to React Native
// ----------------------------------------------------------

export function emitCursorMoved(line: number, col: number) {
  sendToRN({ type: 'cursorMoved', line, col });
}

// ----------------------------------------------------------
// Emit save-requested (Cmd/Ctrl+S in the editor)
// ----------------------------------------------------------

export function emitSaveRequested() {
  sendToRN({ type: 'saveRequested' });
}
