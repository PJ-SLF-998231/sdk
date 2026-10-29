// Tiny pixel diff via the browser-free pngjs-less route: decode with Playwright's bundled pngjs.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { PNG: P } = require('playwright-core/lib/utilsBundle');
export const PNG = {
  diff(a, b) {
    const A = P.sync.read(a), B = P.sync.read(b);
    const h = Math.min(A.height, B.height); if (A.width !== B.width || Math.abs(A.height - B.height) > 2) return { sizeMismatch: `${A.width}x${A.height} vs ${B.width}x${B.height}`, diffPixels: -1, total: A.width * A.height };
    let n = 0;
    for (let i = 0; i < A.width * h * 4; i += 4) if (A.data[i] !== B.data[i] || A.data[i + 1] !== B.data[i + 1] || A.data[i + 2] !== B.data[i + 2]) n++;
    return { diffPixels: n, total: A.width * h };
  },
};
