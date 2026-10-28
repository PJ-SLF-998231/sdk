import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { index: 'src/index.ts', 'react/index': 'src/react/index.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  external: ['react', 'react-dom'],
});
