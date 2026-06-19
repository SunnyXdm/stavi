// WHAT: Lightweight syntax highlighting for AI chat code blocks.
// WHY:  Code fences rendered as flat single-color Text. Neither lunel nor
//       t3code mobile highlight chat code; this is pure-JS (lowlight =
//       highlight.js core → hast tree), no WebView, Hermes-safe.
// HOW:  Tokenize once per content change (memoized by the caller), flatten the
//       hast tree to {text, scope} spans, map scopes to theme colors. Blocks
//       over 20KB skip highlighting (perf guard for giant pastes).
// SEE:  apps/mobile/src/plugins/workspace/ai/Markdown.tsx (CodeBlock)

import { createLowlight } from 'lowlight';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import bash from 'highlight.js/lib/languages/bash';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import diff from 'highlight.js/lib/languages/diff';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import swift from 'highlight.js/lib/languages/swift';
import kotlin from 'highlight.js/lib/languages/kotlin';
import java from 'highlight.js/lib/languages/java';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import ruby from 'highlight.js/lib/languages/ruby';
import php from 'highlight.js/lib/languages/php';
import graphql from 'highlight.js/lib/languages/graphql';
import toml from 'highlight.js/lib/languages/ini';
import type { Colors } from '../../../../theme';

const low = createLowlight();
low.register({
  typescript, javascript, json, bash, python, rust, go, css, xml, diff,
  sql, yaml, swift, kotlin, java, c, cpp, dockerfile, ruby, php, graphql,
  toml,
});

const ALIAS: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  html: 'xml',
  svg: 'xml',
  py: 'python',
  rs: 'rust',
  golang: 'go',
  patch: 'diff',
  jsonc: 'json',
  yml: 'yaml',
  kt: 'kotlin',
  kts: 'kotlin',
  rb: 'ruby',
  dockerfile: 'dockerfile',
  docker: 'dockerfile',
  gql: 'graphql',
  toml: 'toml',
  ini: 'toml',
  conf: 'toml',
};

export interface HighlightSpan {
  text: string;
  scope?: string;
}

/** Tokenize `code` for `lang`. Returns null when the language is unknown or
 *  the block is too large — caller falls back to plain text. */
export function highlightSpans(code: string, lang?: string): HighlightSpan[] | null {
  const resolved = lang ? (ALIAS[lang.toLowerCase()] ?? lang.toLowerCase()) : undefined;
  if (!resolved || !low.registered(resolved) || code.length > 20_000) return null;
  try {
    const tree = low.highlight(resolved, code);
    const out: HighlightSpan[] = [];
    const walk = (node: any, scope?: string) => {
      if (node.type === 'text') {
        out.push({ text: node.value, scope });
        return;
      }
      if (node.type === 'element') {
        const cls: string[] = node.properties?.className ?? [];
        const s = cls.length
          ? cls.map((c) => c.replace(/^hljs-/, '').replace(/_$/, '')).join('.')
          : scope;
        for (const child of node.children ?? []) walk(child, s);
        return;
      }
      for (const child of node.children ?? []) walk(child, scope);
    };
    walk(tree);
    return out;
  } catch {
    return null;
  }
}

/** Map an hljs scope to a theme color; undefined = inherit the base style. */
export function scopeColor(scope: string, colors: Colors): string | undefined {
  // Match on the leading scope token (e.g. "title.function" → title.function).
  if (scope.startsWith('comment') || scope.startsWith('quote')) return colors.fg.muted;
  if (scope.startsWith('keyword') || scope.startsWith('literal') || scope.startsWith('built_in')) {
    return colors.terminal.magenta;
  }
  if (scope.startsWith('string') || scope.startsWith('regexp')) return colors.terminal.green;
  if (scope.startsWith('number')) return colors.terminal.yellow;
  if (scope.startsWith('title.function') || scope.startsWith('function')) return colors.terminal.blue;
  if (scope.startsWith('title.class') || scope.startsWith('type') || scope.startsWith('title')) {
    return colors.terminal.cyan;
  }
  if (scope.startsWith('attr') || scope.startsWith('property') || scope.startsWith('variable') || scope.startsWith('params')) {
    return colors.terminal.brightBlue;
  }
  if (scope.startsWith('tag') || scope.startsWith('name') || scope.startsWith('selector')) {
    return colors.terminal.red;
  }
  if (scope.startsWith('addition')) return colors.semantic.success;
  if (scope.startsWith('deletion')) return colors.semantic.error;
  if (scope.startsWith('meta') || scope.startsWith('doctag') || scope.startsWith('operator') || scope.startsWith('punctuation') || scope.startsWith('symbol')) {
    return colors.fg.tertiary;
  }
  return undefined;
}
