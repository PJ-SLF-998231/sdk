import { createRequire } from 'node:module'; import { readFileSync } from 'node:fs';
const { PNG } = createRequire(import.meta.url)('playwright-core/lib/utilsBundle');
const [a, b] = process.argv.slice(2).map((f) => PNG.sync.read(readFileSync(f)));
const rows = {}; for (let y = 0; y < Math.min(a.height, b.height); y++) for (let x = 0; x < a.width; x++) { const i = (y * a.width + x) * 4; if (a.data[i] !== b.data[i]) rows[Math.floor(y / 40)] = (rows[Math.floor(y / 40)] || 0) + 1; }
console.log(a.width, a.height, b.height, JSON.stringify(rows));
