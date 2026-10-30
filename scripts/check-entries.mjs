// Post-build guard for the multi-entry package (scripts/entries.mjs is the source of truth):
//  1. package.json "exports" and "sideEffects" match entries.mjs exactly, every file they name exists;
//  2. every subpath loads as ESM (import) and as CJS (require) through the package's own name (self-reference), and both
//     formats export the same names;
//  3. exactly EXPECTED_CONTEXTS createContext( call per output format in dist: a context duplicated across entry bundles
//     would make a ShelfProvider invisible to a hook imported from another entry;
//  4. "use client" starts every dist/react/**/index.{js,cjs} and no other file ('.' and the shared chunks never have it);
//  5. the packed tarball holds no metafile or build scratch.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { EXPECTED_CONTEXTS, PACKAGE, entries, sideEffects, staticExports } from './entries.mjs';

const problems = [];
const fail = (m) => problems.push(m);
const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

// 1. exports map
const expected = {};
for (const e of entries) {
  expected[e.subpath] = {
    import: { types: `./dist/${e.out}.d.ts`, default: `./dist/${e.out}.js` },
    require: { types: `./dist/${e.out}.d.cts`, default: `./dist/${e.out}.cjs` },
  };
}
Object.assign(expected, staticExports);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const keys = (o) => Object.keys(o).sort();
if (!same(keys(pkg.exports), keys(expected))) fail(`exports keys differ from entries.mjs.\n  package.json: ${keys(pkg.exports).join(' ')}\n  entries.mjs:  ${keys(expected).join(' ')}`);
for (const [k, v] of Object.entries(expected)) if (pkg.exports[k] && !same(pkg.exports[k], v)) fail(`exports["${k}"] differs from entries.mjs: ${JSON.stringify(pkg.exports[k])}`);
if (!same(pkg.sideEffects, sideEffects)) fail(`sideEffects is ${JSON.stringify(pkg.sideEffects)}, expected ${JSON.stringify(sideEffects)}`);
const mainEntry = entries.find((e) => e.subpath === '.');
if (pkg.main !== `./dist/${mainEntry.out}.cjs` || pkg.module !== `./dist/${mainEntry.out}.js` || pkg.types !== `./dist/${mainEntry.out}.d.ts`) fail('main/module/types do not point at the "." entry');
for (const e of entries) for (const f of [`${e.out}.js`, `${e.out}.cjs`, `${e.out}.d.ts`, `${e.out}.d.cts`]) if (!existsSync(join('dist', f))) fail(`missing dist/${f}`);
for (const f of ['dist/styles.css']) if (!existsSync(f)) fail(`missing ${f}`);

// 2. every subpath loads in both module systems
const require = createRequire(import.meta.url);
for (const e of entries) {
  const spec = e.subpath === '.' ? PACKAGE : `${PACKAGE}/${e.subpath.slice(2)}`;
  try {
    const esm = Object.keys(await import(spec)).filter((k) => k !== 'default').sort();
    const cjs = Object.keys(require(spec)).filter((k) => k !== 'default' && k !== '__esModule').sort();
    if (esm.length === 0) fail(`${spec}: no exports`);
    if (!same(esm, cjs)) fail(`${spec}: ESM exports [${esm}] differ from CJS exports [${cjs}]`);
  } catch (err) {
    fail(`${spec}: failed to load: ${err instanceof Error ? err.message : err}`);
  }
}

// 3 and 4. contexts and "use client"
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = join(dir, d.name);
    return d.isDirectory() ? (d.name === 'fonts' ? [] : walk(p)) : /\.(js|cjs)$/.test(d.name) ? [p] : [];
  });
const files = walk('dist');
for (const [format, re] of [['esm', /\.js$/], ['cjs', /\.cjs$/]]) {
  let n = 0;
  for (const f of files.filter((x) => re.test(x))) n += (readFileSync(f, 'utf8').match(/\bcreateContext(?:\.call)?\(/g) ?? []).length;
  if (n !== EXPECTED_CONTEXTS) fail(`${format}: ${n} createContext( calls in dist, expected exactly ${EXPECTED_CONTEXTS}`);
}
const clientEntries = new Set(entries.filter((e) => e.client).flatMap((e) => [`dist/${e.out}.js`, `dist/${e.out}.cjs`]));
for (const f of files) {
  const has = /^["']use client["']/.test(readFileSync(f, 'utf8'));
  if (clientEntries.has(f) && !has) fail(`${f} is a react entry and must start with "use client"`);
  if (!clientEntries.has(f) && has) fail(`${f} must not have "use client" (only react entry files do)`);
}

// 5. the tarball
try {
  const [pack] = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const names = pack.files.map((f) => f.path);
  const bad = names.filter((n) => /metafile|^\.build|\.map$/.test(n));
  if (bad.length) fail(`npm pack would include build scratch: ${bad.join(', ')}`);
  for (const e of entries) if (!names.includes(`dist/${e.out}.js`)) fail(`npm pack misses dist/${e.out}.js`);
  console.log(`check-entries: tarball holds ${names.length} files, no metafile`);
} catch (err) {
  fail(`npm pack --dry-run failed: ${err instanceof Error ? err.message : err}`);
}

if (problems.length) {
  for (const p of problems) console.error('check-entries: ' + p);
  process.exit(1);
}
console.log(`check-entries: ok (${entries.length} entries load as ESM and CJS, exports map matches entries.mjs, ${EXPECTED_CONTEXTS} createContext per format, "use client" on react entries only)`);
