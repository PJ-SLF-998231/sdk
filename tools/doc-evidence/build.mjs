// Bundles the evidence page against dist/ (run `npm run build` first). Dev tooling only; not published.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const here = fileURLToPath(new URL('.', import.meta.url));
mkdirSync(`${here}out`, { recursive: true });
await build({
  entryPoints: [`${here}main.tsx`],
  bundle: true, format: 'esm', splitting: true, outdir: `${here}out`,
  jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  nodePaths: [`${here}../../node_modules`],
}).catch(() => process.exit(1));
