// Fake Shelf integration API with the real wire shapes (api internal/integrations/reach.go) and Aisle's data.
const ROOT = '11111111-1111-4111-8111-111111111111';
const folder = (n, id) => ({ id, parent_id: ROOT, name: n });
export const FOLDERS = [
  { id: ROOT, parent_id: null, name: 'Aisle CMS' },
  folder('Contracts', '22222222-2222-4222-8222-222222222221'),
  folder('Quotes', '22222222-2222-4222-8222-222222222222'),
  folder('Inspiration', '22222222-2222-4222-8222-222222222223'),
  folder('Planning', '22222222-2222-4222-8222-222222222224'),
];
const TEXT = 'This is a short contract draft for the Aisle CMS project, with a few words.\n';
const DOC = {
  id: '33333333-3333-4333-8333-333333333333', filename: 'contract-draft.txt', content_type: 'text/plain',
  size_bytes: 88, folder_id: FOLDERS[1].id, parse_status: 'ready',
  created_at: '2026-10-27T09:12:00Z', edited_at: null, parsed_at: '2026-10-27T09:12:04Z', preview_sizes: [],
};
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };

// ---- 5000-document mode under /api/shelf5k (perf harness). State is in memory; /__harness/* controls it. ----
const N5K = 5000;
const PNG1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const idOf = (n) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
let docs5k, stats5k, delay5k = 0;
function reset5k() {
  delay5k = 0;
  stats5k = { patch: 0, post: 0, delete: 0, thumb: 0, files: 0, uploads: [] };
  docs5k = Array.from({ length: N5K }, (_, i) => {
    const img = i % 3 !== 2;
    return {
      id: idOf(i + 1), filename: `doc-${String(i + 1).padStart(4, '0')}.${img ? 'png' : 'txt'}`, content_type: img ? 'image/png' : 'text/plain',
      size_bytes: 1000 + i, folder_id: ROOT, parse_status: 'ready', created_at: new Date(Date.UTC(2026, 9, 27) - i * 60000).toISOString(),
      edited_at: null, parsed_at: new Date(Date.UTC(2026, 9, 27) - i * 60000 + 4000).toISOString(), preview_sizes: img ? ['small', 'medium'] : [],
    };
  });
}
reset5k();
const readBody = (req) => new Promise((r) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => r(Buffer.concat(c))); });

async function handle5k(req, res, p, u) {
  if (delay5k) await new Promise((r) => setTimeout(r, delay5k));
  const m = req.method;
  if (p === '/' && m === 'GET') return send(res, 200, { id: 'k5', name: 'Perf key', access: 'read_write', expires_at: null, folder: { id: ROOT, name: 'Perf shelf' } });
  if (p === '/folders') return send(res, 200, { folders: [{ id: ROOT, parent_id: null, name: 'Perf shelf', item_count: docs5k.length, total_item_count: docs5k.length }] });
  if (p === '/files' && m === 'GET') {
    stats5k.files++;
    const limit = Math.min(Number(u.searchParams.get('limit')) || 50, 200);
    const off = Number(u.searchParams.get('cursor') || 0);
    const page = docs5k.slice(off, off + limit);
    return send(res, 200, { files: page, next_cursor: off + limit < docs5k.length ? String(off + limit) : null });
  }
  if (p === '/files' && m === 'POST') {
    stats5k.post++;
    const body = (await readBody(req)).toString('latin1');
    const ref = /name="client_ref"\r\n\r\n([^\r]+)/.exec(body)?.[1];
    const name = /filename="([^"]+)"/.exec(body)?.[1] ?? 'upload.txt';
    stats5k.uploads.push({ name, ref });
    let d = ref && docs5k.find((x) => x.client_ref === ref);
    if (!d) {
      d = { id: idOf(N5K + 1 + stats5k.post), filename: name, content_type: 'text/plain', size_bytes: 5, folder_id: ROOT, parse_status: 'ready', created_at: new Date().toISOString(), edited_at: null, parsed_at: null, preview_sizes: [], client_ref: ref };
      docs5k.unshift(d);
    }
    return send(res, 201, d);
  }
  const t = /^\/files\/([^/]+)\/thumbnail$/.exec(p);
  if (t) {
    stats5k.thumb++;
    const tag = `"t-${t[1]}"`;
    if (req.headers['if-none-match'] === tag) { res.writeHead(304, { ETag: tag }); return res.end(); }
    res.writeHead(200, { 'content-type': 'image/png', ETag: tag, 'cache-control': 'private, max-age=0' });
    return res.end(PNG1);
  }
  const f = /^\/files\/([^/]+)$/.exec(p);
  if (f) {
    const d = docs5k.find((x) => x.id === f[1]);
    if (!d) return send(res, 404, { code: 'not_found', error: 'not found' });
    if (m === 'GET') return send(res, 200, { ...d, parsed_text: 'perf', parsed_meta: {}, parse_result: null, parse_error: null, parser_name: 'text', download_url: '' });
    if (m === 'PATCH') {
      stats5k.patch++;
      const patch = JSON.parse((await readBody(req)).toString() || '{}');
      if (patch.filename) { d.filename = patch.filename; d.edited_at = new Date().toISOString(); }
      return send(res, 200, d);
    }
    if (m === 'DELETE') { stats5k.delete++; docs5k.splice(docs5k.indexOf(d), 1); res.writeHead(204); return res.end(); }
  }
  return send(res, 404, { code: 'not_found', error: 'not found' });
}


