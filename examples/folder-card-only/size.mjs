// Measures examples/folder-card-only/App.tsx (and imports.ts, the SDK share the ceiling gates on) the way a consumer's bundler would ship it: esbuild, minified, tree-shaken,
// react / react-dom external (peers), dynamic import() chunks left out (they load on demand, not initially).
// Prints min+gzip, fails above the ceiling, and fails if the bundle's metafile contains the document page, the virtual
// list, the document-site renderer or the outbox. Run `npm run build` in the repo root first.
// Usage: node examples/folder-card-only/size.mjs
import { build } from 'esbuild';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const CEILING_KB = 10.5;
const FORBIDDEN = ['DocumentPage', 'virtual', 'docsite', 'outbox'];

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../../dist');
for (const f of ['react/folder-card/index.js', 'react/hooks/index.js']) {
  if (!existsSync(join(dist, f))) {
    console.error(`missing dist/${f}; run npm run build first`);
    process.exit(1);
  }
}

const metafile = resolve(here, '../../.build/metafile-esm.json');
if (!existsSync(metafile)) {
  console.error('missing .build/metafile-esm.json; run npm run build first');
  process.exit(1);
}
const tsup = JSON.parse(readFileSync(metafile, 'utf8')).outputs;

async function measure(file) {
  const lazy = new Set();
  
  const out = await build({
    entryPoints: [join(here, file)],
    bundle: true,
    minify: true,
    treeShaking: true,
    write: false,
    metafile: true,
    outdir: join(here, '.out'),
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    // the package's own subpaths, resolved to the build (what node_modules would give a consumer)
    alias: {
      '@pj-slf-998231/sdk/react/folder-card': join(dist, 'react/folder-card/index.js'),
      '@pj-slf-998231/sdk/react/hooks': join(dist, 'react/hooks/index.js'),
    },
    loader: { '.css': 'empty' },
    logLevel: 'silent',
    plugins: [
      {
        name: 'lazy-edges',
        setup(b) {
          b.onResolve({ filter: /^[./]/ }, (a) => {
            if (a.kind !== 'dynamic-import') return undefined;
            lazy.add(resolve(a.resolveDir, a.path));
            return { path: a.path, external: true };
          });
        },
      },
    ],
  });
  const js = out.outputFiles.find((f) => f.path.endsWith('.js'));
  // dist files that contribute bytes to the bundle, then the src files that contribute bytes to those (tsup's metafile)
  const [output] = Object.values(out.metafile.outputs);
  const inputs = Object.entries(output.inputs).filter(([f, i]) => !f.startsWith('<') && f.includes('dist/') && i.bytesInOutput > 0).map(([f]) => f);
  const sources = new Set();
  for (const f of inputs) {
    const o = tsup[f.slice(f.indexOf('dist/'))];
    if (!o) throw new Error(`${f} is not in ${metafile}; run npm run build first`);
    for (const [src, i] of Object.entries(o.inputs)) if (i.bytesInOutput > 0) sources.add(src);
  }
  return { bytes: gzipSync(js.contents, { level: 9 }).length, inputs, sources: sources.size, lazy: lazy.size, hits: [...sources].filter((f) => FORBIDDEN.some((w) => f.includes(w))) };
}

let failed = false;
const gate = await measure('imports.ts');
const app = await measure('App.tsx');
console.log(`examples/folder-card-only imports.ts (FolderCard + useFolders): ${(gate.bytes / 1000).toFixed(2)} kB min+gzip (${gate.bytes} B) / ceiling ${CEILING_KB} kB`);
console.log(`examples/folder-card-only App.tsx (the page, its own code included): ${(app.bytes / 1000).toFixed(2)} kB min+gzip (${app.bytes} B), informational`);
console.log(`  dist files bundled: ${gate.inputs.length} (${gate.sources} src files); lazy chunks left out: ${gate.lazy}`);
if (gate.bytes > CEILING_KB * 1000) {
  console.error(`FAIL over the ceiling of ${CEILING_KB} kB`);
  failed = true;
}
for (const [name, r] of [['imports.ts', gate], ['App.tsx', app]]) {
  if (r.hits.length) {
    console.error(`FAIL the ${name} bundle contains ${FORBIDDEN.join(' / ')}: ${r.hits.join(', ')}`);
    failed = true;
  } else console.log(`  ${name} bundle (dist files and the src files behind them) contains none of ${FORBIDDEN.join(', ')}`);
}
process.exit(failed ? 1 : 0);
