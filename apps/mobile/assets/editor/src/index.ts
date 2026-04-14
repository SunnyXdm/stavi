// WHAT: CodeMirror 6 editor entry point for the Stavi WebView.
// WHY:  Bootstraps the editor, sets up the postMessage bridge, and handles
//       loadFile / undo / redo / find / format messages from React Native.
// HOW:  Creates a single EditorView, attaches it to #editor, then signals
//       'ready' via the bridge. All JS→Web messages are handled in bridge.ts.
//       A custom update listener emits contentChanged and cursorMoved events.
// SEE:  src/bridge.ts (wire types), src/languages.ts (language packs),
//       src/theme.ts (visual theme)

import { EditorView, lineNumbers, highlightActiveLine, keymap, drawSelection } from '@codemirror/view';
import { EditorState, Compartment } from '@codemirror/state';
import { defaultKeymap, historyKeymap, history, indentWithTab } from '@codemirror/commands';
import { bracketMatching, foldGutter, indentOnInput, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language';
import { closeBrackets, autocompletion } from '@codemirror/autocomplete';
import { search, searchKeymap } from '@codemirror/search';
import { staviTheme } from './theme';
import { getLanguage } from './languages';
import {
  setupBridge,
  emitContentChanged,
  emitCursorMoved,
  emitSaveRequested,
  type JsToWeb,
} from './bridge';

// ----------------------------------------------------------
// Editor state
// ----------------------------------------------------------

let currentPath = '';
let originalContent = '';
const languageCompartment = new Compartment();

// ----------------------------------------------------------
// Extensions (static — do not change after creation)
// ----------------------------------------------------------

function buildExtensions(initialPath: string) {
  const lang = getLanguage(initialPath);
  return [
    lineNumbers(),
    foldGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    highlightActiveLine(),
    search({ top: false }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
    keymap.of([
      ...defaultKeymap,
      ...historyKeymap,
      ...searchKeymap,
      indentWithTab,
      // Ctrl/Cmd + S → save
      {
        key: 'Mod-s',
        run: () => {
          emitSaveRequested();
          return true;
        },
      },
    ]),
    languageCompartment.of(lang ?? []),
    ...staviTheme,
    EditorView.updateListener.of((update) => {
      // Content changes
      if (update.docChanged) {
        const content = update.state.doc.toString();
        const dirty = content !== originalContent;
        emitContentChanged(content, dirty);
      }
      // Cursor movement
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        const lineNum = line.number;
        const col = pos - line.from + 1;
        emitCursorMoved(lineNum, col);
      }
    }),
    // Base dark background
    EditorView.theme({
      '&': { height: '100%' },
    }),
  ];
}

// ----------------------------------------------------------
// Create the editor
// ----------------------------------------------------------

const container = document.getElementById('editor')!;

let view = new EditorView({
  state: EditorState.create({
    doc: '',
    extensions: buildExtensions(''),
  }),
  parent: container,
});

// ----------------------------------------------------------
// Handle loadFile event (dispatched by bridge.ts)
// ----------------------------------------------------------

window.addEventListener('stavi:loadFile', (event) => {
  const msg = (event as CustomEvent).detail as Extract<JsToWeb, { type: 'loadFile' }>;

  currentPath = msg.path;
  originalContent = msg.content;

  const lang = getLanguage(msg.path);

  // Replace the document and re-configure the language
  view.dispatch({
    changes: {
      from: 0,
      to: view.state.doc.length,
      insert: msg.content,
    },
    effects: languageCompartment.reconfigure(lang ?? []),
    // Reset undo history when loading a new file
    filter: false,
  });

  // Scroll to top
  view.dispatch({
    selection: { anchor: 0 },
    scrollIntoView: true,
  });
});

// ----------------------------------------------------------
// Setup bridge (signals 'ready' to React Native)
// ----------------------------------------------------------

setupBridge(view, () => view.state.doc.toString());
