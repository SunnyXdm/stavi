// WHAT: Extension-to-language-ID mapping for the Editor plugin.
// WHY:  Passed to the WebView loadFile message so CodeMirror can pick the
//       right language pack. Detection is by extension only (no content sniffing).
// HOW:  Returns a string matching a CodeMirror language specifier, or null for
//       unknown extensions. Mirrors apps/mobile/assets/editor/src/languages.ts.
// SEE:  apps/mobile/src/plugins/workspace/editor/components/EditorSurface.tsx

/**
 * Detect the CodeMirror language specifier for a given file path.
 * Returns null for unknown/binary extensions.
 */
export function detectLanguage(path: string): string | null {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  switch (ext) {
    case 'js': case 'mjs': case 'cjs': return 'javascript';
    case 'jsx': return 'jsx';
    case 'ts': case 'mts': case 'cts': return 'typescript';
    case 'tsx': return 'tsx';
    case 'py': case 'pyi': return 'python';
    case 'rs': return 'rust';
    case 'json': case 'jsonc': return 'json';
    case 'yaml': case 'yml': return 'yaml';
    case 'html': case 'htm': return 'html';
    case 'css': case 'scss': case 'less': return 'css';
    case 'md': case 'mdx': case 'markdown': return 'markdown';
    case 'java': return 'java';
    case 'go': return 'go';
    case 'swift': return 'swift';
    case 'kt': case 'kts': return 'kotlin';
    case 'sh': case 'bash': case 'zsh': return 'shell';
    case 'toml': return 'toml';
    default: return null;
  }
}

/** Binary file extensions — EditorSurface renders a card instead of the WebView. */
const BINARY_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'tiff', 'svg',
  'pdf', 'zip', 'tar', 'gz', 'bz2', 'xz', '7z', 'rar',
  'exe', 'dll', 'so', 'dylib', 'bin',
  'mp3', 'mp4', 'wav', 'ogg', 'flac', 'aac',
  'woff', 'woff2', 'ttf', 'otf', 'eot',
  'db', 'sqlite', 'sqlite3',
  'class', 'jar', 'pyc', 'pyo',
]);

export function isBinary(path: string): boolean {
  const ext = (path.split('.').pop() ?? '').toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}
