// Every CSS custom property declared in src/styles/styles.css (the tokens on .shelf-sdk) must appear in the README's
// "Tokens" table, and the table must not list one that styles.css does not declare. The table rows look like
// | `--name` | light | dark | use |. Usage: node scripts/check-tokens.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const declared = new Set([...css.matchAll(/(^|[\s;{])(--[a-z0-9-]+)\s*:/g)].map((m) => m[2]));
const readme = readFileSync('README.md', 'utf8');

const start = readme.search(/^#{2,4} Tokens\s*$/m);
if (start < 0) {
  console.error('check-tokens: README.md has no "Tokens" heading');
  process.exit(1);
}
const rest = readme.slice(start).split('\n').slice(1);
const end = rest.findIndex((l) => /^#{1,4} /.test(l));
const section = (end < 0 ? rest : rest.slice(0, end)).join('\n');
const documented = new Set([...section.matchAll(/^\|\s*`(--[a-z0-9-]+)`\s*\|/gm)].map((m) => m[1]));

const missing = [...declared].filter((t) => !documented.has(t));
const stale = [...documented].filter((t) => !declared.has(t));
if (declared.size < 20) {
  console.error(`check-tokens: only ${declared.size} tokens found in src/styles/styles.css; the pattern is broken`);
  process.exit(1);
}
if (missing.length || stale.length) {
  if (missing.length) console.error(`check-tokens: declared in styles.css but not in the README Tokens table: ${missing.join(', ')}`);
  if (stale.length) console.error(`check-tokens: in the README Tokens table but not declared in styles.css: ${stale.join(', ')}`);
  process.exit(1);
}
console.log(`check-tokens: ok (${declared.size} tokens declared in styles.css, all in the README Tokens table)`);
