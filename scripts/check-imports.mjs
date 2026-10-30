// Maps the tsup/esbuild metafile (.build/metafile-<format>.json, written by `npm run build`) back to src/ and enforces each
// entry's `banned` list from scripts/entries.mjs: no source file whose path contains a banned fragment may be part of the
// entry's STATIC import closure (its own output file plus the chunks it imports with import/require, transitively).
// Chunks reached only through import() are lazy and are not part of the closure. A file counts only when it contributes
// bytes to a chunk in the closure, so a module that was fully tree-shaken away does not trip the check.
// Usage: node scripts/check-imports.mjs [--metafile-dir .build] [--verbose]
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { entries } from './entries.mjs';

const args = process.argv.slice(2);
const dir = args.includes('--metafile-dir') ? args[args.indexOf('--metafile-dir') + 1] : '.build';
const verbose = args.includes('--verbose');
const FORMATS = [['esm', 'js'], ['cjs', 'cjs']];

let failures = 0;
let checked = 0;
for (const [format, ext] of FORMATS) {
  const file = join(dir, `metafile-${format}.json`);
  if (!existsSync(file)) {
    console.error(`check-imports: ${file} missing; run npm run build first`);
    process.exit(1);
  }
  const { outputs } = JSON.parse(readFileSync(file, 'utf8'));
  const closure = (start) => {
    const seen = new Set();
    const stack = [start];
    while (stack.length) {
      const f = stack.pop();
      if (seen.has(f)) continue;
      seen.add(f);
      const out = outputs[f];
      if (!out) throw new Error(`${file}: no output ${f}`);
      for (const i of out.imports) if (i.kind !== 'dynamic-import' && !i.external && outputs[i.path]) stack.push(i.path);
    }
    return seen;
  };
  for (const e of entries) {
    const start = `dist/${e.out}.${ext}`;
    if (!outputs[start]) {
      console.error(`check-imports: ${format}: no output for entry ${e.subpath} (${start})`);
      failures++;
      continue;
    }
    const sources = new Map(); // src file -> chunk that carries it
    for (const chunk of closure(start)) for (const [src, info] of Object.entries(outputs[chunk].inputs)) if (info.bytesInOutput > 0) sources.set(src, chunk);
    checked++;
    for (const [src, chunk] of sources) {
      const hit = e.banned.find((b) => src.includes(b));
      if (hit) {
        console.error(`check-imports: ${format}: ${e.subpath} statically includes ${src} (banned "${hit}") via ${chunk}`);
        failures++;
      }
    }
    if (verbose) console.log(`${format} ${e.subpath}: ${sources.size} source files in ${closure(start).size} chunks`);
  }
}
if (failures) process.exit(1);
console.log(`check-imports: ok (${checked} entry/format pairs, banned sources absent from every static closure)`);
