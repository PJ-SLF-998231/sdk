// Writes dist/css/* from the last build's metafile (tsup does the same in onSuccess). Usage: node scripts/build-css.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { entries } from './entries.mjs';
import { splitCss } from './split-css.mjs';

const { files, report } = splitCss({ entries, metafile: JSON.parse(readFileSync('.build/metafile-esm.json', 'utf8')) });
mkdirSync('dist/css', { recursive: true });
for (const [f, css] of Object.entries(files)) writeFileSync(join('dist', f), css);
console.log(`build-css: wrote ${Object.keys(files).length} files`);
console.table(report.entries);
