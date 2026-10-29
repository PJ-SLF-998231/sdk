// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { createShelfClient } from '../src';

afterEach(cleanup);

// Response shapes copied from the Shelf api (internal/integrations/reach.go, docs/openapi.yaml):
// GET /files -> {"files": [...], "next_cursor": string|null}; preview_sizes are names.
const ROOT = 'r0';
const folders = [
  { id: ROOT, parent_id: null, name: 'Aisle CMS' },
  ...['Contracts', 'Quotes', 'Inspiration', 'Planning'].map((name, i) => ({ id: `s${i}`, parent_id: ROOT, name })),
];
const fileRow = (o: object = {}) => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: ROOT,
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null,
  preview_sizes: ['small', 'medium'], ...o,
});

function fakeApi(filesBody: unknown, foldersBody: unknown = { folders }): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://x').pathname.replace(/^\/api\/shelf/, '');
    const body =
      path === '/' ? { id: 'k', name: 'cms', access: 'read', expires_at: null, folder: { id: ROOT, name: 'Aisle CMS' } }
      : path === '/folders' ? foldersBody
      : path === '/files' ? filesBody
      : undefined;
    return new Response(JSON.stringify(body ?? null), { status: body === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const mount = (api: typeof fetch) =>
  render(<ShelfFolder client={createShelfClient({ baseUrl: '/api/shelf', fetch: api })} />);

describe('real API shapes', () => {
  it('empty folder with 4 subfolders and 0 files renders (prod blank page)', async () => {
    mount(fakeApi({ files: [], next_cursor: null }));
    for (const n of ['Contracts', 'Quotes', 'Inspiration', 'Planning']) await screen.findByText(n);
  });

  it('lists files from {files: [...]} and uses a named preview size', async () => {
    const { container } = mount(fakeApi({ files: [fileRow(), fileRow({ id: 'f2', filename: 'n.docx', preview_sizes: [] })], next_cursor: null }));
    await screen.findByText('plan.pdf');
    expect(container.querySelector('img[src="/api/shelf/files/f1/thumbnail?size=small"]')).toBeTruthy();
    expect(screen.getByText('docx')).toBeTruthy();
  });

  it.each([
    ['files null', { files: null, next_cursor: null }],
    ['files omitted', {}],
    ['body null', null],
  ])('tolerates %s', async (_n, body) => {
    mount(fakeApi(body));
    await screen.findByText('Contracts');
    await waitFor(() => expect(screen.queryByText('Loading...')).toBeNull());
    expect(screen.getByText('Quotes')).toBeTruthy();
  });

  it('tolerates null preview_sizes on a file', async () => {
    const { container } = mount(fakeApi({ files: [fileRow({ preview_sizes: null })], next_cursor: null }));
    await screen.findByText('plan.pdf');
    expect(container.querySelector('img.shelf-sdk__thumb')).toBeNull();
  });

  it.each([['folders null', { folders: null }], ['folders omitted', {}]])('tolerates %s', async (_n, fb) => {
    mount(fakeApi({ files: [], next_cursor: null }, fb));
    await screen.findByText('This folder is empty.');
  });
});

describe('client normalisation', () => {
  const api = (b: unknown) => createShelfClient({ baseUrl: '/api/shelf', fetch: fakeApi(b) });
  it('listFiles maps {files} to items and null to []', async () => {
    expect((await api({ files: [fileRow()], next_cursor: 'c' }).listFiles()).items).toHaveLength(1);
    expect(await api({ files: null, next_cursor: null }).listFiles()).toEqual({ items: [], next_cursor: null });
    expect(await api(null).listFiles()).toEqual({ items: [], next_cursor: null });
  });
  it('folders tolerates null', async () => {
    const c = createShelfClient({ baseUrl: '/api/shelf', fetch: fakeApi({}, { folders: null }) });
    expect(await c.folders()).toEqual([]);
  });
  it('null preview_sizes becomes []', async () => {
    const r = await api({ files: [fileRow({ preview_sizes: null })], next_cursor: null }).listFiles();
    expect(r.items[0]!.preview_sizes).toEqual([]);
  });
});
