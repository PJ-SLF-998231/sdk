import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handle } from './fake-api.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };

const page = (q) => `<!doctype html><html><head><meta charset="utf-8"><title>host</title><style>body{margin:0;padding:28px}${q.get('bare') === '1' ? '#host-h1,#host-h2,#host-p{display:none}' : ''}</style>
${q.get('hostile') === '1' ? '<link rel="stylesheet" href="/harness/host.css">' : ''}
${q.get('sdk') === '0' ? '' : '<link rel="stylesheet" href="/dist/styles.css">'}
</head><body><h1 id="host-h1">Host page heading</h1><p id="host-p">Host paragraph <a href="#">link</a> <button id="host-btn">Host button</button></p>
${q.get('sdk') === '0' ? '' : `<div id="root" style="${q.get('abs') === '1' ? 'position:absolute;left:28px;right:28px;top:20px' : ''}"></div><script type="module" src="/harness/out/main.js"></script>`}
<h2 id="host-h2">After the component</h2></body></html>`;

createServer(async (req, res) => {
  if (handle(req, res)) return;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(u.searchParams)); }
  const file = normalize(join(repo, u.pathname));
  if (!file.startsWith(repo) || file.includes('node_modules/.')) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(Number(process.env.PORT || 4173), () => console.log('harness on', process.env.PORT || 4173));
