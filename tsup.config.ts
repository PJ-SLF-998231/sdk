import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'tsup';
import { entries } from './scripts/entries.mjs';
import { splitCss } from './scripts/split-css.mjs';

// The entry files of the React subpaths: index.js and index.cjs at any depth under dist/react (never '.' and never a shared chunk).
function reactEntryFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? reactEntryFiles(p) : /^index\.(js|cjs)$/.test(e.name) ? [p] : [];
  });
}

export default defineConfig({
  // The entry list lives in scripts/entries.mjs (single source of truth, also read by the checks).
  entry: Object.fromEntries(entries.map((e) => [e.out, e.module])),
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true, // ESM only: shared chunks keep lazy code (cache, outbox, virtual list) out of the client entry
  clean: true,
  sourcemap: false,
  // Module graph for scripts/check-imports.mjs. tsup writes dist/metafile-*.json; onSuccess moves them out of dist so they are never packed.
  metafile: true,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // dist/css/*.css: see scripts/split-css.mjs.
  // dist/styles.css = scoped tokens (scripts/sync-tokens.mjs) + fonts + base + the folder view's rules
  // (scripts/sync-web-css.mjs, from Shelf web) + SDK extras. The font files sit beside it in dist/fonts.
  onSuccess: async () => {
    mkdirSync('.build', { recursive: true });
    for (const f of readdirSync('dist').filter((n) => /^metafile-.*\.json$/.test(n))) renameSync(join('dist', f), join('.build', f));
    // React entries are client components: a Server Components bundler needs the directive on the file it resolves to.
    for (const f of reactEntryFiles('dist/react')) {
      const code = readFileSync(f, 'utf8');
      if (!code.startsWith('"use client"')) writeFileSync(f, `"use client";\n${code}`);
    }
    mkdirSync('dist/fonts', { recursive: true });
    const css = ['styles', 'fonts', 'base', 'view', 'extras'].map((f) => readFileSync(`src/styles/${f}.css`, 'utf8')).join('\n');
    writeFileSync('dist/styles.css', css);
    // dist/css/core.css + one stylesheet per entry (scripts/split-css.mjs). Unknown classes fail the build here.
    const split = splitCss({ entries, metafile: JSON.parse(readFileSync('.build/metafile-esm.json', 'utf8')) });
    mkdirSync('dist/css', { recursive: true });
    for (const [f, text] of Object.entries(split.files)) writeFileSync(join('dist', f), text);
    const fontFiles: Array<[string, string]> = [
      ['@fontsource-variable/geist/files/geist-latin-wght-normal.woff2', 'geist-latin-wght-normal.woff2'],
      ['@fontsource-variable/geist-mono/files/geist-mono-latin-wght-normal.woff2', 'geist-mono-latin-wght-normal.woff2'],
      ['@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2', 'instrument-serif-latin-400-normal.woff2'],
      ['@fontsource/instrument-serif/files/instrument-serif-latin-400-italic.woff2', 'instrument-serif-latin-400-italic.woff2'],
      ['@fontsource-variable/geist/LICENSE', 'Geist-LICENSE.txt'],
      ['@fontsource-variable/geist-mono/LICENSE', 'Geist-Mono-LICENSE.txt'],
      ['@fontsource/instrument-serif/LICENSE', 'Instrument-Serif-LICENSE.txt'],
    ];
    for (const [from, to] of fontFiles) copyFileSync(`node_modules/${from}`, `dist/fonts/${to}`);
  },
});
