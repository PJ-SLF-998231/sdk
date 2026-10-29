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

/** Returns true when it handled the request. */
export function handle(req, res) {
  const u = new URL(req.url, 'http://x');
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
