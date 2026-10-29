// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { createShelfClient } from '../src';

afterEach(cleanup);

// Thumbnails are fetched with the client's credentials and shown from object URLs, so the fake API serves
// image bytes, records which size was asked for, and jsdom (which has no object URLs) gets a stub.
const thumbRequests: string[] = [];
let blobs = 0;
beforeEach(() => {
  thumbRequests.length = 0;
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:thumb-${++blobs}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});

// Response shapes copied from the Shelf api (internal/integrations/reach.go, docs/openapi.yaml):
// GET /files -> {"files": [...], "next_cursor": string|null}; preview_sizes are names;
// GET /folders -> {"folders": [{id, parent_id, name}]}, the key's folder first.
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

/** A fake of the integration API: `all` is every document under the key's folder; listing filters like the real route. */
function fakeApi(all: unknown, foldersBody: unknown = { folders }, access = 'read'): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(String(input), 'http://x');
    const path = url.pathname.replace(/^\/api\/shelf/, '');
    let body: unknown;
    if (/^\/files\/[^/]+\/thumbnail$/.test(path)) {
      thumbRequests.push(path + url.search);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': 'image/png' } });
    }
    if (path === '/') body = { id: 'k', name: 'cms', access, expires_at: null, folder: { id: ROOT, name: 'Aisle CMS' } };
    else if (path === '/folders') body = foldersBody;
    else if (path === '/files') {
      const rows = Array.isArray((all as { files?: unknown[] } | null)?.files) ? (all as { files: Array<{ folder_id: string }> }).files : null;
      if (rows === null) body = all;
      else {
        const folder = url.searchParams.get('folder_id');
        const recursive = url.searchParams.get('recursive') !== 'false';
        body = { files: recursive || !folder ? rows : rows.filter((r) => r.folder_id === folder), next_cursor: null };
      }
    }
    return new Response(JSON.stringify(body ?? null), { status: body === undefined ? 404 : 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const mount = (api: typeof fetch) =>
  render(<ShelfFolder client={createShelfClient({ baseUrl: '/api/shelf', fetch: api })} />);
const text = (el: Element | null | undefined) => el?.textContent?.replace(/\u00a0/g, ' ');

describe('real API shapes', () => {
  beforeEach(() => window.localStorage.clear());

  it('(a) the Aisle CMS folder: 4 subfolders, 0 documents of its own, 1 in Contracts', async () => {
    const { container } = mount(fakeApi({ files: [fileRow({ id: 'c1', filename: 'msa.txt', content_type: 'text/plain', size_bytes: 88, folder_id: 's0' })], next_cursor: null }, undefined, 'read_write'));
    await screen.findByText('Planning');

    // header row: folder button, breadcrumb, mono meta
    const layout = container.querySelector('.shelf-sdk > .shelf-sdk__shelf-layout.shelf-sdk__shelf-layout--rail')!;
    expect(layout).toBeTruthy();
    expect(layout.querySelector('aside.shelf-sdk__shelf-sidebar > button.shelf-sdk__shelf-sidebar-toggle')?.getAttribute('title')).toBe('Show folders');
    const row = layout.querySelector('section.shelf-sdk__shelf-main > .shelf-sdk__shelf-crumbs-row')!;
    expect(row.querySelector('nav.shelf-sdk__breadcrumbs ol li button.shelf-sdk__breadcrumb')?.getAttribute('aria-current')).toBe('page');
    expect(text(row.querySelector('.shelf-sdk__breadcrumb'))).toBe('Aisle CMS');
    await waitFor(() => expect(text(row.querySelector('.shelf-sdk__shelf-crumbs-aside .shelf-sdk__file-count'))).toBe('1 item · 5 folders'));

    // toolbar: Add documents (read_write), Gallery | List; no New folder (the API cannot create folders)
    const bar = container.querySelector('.shelf-sdk__shelf-toolbar')!;
    expect(Array.from(bar.querySelectorAll(':scope > button')).map(text)).toEqual(['Add documents']);
    expect(bar.querySelector('button.shelf-sdk__btn.shelf-sdk__btn--accent.shelf-sdk__btn--sm')).toBeTruthy();
    expect(Array.from(bar.querySelectorAll('.shelf-sdk__layout-toggle > button.shelf-sdk__layout-toggle-btn')).map((b) => [text(b), b.getAttribute('aria-pressed')])).toEqual([
      ['Gallery', 'true'],
      ['List', 'false'],
    ]);

    // FOLDERS label and the four cards (by name, as Shelf lists them), sublabels from real counts
    expect(text(container.querySelector('h2.shelf-sdk__kicker.shelf-sdk__shelf-section-label'))).toBe('Folders');
    const tiles = Array.from(container.querySelectorAll('.shelf-sdk__folder-grid > article.shelf-sdk__card.shelf-sdk__folder-tile'));
    expect(tiles.map((t) => [text(t.querySelector('.shelf-sdk__folder-tile-name')), text(t.querySelector('.shelf-sdk__card-meta'))])).toEqual([
      ['Contracts', '1 item'],
      ['Inspiration', 'Empty'],
      ['Planning', 'Empty'],
      ['Quotes', 'Empty'],
    ]);
    for (const t of tiles) {
      expect(t.querySelector('svg.shelf-sdk__folder-icon')).toBeTruthy();
      expect(t.querySelector('.shelf-sdk__action-menu')).toBeNull(); // folder rename/move/delete are not in the integration API
    }
    // no documents of its own: no DOCUMENTS section
    expect(container.querySelector('.shelf-sdk__file-grid')).toBeNull();
    // drop hint, last
    expect(text(container.querySelector('.shelf-sdk__shelf-dropzone > p.shelf-sdk__dropzone-limits.shelf-sdk__shelf-dropzone-hint'))).toBe(
      'Drop documents here to add them to Aisle CMS · PDF, Word, Excel, text, Markdown, JSON, or scans and photos of documents · up to 25 MB',
    );
  });

  it('(a2) the same folder with nothing in it anywhere: every card is Empty, header counts 0 items', async () => {
    const { container } = mount(fakeApi({ files: [], next_cursor: null }));
    for (const n of ['Contracts', 'Quotes', 'Inspiration', 'Planning']) await screen.findByText(n);
    await waitFor(() => expect(text(container.querySelector('.shelf-sdk__file-count'))).toBe('0 items · 5 folders'));
    expect(Array.from(container.querySelectorAll('.shelf-sdk__folder-tile .shelf-sdk__card-meta')).map(text)).toEqual(['Empty', 'Empty', 'Empty', 'Empty']);
    expect(container.querySelector('.shelf-sdk__empty')).toBeNull(); // subfolders count as contents
  });

  describe('(b) a folder with documents', () => {
    const docs = {
      files: [
        fileRow({ id: 'd1', filename: 'notes.txt', content_type: 'text/plain', size_bytes: 88, preview_sizes: ['small', 'medium', 'large'] }),
        fileRow({ id: 'd2', filename: 'plan.pdf', parse_status: 'pending', preview_sizes: [] }),
      ],
      next_cursor: null,
    };

    it('Gallery: cards with thumbnail, status pill, name and size · type', async () => {
      const { container } = mount(fakeApi(docs));
      await screen.findByText('notes.txt');
      expect(text(container.querySelector('.shelf-sdk__shelf-section-head h2'))).toBe('Documents');
      const cards = Array.from(container.querySelectorAll('.shelf-sdk__file-grid article.shelf-sdk__card.shelf-sdk__file-card'));
      expect(cards).toHaveLength(2);
      const [a, b] = cards as [Element, Element];
      // Thumbnails now arrive through the thumbnail loader, a moment after the card.
      await waitFor(() => expect(a.querySelector('.shelf-sdk__file-card-thumb img')?.getAttribute('src')).toMatch(/^blob:thumb-/));
      expect(thumbRequests).toContain('/files/d1/thumbnail?size=medium');
      expect(text(a.querySelector('.shelf-sdk__file-card-thumb .shelf-sdk__pill.shelf-sdk__pill--ready'))).toBe('Ready');
      expect(text(a.querySelector('.shelf-sdk__file-card-body .shelf-sdk__card-meta'))).toBe('88 B · TXT');
      expect(text(a.querySelector('h3.shelf-sdk__file-card-name button'))).toBe('notes.txt');
      // no thumbnail yet: the type badge stands in, and a pending read shows as busy
      expect(text(b.querySelector('.shelf-sdk__file-card-thumb.shelf-sdk__file-card-thumb--doc .shelf-sdk__file-card-type'))).toBe('PDF');
      expect(text(b.querySelector('.shelf-sdk__pill.shelf-sdk__pill--busy'))).toBe('Queued');
      expect(b.querySelector('.shelf-sdk__upload-bar')).toBeTruthy();
      expect(b.getAttribute('aria-busy')).toBe('true');
      // read key: no menu on the cards
      expect(a.querySelector('.shelf-sdk__action-menu')).toBeNull();
      // Subfolders and documents both show: FOLDERS first
      expect(Array.from(container.querySelectorAll('h2.shelf-sdk__shelf-section-label')).map(text)).toEqual(['Folders', 'Documents']);
    });

    it('List: a table of folders then documents, with status, size and added date', async () => {
      const { container } = mount(fakeApi(docs, undefined, 'read_write'));
      await screen.findByText('notes.txt');
      fireEvent.click(screen.getByRole('button', { name: 'List' }));
      const table = container.querySelector('table.shelf-sdk__item-list')!;
      expect(Array.from(table.querySelectorAll('thead th')).map(text)).toEqual(['Name', 'Status', 'Size', 'Added', 'Actions']);
      const rows = Array.from(table.querySelectorAll('tbody > tr.shelf-sdk__item-row'));
      expect(rows.map((r) => text(r.querySelector('.shelf-sdk__item-name-text')))).toEqual(['Contracts', 'Inspiration', 'Planning', 'Quotes', 'notes.txt', 'plan.pdf']);
      expect(rows.slice(0, 4).every((r) => r.classList.contains('shelf-sdk__item-row--folder'))).toBe(true);
      const notes = rows[4]!;
      expect(text(notes.querySelector('.shelf-sdk__pill--ready'))).toBe('Ready');
      expect(text(notes.querySelector('.shelf-sdk__item-list-num'))).toBe('88 B');
      await waitFor(() => expect(notes.querySelector('.shelf-sdk__item-thumb img')?.getAttribute('src')).toMatch(/^blob:thumb-/));
      expect(thumbRequests).toContain('/files/d1/thumbnail?size=small');
      expect(notes.querySelector('.shelf-sdk__item-list-actions .shelf-sdk__action-menu-button')).toBeTruthy();
      expect(text(rows[5]!.querySelector('.shelf-sdk__item-thumb'))).toBe('PDF');
      expect(container.querySelector('.shelf-sdk__file-grid')).toBeNull();
    });
  });

  it('lists files from {files: [...]} and uses a named preview size', async () => {
    const { container } = mount(fakeApi({ files: [fileRow(), fileRow({ id: 'f2', filename: 'n.docx', preview_sizes: [] })], next_cursor: null }));
    await screen.findByText('plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-card-thumb img')).toBeTruthy());
    expect(thumbRequests).toEqual(['/files/f1/thumbnail?size=medium']);
    expect(container.querySelectorAll('.shelf-sdk__file-card')).toHaveLength(2);
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
    expect(container.querySelector('.shelf-sdk__file-card-thumb img')).toBeNull();
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
