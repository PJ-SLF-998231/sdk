// Prints minified and gzip bytes per dist entry (react, react-dom, react/jsx-runtime external).
// Usage: node scripts/size-report.mjs [--dist <dir>] [--json]
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const args = process.argv.slice(2);
const flag = (n) => args.indexOf(n);
const dist = resolve(flag('--dist') >= 0 ? args[flag('--dist') + 1] : 'dist');
const asJson = flag('--json') >= 0;

const entries = [
  ['index.js', 'client (esm)'],
  ['react/index.js', 'react (esm)'],
  ['index.cjs', 'client (cjs)'],
  ['react/index.cjs', 'react (cjs)'],
];

export async function measure(file) {
  const out = await build({
    entryPoints: [file],
    bundle: true,
    minify: true,
    write: false,
    format: file.endsWith('.cjs') ? 'cjs' : 'esm',
    platform: 'browser',
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].contents;
  return { min: code.length, gzip: gzipSync(code, { level: 9 }).length };
}

const rows = [];
for (const [f, label] of entries) {
  const p = resolve(dist, f);
  if (!existsSync(p)) continue;
  rows.push({ entry: f, label, ...(await measure(p)) });
}
if (asJson) console.log(JSON.stringify(rows, null, 2));
else {
  console.log('| entry | min (B) | gzip (B) |\n|---|---:|---:|');
  for (const r of rows) console.log(`| ${r.entry} | ${r.min} | ${r.gzip} |`);
}
