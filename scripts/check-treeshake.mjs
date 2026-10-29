// A host that imports only the client must not pull in storage, cache, outbox or virtual-list code.
import { build } from 'esbuild';

const banned = ['indexedDB', 'BroadcastChannel', 'IntersectionObserver', 'Virtualizer'];
for (const format of ['esm']) {
  const out = await build({
    stdin: { contents: "import {createShelfClient} from './dist/index.js'; console.log(createShelfClient);", resolveDir: process.cwd() },
    bundle: true,
    minify: false,
    write: false,
    format,
    platform: 'browser',
    treeShaking: true,
    external: ['react', 'react-dom', 'react/jsx-runtime'],
    logLevel: 'silent',
  });
  const code = out.outputFiles[0].text;
  const hit = banned.filter((b) => code.includes(b));
  if (hit.length) {
    console.error(`check-treeshake: client-only bundle contains ${hit.join(', ')}`);
    process.exit(1);
  }
  console.log(`check-treeshake: ok (${code.length} bytes unminified, none of ${banned.join(', ')})`);
}
