import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'react/index': 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['react', 'react-dom', 'react/jsx-runtime'],
  // dist/styles.css = scoped tokens (scripts/sync-tokens.mjs output) + component styles.
  onSuccess: async () => {
    mkdirSync('dist', { recursive: true });
    const css = ['src/styles/styles.css', 'src/styles/components.css'].map((f) => readFileSync(f, 'utf8')).join('\n');
    writeFileSync('dist/styles.css', css);
  },
});
