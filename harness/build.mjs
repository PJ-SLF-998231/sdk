import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
mkdirSync(new URL('./out', import.meta.url), { recursive: true });
await build({
  entryPoints: [new URL('./main.tsx', import.meta.url).pathname],
  outfile: new URL('./out/main.js', import.meta.url).pathname,
  bundle: true, format: 'esm', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [new URL('../node_modules', import.meta.url).pathname],
});
