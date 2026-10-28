// Post-build guard: react stays external and the stylesheet never touches the host :root.
import { readFileSync } from 'node:fs';

const fail = (m) => { console.error('check-dist: ' + m); process.exit(1); };
for (const f of ['dist/react/index.js', 'dist/react/index.cjs']) {
  const s = readFileSync(f, 'utf8');
  if (!/["']react\/jsx-runtime["']/.test(s)) fail(`${f} does not import react/jsx-runtime externally`);
  if (/__SECRET_INTERNALS|ReactCurrentDispatcher/.test(s)) fail(`${f} bundles react`);
}
const css = readFileSync('dist/styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
if (/:root/.test(css)) fail('dist/styles.css contains a bare :root');
if (!css.includes('.shelf-sdk')) fail('dist/styles.css is not scoped to .shelf-sdk');
console.log('check-dist: ok');
