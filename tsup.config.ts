import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'react/index': 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // dist/styles.css = scoped tokens (scripts/sync-tokens.mjs) + fonts + base + the folder view's rules
  // (scripts/sync-web-css.mjs, from Shelf web) + SDK extras. The font files sit beside it in dist/fonts.
  onSuccess: async () => {
    mkdirSync('dist/fonts', { recursive: true });
    const css = ['styles', 'fonts', 'base', 'view', 'extras'].map((f) => readFileSync(`src/styles/${f}.css`, 'utf8')).join('\n');
    writeFileSync('dist/styles.css', css);
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
