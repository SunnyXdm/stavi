// WHAT: Language pack registry for CodeMirror 6 — maps file extensions to language support.
// WHY:  Provides syntax highlighting for common languages. Detection by extension only
//       (no content sniffing per Phase 4b spec).
// HOW:  Returns a LanguageSupport instance (or null for unknown extensions) given a
//       file path. The StreamLanguage fallback covers less common formats.
// SEE:  apps/mobile/src/plugins/workspace/editor/language-map.ts (mobile-side mirror)

import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { java } from '@codemirror/lang-java';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage } from '@codemirror/language';
import { kotlin } from '@codemirror/legacy-modes/mode/clike';
import { go } from '@codemirror/legacy-modes/mode/go';
import { swift } from '@codemirror/legacy-modes/mode/swift';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import type { Extension } from '@codemirror/state';

function ext(path: string): string {
  return (path.split('.').pop() ?? '').toLowerCase();
}

export function getLanguage(path: string): Extension | null {
  const e = ext(path);
  switch (e) {
    // JavaScript family
    case 'js':
    case 'mjs':
    case 'cjs':
      return javascript();
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'mts':
    case 'cts':
      return javascript({ typescript: true });
    case 'tsx':
      return javascript({ jsx: true, typescript: true });

    // Python
    case 'py':
    case 'pyi':
      return python();

    // Rust
    case 'rs':
      return rust();

    // Data formats
    case 'json':
    case 'jsonc':
      return json();
    case 'yaml':
    case 'yml':
      return yaml();

    // Web
    case 'html':
    case 'htm':
    case 'svg':
      return html();
    case 'css':
    case 'scss':
    case 'less':
      return css();

    // Markdown
    case 'md':
    case 'mdx':
    case 'markdown':
      return markdown();

    // JVM
    case 'java':
      return java();

    // Go (legacy-modes)
    case 'go':
      return StreamLanguage.define(go);

    // Swift (legacy-modes)
    case 'swift':
      return StreamLanguage.define(swift);

    // Kotlin (legacy-modes)
    case 'kt':
    case 'kts':
      return StreamLanguage.define(kotlin);

    // Shell
    case 'sh':
    case 'bash':
    case 'zsh':
      return StreamLanguage.define(shell);

    // TOML
    case 'toml':
      return StreamLanguage.define(toml);

    // Unknown — no language pack
    default:
      return null;
  }
}
