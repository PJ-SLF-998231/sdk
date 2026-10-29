// Prints the number of differing pixels per PNG between two screenshot folders. Usage: node compare.mjs <baseDir> <afterDir>
// Exits 1 when any PNG differs, is missing or has another size. Intentional differences are listed in the README, not skipped here.
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { PNG } from './png.mjs';

const [a, b] = process.argv.slice(2);
if (!a || !b) { console.error('usage: node compare.mjs <baseDir> <afterDir>'); process.exit(2); }
const names = [...new Set([...readdirSync(a), ...readdirSync(b)].filter((n) => n.endsWith('.png')))].sort();
let bad = 0, total = 0;
for (const n of names) {
  total++;
  if (!existsSync(`${a}/${n}`) || !existsSync(`${b}/${n}`)) { console.log(`${n}: MISSING in ${existsSync(`${a}/${n}`) ? 'after' : 'base'}`); bad++; continue; }
  const d = PNG.diff(readFileSync(`${a}/${n}`), readFileSync(`${b}/${n}`));
  if (d.sizeMismatch) { console.log(`${n}: SIZE MISMATCH ${d.sizeMismatch}`); bad++; continue; }
  console.log(`${n}: ${d.diffPixels} differing pixels of ${d.total}`);
  if (d.diffPixels !== 0) bad++;
}
console.log(`${total} PNGs compared, ${bad} differ`);
process.exit(bad ? 1 : 0);
