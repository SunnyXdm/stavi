// WHAT: esbuild config for the CodeMirror 6 editor bundle.
// WHY:  Produces a single self-contained bundle.js loaded by index.html in the
//       React Native WebView. Kept separate from the mobile app build.
// HOW:  Bundles src/index.ts and all @codemirror/* deps into one IIFE file.
//       Run: node build.mjs  (or npm run build from this directory)

import * as esbuild from 'esbuild';
import { argv } from 'process';

const watch = argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/index.ts'],
  bundle: true,
  minify: true,
  format: 'iife',
  globalName: 'StaviEditor',
  outfile: 'bundle.js',
  target: ['chrome90', 'safari14'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('[stavi-editor] watching...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  console.log('[stavi-editor] bundle.js written');
}