// ---- Long-name fixtures under /api/shelflong (P3 wrap checks; the baseline screenshots never use this route). ----
export const LONG_UNBROKEN = 'Stellenbosch_Wedding_Colour_and_Style_Guide_White_Background_Final_Approved_Revision_Seven.pdf';
export const LONG_SPACED = 'Quarterly review of the Stellenbosch wedding venue shortlist and catering quotes for the October event.pdf';
const LONG_FOLDER_UNBROKEN = 'Stellenbosch_Wedding_Colour_and_Style_Guide_White_Background_Final_Approved_Revision_Seven';
const LONG_FOLDER_SPACED = 'Quarterly review of the Stellenbosch wedding venue shortlist and catering quotes';
const LROOT = '44444444-4444-4444-8444-444444444441';
const LFOLDERS = [
  { id: LROOT, parent_id: null, name: LONG_FOLDER_UNBROKEN },
  { id: '44444444-4444-4444-8444-444444444442', parent_id: LROOT, name: LONG_FOLDER_UNBROKEN },
  { id: '44444444-4444-4444-8444-444444444443', parent_id: LROOT, name: LONG_FOLDER_SPACED },
];
const ldoc = (n, name, type) => ({
  id: `55555555-5555-4555-8555-${String(n).padStart(12, '0')}`, filename: name, content_type: type, size_bytes: 1500000 + n, folder_id: LROOT,
  parse_status: 'ready', created_at: '2026-10-27T09:12:00Z', edited_at: null, parsed_at: '2026-10-27T09:12:04Z', preview_sizes: [],
});
const LDOCS = [
  ldoc(1, LONG_UNBROKEN, 'application/pdf'),
  ldoc(2, LONG_SPACED, 'application/pdf'),
  ldoc(3, '2026-10-29-ready-set-gunrun-event-entry.jpg', 'image/jpeg'),
  ldoc(4, 'a'.repeat(72) + '.txt', 'text/plain'),
  ldoc(5, 'short.txt', 'text/plain'),
];
function handleLong(res, p) {
  if (p === '/') return send(res, 200, { id: 'kl', name: 'Long key', access: 'read_write', expires_at: null, folder: { id: LROOT, name: LONG_FOLDER_UNBROKEN } });
  if (p === '/folders') return send(res, 200, { folders: LFOLDERS });
  if (p === '/files') return send(res, 200, { files: LDOCS, next_cursor: null });
  const d = /^\/files\/([^/]+)$/.exec(p);
  const doc = d && LDOCS.find((x) => x.id === d[1]);
  if (doc) return send(res, 200, { ...doc, parsed_text: TEXT, parsed_meta: {}, parse_result: null, parse_error: null, parser_name: 'text', download_url: '' });
  return send(res, 404, { error: 'not found' });
}

/** Returns true when it handled the request. */
export function handle(req, res) {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/__harness/delay') { delay5k = Number(u.searchParams.get('ms')) || 0; return send(res, 200, { delay: delay5k }), true; }
  if (u.pathname === '/__harness/reset') { reset5k(); return send(res, 200, { ok: true }), true; }
  if (u.pathname === '/__harness/stats') return send(res, 200, { ...stats5k, docs: docs5k.length }), true;
  if (u.pathname.startsWith('/api/shelf5k')) { handle5k(req, res, u.pathname.slice('/api/shelf5k'.length) || '/', u).catch((e) => { res.headersSent || send(res, 500, { error: String(e) }); }); return true; }
  if (u.pathname.startsWith('/api/shelflong')) return handleLong(res, u.pathname.slice('/api/shelflong'.length) || '/'), true;
  if (!u.pathname.startsWith('/api/shelf')) return false;
  const p = u.pathname.slice('/api/shelf'.length) || '/';
  if (p === '/' ) return send(res, 200, { id: 'k1', name: 'Aisle key', access: 'read_write', expires_at: null, folder: { id: ROOT, name: 'Aisle CMS' } }), true;
  if (p === '/folders') return send(res, 200, { folders: FOLDERS }), true;
  if (p === '/files') {
    const f = u.searchParams.get('folder_id') || ROOT;
    const rec = u.searchParams.get('recursive') !== 'false';
    const inContracts = f === FOLDERS[1].id || (rec && f === ROOT);
    return send(res, 200, { files: inContracts ? [DOC] : [], next_cursor: null }), true;
  }
  if (p === `/files/${DOC.id}`) return send(res, 200, { ...DOC, parsed_text: TEXT, parsed_meta: { word_count: 13 }, parse_result: null, parse_error: null, parser_name: 'text', download_url: `/api/shelf/files/${DOC.id}/original/${DOC.filename}` }), true;
  if (p.startsWith(`/files/${DOC.id}/original/`)) return send(res, 200, TEXT, 'text/plain'), true;
  send(res, 404, { error: 'not found' });
  return true;
}
