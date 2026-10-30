// Post-build guard for the per-entry stylesheets: dist/css/* is exactly what scripts/split-css.mjs derives from the sources and
// the build's metafile (no stale or hand-edited file), the derivation is deterministic, and every entry's file carries core.css.
// Scoping, prefixes and font urls of every css file are checked by scripts/check-dist.mjs.
import { readdirSync, readFileSync } from 'node:fs';
import { entries } from './entries.mjs';
import { splitCss } from './split-css.mjs';

const fail = (m) => { console.error('check-css: ' + m); process.exit(1); };
const metafile = JSON.parse(readFileSync('.build/metafile-esm.json', 'utf8'));
const a = splitCss({ entries, metafile });
const b = splitCss({ entries, metafile });
if (JSON.stringify(a.files) !== JSON.stringify(b.files)) fail('split-css is not deterministic');
const want = Object.keys(a.files).map((f) => f.replace(/^css\//, '')).sort();
const have = readdirSync('dist/css').sort();
if (JSON.stringify(want) !== JSON.stringify(have)) fail(`dist/css has [${have}], expected [${want}]`);
for (const [f, css] of Object.entries(a.files)) if (readFileSync(`dist/${f}`, 'utf8') !== css) fail(`dist/${f} differs from what split-css derives (stale build?)`);
for (const e of entries.filter((x) => x.css)) if (!a.files[e.css.file]) fail(`no stylesheet for ${e.subpath}`);
console.log(`check-css: ok (${have.length} files in dist/css, deterministic, up to date)`);
