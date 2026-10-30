// Per-scenario size budget (0.4). Scenarios and ceilings come from scripts/entries.mjs.
//
// A scenario is "what a consumer's bundler ships for `import {names} from '<subpath>'`": the built ESM entry is bundled with
// esbuild (tree-shaking on, minified), react / react-dom / react/jsx-runtime external (peers), third-party code such as
// @tanstack/react-virtual counted (dist leaves it as a bare import), and every dynamic import() left out: those chunks
// load on demand, so they are not initial load. gzip level 9.
//
// Lazy chunks are counted at EVERY depth: each import() target, the chunks it imports statically, and the import()s of those
// in turn (DocumentPage -> DocumentContent -> docsite), minus anything already in some entry's initial load. They get one
// combined budget (entries.mjs `lazy.totalKb`); a scenario may also cap the lazy chunks it can reach (`lazyKb`).
// Usage: node scripts/size-budget.mjs [--dist <dir>] [--json]
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { combos, entries, lazy } from './entries.mjs';

const args = process.argv.slice(2);
const opt = (n, d) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const dist = resolve(opt('--dist', 'dist'));
const asJson = args.includes('--json');

const distFile = (e) => resolve(dist, `${e.out}.js`);
const isFile = (p) => p.startsWith('.') || p.startsWith('/');

/**
 * Bundles `source` (JS text importing from dist files). `exclude`: absolute files that are not followed (already counted).
 * Returns the gzip size, every dist file that went into the bundle, and the import() targets met on the way.
 */
async function bundle(source, exclude = new Set()) {
  const dynamic = new Set();
  const out = await build({
    stdin: { contents: source, resolveDir: dist, loader: 'js' },
    bundle: true,
    minify: true,
    treeShaking: true,
    write: false,
    metafile: true,
    format: 'esm',
    platform: 'browser',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
    plugins: [
      {
        name: 'lazy-edges',
        setup(b) {
          b.onResolve({ filter: /^[./]/ }, (a) => {
            if (a.kind === 'entry-point') return undefined;
            const path = resolve(a.resolveDir, a.path);
            if (a.kind === 'dynamic-import') {
              dynamic.add(path);
              return { path: a.path, external: true };
            }
            return exclude.has(path) ? { path: a.path, external: true } : undefined;
          });
        },
      },
    ],
  });
  const files = new Set(Object.keys(out.metafile.inputs).filter((f) => !f.startsWith('<')).map((f) => resolve(f)).filter((f) => f.startsWith(dist)));
  return { bytes: gzipSync(out.outputFiles[0].contents, { level: 9 }).length, files, dynamic };
}

const importLine = (file, names) => (names === '*' ? `export * as ns from ${JSON.stringify(file)};` : `export { ${names.join(', ')} } from ${JSON.stringify(file)};`);
const entryOf = (subpath) => {
  const e = entries.find((x) => x.subpath === subpath);
  if (!e) throw new Error(`unknown entry ${subpath}`);
  if (!existsSync(distFile(e))) throw new Error(`missing ${distFile(e)}; run npm run build first`);
  return e;
};

/** All lazy chunks reachable from `roots` (import() targets), at any depth, as a set of files. */
async function lazyClosure(roots, initial) {
  const seen = new Set();
  const queue = [...roots];
  const files = new Set();
  while (queue.length) {
    const root = queue.pop();
    if (seen.has(root) || initial.has(root)) continue;
    seen.add(root);
    const r = await bundle(importLine(root, '*'), initial);
    r.files.forEach((f) => !initial.has(f) && files.add(f));
    r.dynamic.forEach((d) => queue.push(d));
  }
  return { roots: [...seen], files };
}

const rows = [];
const perScenario = [];
let lazyBase = null; // the lazy-total entry's initial files and the import() targets it reaches

for (const e of entries) {
  entryOf(e.subpath);
  // Whole-entry closure (every export): what is "initial" for this entry, and where its lazy edges start.
  const whole = await bundle(importLine(distFile(e), '*'));
  if (e.subpath === lazy.entry) lazyBase = { initial: whole.files, roots: whole.dynamic };
  for (const s of e.scenarios) {
    const r = await bundle(importLine(distFile(e), s.imports));
    rows.push({ name: `${e.subpath} ${s.name} initial`, bytes: r.bytes, limit: s.initialKb });
    if (s.lazyKb !== undefined) perScenario.push({ name: `${e.subpath} ${s.name} lazy`, limit: s.lazyKb, roots: r.dynamic, initial: whole.files });
  }
}
for (const c of combos) {
  const src = c.imports.map((i) => importLine(distFile(entryOf(i.subpath)), i.names)).join('\n');
  const r = await bundle(src);
  rows.push({ name: c.name, bytes: r.bytes, limit: c.initialKb });
}

const lazyBytes = async (roots, initial) => {
  const closure = await lazyClosure(roots, initial);
  const src = closure.roots.sort().map((f, i) => `export * as c${i} from ${JSON.stringify(f)};`).join('\n');
  return { closure, bytes: src ? (await bundle(src, initial)).bytes : 0 };
};
const total = await lazyBytes(lazyBase.roots, lazyBase.initial);
rows.push({ name: `lazy chunks total, all depths (from ${lazy.entry})`, bytes: total.bytes, limit: lazy.totalKb });
for (const p of perScenario) rows.push({ name: p.name, bytes: (await lazyBytes(p.roots, p.initial)).bytes, limit: p.limit });

const perChunk = [];
for (const f of total.closure.roots.sort()) perChunk.push({ chunk: f.slice(dist.length + 1), bytes: (await bundle(importLine(f, '*'), lazyBase.initial)).bytes });

let failed = false;
const result = rows.map((r) => {
  const ok = r.bytes <= r.limit * 1000;
  if (!ok) failed = true;
  return { ...r, ok };
});
if (asJson) console.log(JSON.stringify({ rows: result, perChunk }, null, 2));
else {
  for (const r of result) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.name}: ${(r.bytes / 1000).toFixed(2)} kB gzip (${r.bytes} B) / budget ${r.limit} kB`);
  for (const c of perChunk) console.log(`     lazy ${c.chunk}: ${c.bytes} B gzip (own code, excluding initial)`);
}
process.exit(failed ? 1 : 0);
