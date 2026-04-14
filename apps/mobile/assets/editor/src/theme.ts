// WHAT: Stavi dark theme for CodeMirror 6.
// WHY:  Matches the Stavi design token palette (bg.base=#161616, accent.primary=#5fccb0).
// HOW:  Uses @codemirror/theme-one-dark as a base and overrides tokens to
//       match the Stavi color system.
// SEE:  apps/mobile/src/theme/tokens.ts for the canonical token values.

import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';

export const staviTheme = [
  oneDark,
  EditorView.theme({
    '&': {
      backgroundColor: '#161616',
      color: '#c0c0c0',
      height: '100%',
    },
    '.cm-content': {
      fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", "Menlo", "Monaco", monospace',
      fontSize: '13px',
      lineHeight: '1.6',
      caretColor: '#5fccb0',
    },
    '.cm-gutters': {
      backgroundColor: '#1a1a1a',
      color: '#666666',
      border: 'none',
      borderRight: '1px solid #2a2a2a',
    },
    '.cm-activeLineGutter': {
      backgroundColor: '#212121',
    },
    '.cm-activeLine': {
      backgroundColor: 'rgba(95, 204, 176, 0.04)',
    },
    '.cm-selectionBackground, ::selection': {
      backgroundColor: 'rgba(95, 204, 176, 0.20) !important',
    },
    '.cm-cursor': {
      borderLeftColor: '#5fccb0',
      borderLeftWidth: '2px',
    },
    '.cm-lineNumbers': {
      color: '#666666',
    },
    '.cm-searchMatch': {
      backgroundColor: 'rgba(251, 191, 36, 0.25)',
      outline: '1px solid rgba(251, 191, 36, 0.4)',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: 'rgba(251, 191, 36, 0.45)',
    },
  }),
];
