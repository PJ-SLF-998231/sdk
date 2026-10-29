// Serves the evidence page and a fake Shelf integration API with the real wire shapes (api internal/integrations/reach.go,
// docs/openapi.yaml; GET /files/{id}/site per api#305). Dev tooling only; not published.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = join(here, '..', '..');
const types = { '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.html': 'text/html' };

const ROOT = '11111111-1111-4111-8111-111111111111';
const CONTRACTS = '22222222-2222-4222-8222-222222222221';
const FOLDERS = [
  { id: ROOT, parent_id: null, name: 'Aisle CMS' },
  { id: CONTRACTS, parent_id: ROOT, name: 'Contracts' },
  { id: '22222222-2222-4222-8222-222222222222', parent_id: ROOT, name: 'Quotes' },
];
const PET_TEXT = `
PET APPLICATION
This pet application forms part of the Conduct Rules. Owners/tenants (‘Pet Keepers’) will only be allowed
to keep pets once the trustees approve the pet application. Pet Keepers are required to submit a
separate Pet Application for each pet. Pet Keepers are bound by the Pet Rules of this Pet Application.
Non-adherence to Pet Rules may result in Pet Keepers being fined and/or the Pet Application approval
being revoked by the trustees.

Name & Surname of Owner:
Name & Surname of Tenant:
Complex Name & Unit
Number:
Type of Pet: Other (please
(Tick appropriate box) Dog  Cat  specify)

Breed:
`;
const row = (o) => ({
  content_type: 'application/pdf', folder_id: CONTRACTS, parse_status: 'parsed',
  created_at: '2026-10-27T09:12:00Z', edited_at: null, parsed_at: '2026-10-27T09:12:04Z', preview_sizes: ['small', 'medium', 'large'], ...o,
});
const DOCS = [
  row({ id: 'd1', filename: 'general-pet-application-body-corporate.pdf', size_bytes: 595148, has_site: false,
    text: PET_TEXT, meta: { page_count: 2, word_count: 96 } }),
  row({ id: 'd2', filename: 'corner-cafe-receipt.pdf', size_bytes: 48210, has_site: true,
    text: 'Corner Cafe\nReceipt A-1042\nTotal EUR 12.40\n', meta: { page_count: 1, word_count: 8 } }),
];
const SITE = JSON.parse(readFileSync(join(repo, 'test/fixtures/site-receipt.json'), 'utf8'));
const strip = ({ text, meta, ...d }) => d;
const PDF = Buffer.from(`%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj
4 0 obj<</Length 44>>stream
BT /F1 18 Tf 20 100 Td (Original PDF) Tj ET
endstream endobj
5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj
trailer<</Root 1 0 R/Size 6>>
%%EOF`);
const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};

function api(req, res) {
  const u = new URL(req.url, 'http://x');
  if (!u.pathname.startsWith('/api/shelf')) return false;
  const p = u.pathname.slice('/api/shelf'.length) || '/';
  if (p === '/') return send(res, 200, { id: 'k1', name: 'Aisle key', access: 'read_write', expires_at: null, folder: { id: ROOT, name: 'Aisle CMS' } }), true;
  if (p === '/folders') return send(res, 200, { folders: FOLDERS }), true;
  if (p === '/files') return send(res, 200, { files: DOCS.map(strip), next_cursor: null }), true;
  const m = p.match(/^\/files\/([^/]+)(\/.*)?$/);
  const doc = m && DOCS.find((d) => d.id === m[1]);
  if (doc && !m[2]) return send(res, 200, { ...strip(doc), parsed_text: doc.text, parsed_meta: doc.meta }), true;
  if (doc && m[2] === '/site') {
    if (!doc.has_site) return send(res, 404, { code: 'not_found', message: 'no site' }), true;
    return send(res, 200, { file_id: doc.id, status: 'ready', stale: false, error_code: null, error: null, requested_at: '2026-10-27T09:13:00Z', updated_at: '2026-10-27T09:13:09Z', spec: SITE }), true;
  }
  if (doc && m[2]?.startsWith('/original/')) return send(res, 200, PDF, 'application/pdf'), true;
  if (doc && m[2] === '/thumbnail') return send(res, 404, { code: 'not_found' }), true;
  send(res, 404, { code: 'not_found', message: 'not found' });
  return true;
}

const page = () => `<!doctype html><html><head><meta charset="utf-8"><title>doc evidence</title><style>body{margin:0;padding:28px}</style>
<link rel="stylesheet" href="/dist/styles.css"></head><body><div id="root"></div><script type="module" src="/tools/doc-evidence/out/main.js"></script></body></html>`;

createServer(async (req, res) => {
  if (api(req, res)) return;
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page()); }
  const file = normalize(join(repo, u.pathname));
  if (!file.startsWith(repo) || file.includes('node_modules/.')) { res.writeHead(403); return res.end(); }
  try { const b = await readFile(file); res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' }); res.end(b); }
  catch { res.writeHead(404); res.end('not found'); }
}).listen(Number(process.env.PORT || 4181), () => console.log('doc evidence on', process.env.PORT || 4181));
