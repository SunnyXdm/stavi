// WHAT: CodeMirror 6 theme registry for the Stavi editor.
// WHY:  Users pick an editor theme (Settings → Editor). Each entry is a
//       self-contained CM6 extension (editor theme + syntax highlight style).
// HOW:  "Stavi Dark" is the default (One Dark base + Stavi accent overrides).
//       The rest come from `thememirror` (tiny, ~1-2KB each, bundled into
//       bundle.js — no native app size cost). index.ts swaps them via a
//       Compartment when the bridge receives setTheme.
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx

import { EditorView } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import type { Extension } from '@codemirror/state';
import {
  dracula,
  tomorrow,
  cobalt,
  solarizedLight,
  ayuLight,
  rosePineDawn,
  espresso,
  coolGlow,
  amy,
  barf,
  bespin,
  birdsOfParadise,
  boysAndGirls,
  clouds,
  noctisLilac,
  smoothy,
} from 'thememirror';

// Stavi's house dark theme — One Dark tuned to the app's accent + bg.
const staviDark: Extension = [
  oneDark,
  EditorView.theme({
    '&': { backgroundColor: '#161616', color: '#c0c0c0', height: '100%' },
    '.cm-content': {
      fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", "Menlo", "Monaco", monospace',
      fontSize: '13px',
      lineHeight: '1.6',
      caretColor: '#5fccb0',
    },
    '.cm-gutters': { backgroundColor: '#1a1a1a', color: '#666666', border: 'none', borderRight: '1px solid #2a2a2a' },
    '.cm-activeLineGutter': { backgroundColor: '#212121' },
    '.cm-activeLine': { backgroundColor: 'rgba(95, 204, 176, 0.04)' },
    '.cm-selectionBackground, ::selection': { backgroundColor: 'rgba(95, 204, 176, 0.20) !important' },
    '.cm-cursor': { borderLeftColor: '#5fccb0', borderLeftWidth: '2px' },
    '.cm-searchMatch': { backgroundColor: 'rgba(251, 191, 36, 0.25)', outline: '1px solid rgba(251, 191, 36, 0.4)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(251, 191, 36, 0.45)' },
  }),
];

// Shared monospace sizing so every theme matches the app's editor metrics.
const baseMetrics = EditorView.theme({
  '&': { height: '100%' },
  '.cm-content': {
    fontFamily: '"Fira Code", "JetBrains Mono", "Cascadia Code", "Menlo", "Monaco", monospace',
    fontSize: '13px',
    lineHeight: '1.6',
  },
});

export interface ThemeEntry {
  id: string;
  label: string;
  /** true for light backgrounds — lets the WebView pick a matching page bg. */
  light: boolean;
  extension: Extension;
}

// Order here is the order shown in the picker.
export const THEMES: ThemeEntry[] = [
  { id: 'stavi-dark', label: 'Stavi Dark', light: false, extension: staviDark },
  { id: 'dracula', label: 'Dracula', light: false, extension: [dracula, baseMetrics] },
  { id: 'tomorrow', label: 'Tomorrow', light: false, extension: [tomorrow, baseMetrics] },
  { id: 'cobalt', label: 'Cobalt', light: false, extension: [cobalt, baseMetrics] },
  { id: 'cool-glow', label: 'Cool Glow', light: false, extension: [coolGlow, baseMetrics] },
  { id: 'espresso', label: 'Espresso', light: false, extension: [espresso, baseMetrics] },
  { id: 'amy', label: 'Amy', light: false, extension: [amy, baseMetrics] },
  { id: 'barf', label: 'Barf', light: false, extension: [barf, baseMetrics] },
  { id: 'bespin', label: 'Bespin', light: false, extension: [bespin, baseMetrics] },
  { id: 'birds-of-paradise', label: 'Birds of Paradise', light: false, extension: [birdsOfParadise, baseMetrics] },
  { id: 'boys-and-girls', label: 'Boys and Girls', light: false, extension: [boysAndGirls, baseMetrics] },
  { id: 'github-light', label: 'Light (Ayu)', light: true, extension: [ayuLight, baseMetrics] },
  { id: 'solarized-light', label: 'Solarized Light', light: true, extension: [solarizedLight, baseMetrics] },
  { id: 'rose-pine-dawn', label: 'Rosé Pine Dawn', light: true, extension: [rosePineDawn, baseMetrics] },
  { id: 'clouds', label: 'Clouds', light: true, extension: [clouds, baseMetrics] },
  { id: 'noctis-lilac', label: 'Noctis Lilac', light: true, extension: [noctisLilac, baseMetrics] },
  { id: 'smoothy', label: 'Smoothy', light: true, extension: [smoothy, baseMetrics] },
];

export const DEFAULT_THEME_ID = 'stavi-dark';

export function themeById(id: string | undefined): ThemeEntry {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

// Back-compat: index.ts imported `staviTheme` as the initial theme.
export const staviTheme = staviDark;
