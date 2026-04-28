// WHAT: Pure text-transform functions for the Tools plugin.
// WHY:  Separating logic from UI makes each piece testable in isolation and keeps
//       ToolsPanel focused on rendering/state.
// HOW:  Each Transform has a synchronous or async execute fn. No React, no side effects.
//       Errors thrown by execute are caught in ToolsPanel and shown as error state.
// SEE:  ToolsPanel.tsx

export interface Transform {
  id: string;
  name: string;
  category: 'format' | 'encode' | 'string';
  execute: (input: string) => string | Promise<string>;
}

export const TRANSFORMS: Transform[] = [
  // ---- Format ----
  {
    id: 'json-format',
    name: 'JSON Format',
    category: 'format',
    execute: (s) => JSON.stringify(JSON.parse(s), null, 2),
  },
  {
    id: 'json-minify',
    name: 'JSON Minify',
    category: 'format',
    execute: (s) => JSON.stringify(JSON.parse(s)),
  },

  // ---- Encode ----
  {
    id: 'base64-encode',
    name: 'Base64 Encode',
    category: 'encode',
    execute: (s) => btoa(unescape(encodeURIComponent(s))),
  },
  {
    id: 'base64-decode',
    name: 'Base64 Decode',
    category: 'encode',
    execute: (s) => decodeURIComponent(escape(atob(s))),
  },
  {
    id: 'url-encode',
    name: 'URL Encode',
    category: 'encode',
    execute: (s) => encodeURIComponent(s),
  },
  {
    id: 'url-decode',
    name: 'URL Decode',
    category: 'encode',
    execute: (s) => decodeURIComponent(s),
  },

  // ---- String ----
  {
    id: 'lowercase',
    name: 'Lowercase',
    category: 'string',
    execute: (s) => s.toLowerCase(),
  },
  {
    id: 'uppercase',
    name: 'Uppercase',
    category: 'string',
    execute: (s) => s.toUpperCase(),
  },
  {
    id: 'reverse',
    name: 'Reverse',
    category: 'string',
    execute: (s) => [...s].reverse().join(''),
  },
  {
    id: 'trim',
    name: 'Trim',
    category: 'string',
    execute: (s) => s.trim(),
  },
  {
    id: 'char-count',
    name: 'Char Count',
    category: 'string',
    execute: (s) =>
      `Characters: ${s.length}\nWords: ${s.trim() ? s.trim().split(/\s+/).length : 0}\nLines: ${s.split('\n').length}`,
  },
];

export const CATEGORIES = ['format', 'encode', 'string'] as const;
export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_LABELS: Record<Category, string> = {
  format: 'Format',
  encode: 'Encode',
  string: 'String',
};
