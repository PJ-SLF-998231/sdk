// Split-aware size budget. For each ESM entry it gzips the entry plus the chunks it imports STATICALLY
// (dynamic import() chunks load on demand, so they are not initial load) and checks the budget; the lazy
// chunks (everything reachable only through import()) get one combined budget.
// react, react-dom and react/jsx-runtime stay external (peer dependencies); @tanstack/react-virtual is counted
// because dist leaves it as a bare import that every consumer's bundler pulls in.
// Usage: node scripts/size-budget.mjs [--dist <dir>] [--budget <file>] [--json]
import { build } from 'esbuild';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dist = resolve(opt('--dist', 'dist'));
const budgetFile = resolve(opt('--budget', 'scripts/size-budget.json'));
const asJson = args.includes('--json');

const STATIC = /(?:^|[^.\w$])(?:import|export)\s*(?:[^'"();]*?\sfrom\s*)?["'](\.[^"']+)["']/g;
const DYNAMIC = /\bimport\(\s*["'](\.[^"']+)["']\s*\)/g;

const specs = (code, re) => [...code.matchAll(re)].map((m) => m[1]);
const read = (f) => readFileSync(f, 'utf8');

/** Files reachable from `entry` through static imports only. */
function staticClosure(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  const code = read(entry);
  const dyn = new Set(specs(code, DYNAMIC));
  for (const s of specs(code.replace(DYNAMIC, ''), STATIC)) {
    if (dyn.has(s) && !new RegExp(`from\\s*["']${s.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}["']`).test(code)) continue;
    staticClosure(resolve(dirname(entry), s), seen);
  }
  return seen;
}

function dynamicTargets(files) {
  const out = new Set();
  for (const f of files) for (const s of specs(read(f), DYNAMIC)) out.add(resolve(dirname(f), s));
  return out;
}

// Bundles `files` as a consumer's bundler would: third-party imports (@tanstack/react-virtual) are pulled in,
// peers stay external, and files outside `files` (the lazy chunks) are not followed.
async function gzipOf(files) {
  const set = new Set(files);
  const out = await build({
    stdin: { contents: [...set].sort().map((f) => `export * from ${JSON.stringify(f)};`).join('\n'), resolveDir: dist, loader: 'js' },
    bundle: true,
    minify: true,
    write: false,
    format: 'esm',
    platform: 'browser',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'no-follow-outside-set',
        setup(b) {
          b.onResolve({ filter: /^\./ }, (a) => {
            const p = resolve(a.resolveDir, a.path);
            return set.has(p) || a.kind === 'entry-point' ? undefined : { path: p, external: true };
          });
        },
      },
    ],
  });
  return gzipSync(out.outputFiles[0].contents, { level: 9 }).length;
}

const budget = JSON.parse(read(budgetFile));
const entries = { client: 'index.js', react: 'react/index.js' };
const results = [];
const initialAll = new Set();
const lazyRoots = new Set();

for (const [name, file] of Object.entries(entries)) {
  const entry = resolve(dist, file);
  if (!existsSync(entry)) throw new Error(`missing ${entry}; run npm run build first`);
  const closure = staticClosure(entry);
  closure.forEach((f) => initialAll.add(f));
  dynamicTargets(closure).forEach((f) => lazyRoots.add(f));
  results.push({ name: `${name} initial`, bytes: await gzipOf(closure), limit: budget[name].initialKb, files: closure.size });
}

// Lazy chunks: reachable via import(), including their own static deps, minus anything already in an initial load.
const lazyFiles = new Set();
for (const root of lazyRoots) staticClosure(root).forEach((f) => { if (!initialAll.has(f)) lazyFiles.add(f); });
const perChunk = [];
for (const f of [...lazyRoots].sort()) perChunk.push({ chunk: f.slice(dist.length + 1), bytes: await gzipOf([f]) });
results.push({ name: 'lazy chunks total', bytes: await gzipOf(lazyFiles), limit: budget.lazy.totalKb, files: lazyFiles.size });

let failed = false;
const rows = results.map((r) => {
  const ok = r.bytes <= r.limit * 1000;
  if (!ok) failed = true;
  return { ...r, ok };
});
if (asJson) console.log(JSON.stringify({ rows, perChunk }, null, 2));
else {
  for (const r of rows) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${(r.bytes / 1000).toFixed(2)} kB gzip (${r.bytes} B, ${r.files} files) / budget ${r.limit} kB`);
  for (const c of perChunk) console.log(`     lazy ${c.chunk}: ${c.bytes} B gzip`);
}
process.exit(failed ? 1 : 0);
