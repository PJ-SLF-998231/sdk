// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { createShelfClient } from '../src';
import receipt from './fixtures/site-receipt.json';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

let blobs = 0;
beforeEach(() => {
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => `blob:doc-${++blobs}`;
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});

// Response shapes as the Shelf integration API sends them: GET /files/{id} is the list row plus parsed_text and
// parsed_meta; GET /files/{id}/site is {file_id, status, stale, error_code, error, requested_at, updated_at, spec}.
const ROOT = 'r0';
const SUB = 's0';
const folders = [
  { id: ROOT, parent_id: null, name: 'Aisle CMS' },
  { id: SUB, parent_id: ROOT, name: 'Contracts' },
];
const NAME = 'general-pet-application-body-corporate.pdf';
const TEXT = 'PET APPLICATION\nThis pet application forms part of the Conduct Rules.';
const row = (o: object = {}) => ({
  id: 'd1', filename: NAME, content_type: 'application/pdf', size_bytes: 595148, folder_id: SUB,
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: '2026-01-02T00:01:00Z',
  preview_sizes: ['small', 'medium', 'large'], ...o,
});
const detail = (o: object = {}) => ({ ...row(), parsed_text: TEXT, parsed_meta: { page_count: 2, word_count: 11 }, ...o });
const site = (o: object = {}) => ({
  file_id: 'd1', status: 'ready', stale: false, error_code: null, error: null,
  requested_at: '2026-01-02T00:02:00Z', updated_at: '2026-01-02T00:03:00Z', spec: receipt, ...o,
});

interface Opts {
  access?: 'read' | 'read_write';
  doc?: object;
  siteBody?: object | null;
  files?: object[];
}

function fakeApi({ access = 'read', doc = detail(), siteBody = null, files }: Opts = {}) {
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://x');
    const path = url.pathname.replace(/^\/api\/shelf/, '');
    calls.push(`${init?.method ?? 'GET'} ${path}`);
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (/^\/files\/[^/]+\/thumbnail$/.test(path)) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/png' } });
    if (/^\/files\/[^/]+\/original\//.test(path)) return new Response(new Uint8Array([37, 80, 68, 70]), { headers: { 'Content-Type': 'text/html' } });
    if (/^\/files\/[^/]+\/site$/.test(path)) return siteBody ? json(siteBody) : json({ code: 'not_found', message: 'no site' }, 404);
    if (path === '/') return json({ id: 'k', name: 'cms', access, expires_at: null, folder: { id: ROOT, name: 'Aisle CMS' } });
    if (path === '/folders') return json({ folders });
    if (path === '/files') return json({ files: files ?? [row()], next_cursor: null });
    if (/^\/files\/[^/]+$/.test(path)) return json(doc);
    return json({ code: 'not_found', message: 'nope' }, 404);
  }) as typeof fetch;
  return { fetcher, calls };
}

const mount = (api: ReturnType<typeof fakeApi>, props: Record<string, unknown> = {}) =>
  render(<ShelfFolder client={createShelfClient({ baseUrl: '/api/shelf', fetch: api.fetcher })} {...props} />);
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const siteCalls = (api: ReturnType<typeof fakeApi>) => api.calls.filter((c) => c.endsWith('/site'));

describe('document page', () => {
  it('(a) a PDF opens on Text: breadcrumb, eyebrow, title, tabs and the FULL TEXT card', async () => {
    const api = mount_(fakeApi());
    const { container } = api;
    await screen.findByText(/This pet application forms part/);
    const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
    await waitFor(() => expect(Array.from(crumbs.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Aisle CMS', 'Contracts']));
    expect(container.querySelector('.shelf-sdk__section-eyebrow')?.textContent).toBe('PDF · 581.2 KB');
    const h1 = container.querySelector('h1.shelf-sdk__section-title');
    expect(h1?.textContent).toBe(NAME);
    expect(tabNames()).toEqual(['Text', 'Preview']);
    const tablist = screen.getByRole('tablist', { name: 'View' });
    expect(tablist.className).toBe('shelf-sdk__shelf-tabs shelf-sdk__doc-tabs');
    expect(within(tablist).getByRole('tab', { name: 'Text' }).getAttribute('aria-selected')).toBe('true');
    expect(within(tablist).getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('false');
    const card = container.querySelector('.shelf-sdk__doc-panel.shelf-sdk__doc-text-panel');
    expect(card?.querySelector('h2.shelf-sdk__kicker')?.textContent).toBe('Full text');
    expect(card?.querySelector('pre.shelf-sdk__doc-text')?.textContent).toBe(TEXT);
    expect(screen.getByText('Pages').nextElementSibling?.textContent).toBe('2');
    // No site for this document: no Content tab and no site request.
    expect(siteCalls(api.api)).toEqual([]);
  });

  it('Copy puts the text on the clipboard', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    mount(fakeApi(), { initialDocumentId: 'd1' });
    fireEvent.click(await screen.findByRole('button', { name: 'Copy' }));
    await screen.findByText('Copied the text.');
    expect(write).toHaveBeenCalledWith(TEXT);
  });

  it('(b) Preview reads the original lazily and shows a PDF in the viewer, typed as a PDF', async () => {
    const api = fakeApi();
    mount(api, { initialDocumentId: 'd1' });
    await screen.findByText(/This pet application forms part/);
    expect(api.calls.some((c) => c.includes('/original/'))).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Preview' }));
    const frame = (await screen.findByTitle(NAME)) as HTMLIFrameElement;
    expect(frame.className).toBe('shelf-sdk__doc-frame');
    expect(frame.getAttribute('src')).toMatch(/^blob:doc-\d+#view=FitH&navpanes=0$/);
    expect(frame.hasAttribute('sandbox')).toBe(false);
    expect(api.calls.filter((c) => c.includes('/original/'))).toEqual([`GET /files/d1/original/${encodeURIComponent(NAME)}`]);
    expect(screen.getByRole('tab', { name: 'Preview' }).getAttribute('aria-selected')).toBe('true');
  });

  it('Preview of an image shows the cached thumbnail first, with a size choice', async () => {
    const api = fakeApi({ doc: detail({ filename: 'scan.png', content_type: 'image/png' }), files: [row({ filename: 'scan.png', content_type: 'image/png' })] });
    const { container } = mount(api, { initialDocumentId: 'd1' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    const group = screen.getByRole('group', { name: 'Image size' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Small', 'Medium', 'Large', 'Original']);
    fireEvent.click(within(group).getByText('Medium'));
    expect(api.calls.some((c) => c.endsWith('/thumbnail'))).toBe(true);
  });

  it('Preview of a Word file falls back to a Download card', async () => {
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const api = fakeApi({ doc: detail({ filename: 'notes.docx', content_type: docx }), files: [row({ filename: 'notes.docx', content_type: docx })] });
    const { container } = mount(api, { initialDocumentId: 'd1' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    expect(container.querySelector('.shelf-sdk__preview-placeholder')?.textContent).toContain("Browsers can't display Word or Excel files");
    expect(screen.getByRole('button', { name: 'Download notes.docx' })).toBeTruthy();
    expect(api.calls.some((c) => c.includes('/original/'))).toBe(false);
  });

  it('(c) a document with a site gets a Content tab that draws the spec', async () => {
    const api = fakeApi({ doc: detail({ has_site: true }), siteBody: site() });
    const { container } = mount(api, { initialDocumentId: 'd1' });
    await screen.findByText(/This pet application forms part/);
    await waitFor(() => expect(tabNames()).toEqual(['Text', 'Preview', 'Content']));
    fireEvent.click(screen.getByRole('tab', { name: 'Content' }));
    await screen.findByRole('heading', { name: 'Corner Cafe receipt' });
    expect(container.querySelector('.shelf-sdk__docsite .shelf-sdk__docsite-hero .shelf-sdk__kicker')?.textContent).toBe('Receipt');
    expect(screen.getByText('A-1042')).toBeTruthy();
    expect(container.querySelector('.shelf-sdk__on-this-page')).toBeTruthy();
    expect(siteCalls(api)).toEqual(['GET /files/d1/site']);
    // Switching back keeps the document readable.
    fireEvent.click(screen.getByRole('tab', { name: 'Text' }));
    expect(container.querySelector('pre.shelf-sdk__doc-text')?.textContent).toBe(TEXT);
  });

  it('(c) a document without a site has no Content tab and never asks for one', async () => {
    const api = fakeApi({ doc: detail({ has_site: false }), siteBody: site() });
    mount(api, { initialDocumentId: 'd1' });
    await screen.findByText(/This pet application forms part/);
    expect(tabNames()).toEqual(['Text', 'Preview']);
    expect(siteCalls(api)).toEqual([]);
  });

  it('(d) a read key sees Download only; a read_write key also gets the pencil, Move and Delete', async () => {
    const read = mount(fakeApi({ access: 'read' }), { initialDocumentId: 'd1' });
    await screen.findByText(/This pet application forms part/);
    expect(screen.queryByLabelText('Edit name')).toBeNull();
    fireEvent.click(screen.getByLabelText(`Actions for ${NAME}`));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Download']);
    read.unmount();

    mount(fakeApi({ access: 'read_write' }), { initialDocumentId: 'd1' });
    await screen.findByText(/This pet application forms part/);
    await screen.findByLabelText('Edit name');
    fireEvent.click(screen.getByLabelText(`Actions for ${NAME}`));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Move to…', 'Download', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByText(`Move ${NAME} to the Shelf trash? You can restore it in Shelf.`)).toBeTruthy();
  });

  describe('(e) site status', () => {
    const open = async (siteBody: object) => {
      const api = fakeApi({ doc: detail({ has_site: true }), siteBody });
      const view = mount(api, { initialDocumentId: 'd1' });
      await screen.findByText(/This pet application forms part/);
      return { api, ...view };
    };

    it('building without a spec says so', async () => {
      await open(site({ status: 'building', spec: null }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
      await screen.findByText(/Building this page/);
    });

    it('building with the last good spec shows it as Updating', async () => {
      await open(site({ status: 'building' }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
      await screen.findByText('Updating…');
      expect(screen.getByRole('heading', { name: 'Corner Cafe receipt' })).toBeTruthy();
    });

    it('failed without a spec hides the tab', async () => {
      const { api } = await open(site({ status: 'failed', spec: null, error_code: 'build_failed', error: 'x' }));
      await waitFor(() => expect(siteCalls(api).length).toBe(1));
      await waitFor(() => expect(tabNames()).toEqual(['Text', 'Preview']));
    });

    it('failed with the last good spec still shows it; stale notes it may be out of date', async () => {
      await open(site({ status: 'failed', error_code: 'build_failed' }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
      await screen.findByRole('heading', { name: 'Corner Cafe receipt' });
      cleanup();
      await open(site({ stale: true }));
      fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
      await screen.findByText(/may be out of date/);
    });

    it('a 404 from the site route hides the tab', async () => {
      const api = fakeApi({ doc: detail({ has_site: true }), siteBody: null });
      mount(api, { initialDocumentId: 'd1' });
      await screen.findByText(/This pet application forms part/);
      await waitFor(() => expect(siteCalls(api).length).toBe(1));
      await waitFor(() => expect(tabNames()).toEqual(['Text', 'Preview']));
    });
  });

  describe('(f) navigation', () => {
    it('opening and closing a document reports where the host should point its URL', async () => {
      const onNavigate = vi.fn();
      mount(fakeApi({ files: [row({ folder_id: ROOT })], doc: detail({ folder_id: ROOT }) }), { onNavigate });
      fireEvent.click(await screen.findByText(NAME));
      await screen.findByText(/This pet application forms part/);
      expect(onNavigate).toHaveBeenLastCalledWith({ folderId: ROOT, documentId: 'd1' });
      fireEvent.click(screen.getByText('Back to Aisle CMS'));
      expect(onNavigate).toHaveBeenLastCalledWith({ folderId: ROOT, documentId: null });
      await screen.findByText(NAME);
    });

    it('the breadcrumb navigates inside the embed', async () => {
      const onNavigate = vi.fn();
      mount(fakeApi(), { initialDocumentId: 'd1', onNavigate });
      await screen.findByText(/This pet application forms part/);
      const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
      await waitFor(() => expect(within(crumbs).getByText('Contracts')).toBeTruthy());
      fireEvent.click(within(crumbs).getByText('Aisle CMS'));
      expect(onNavigate).toHaveBeenLastCalledWith({ folderId: ROOT, documentId: null });
      await waitFor(() => expect(screen.queryByText(/This pet application forms part/)).toBeNull());
    });

    it('a controlled documentId is the host\'s to change', async () => {
      const onNavigate = vi.fn();
      const client = createShelfClient({ baseUrl: '/api/shelf', fetch: fakeApi().fetcher });
      const { rerender } = render(<ShelfFolder client={client} documentId={null} onNavigate={onNavigate} />);
      fireEvent.click(await screen.findByText(NAME));
      // The host has not accepted it yet: still the folder.
      expect(onNavigate).toHaveBeenLastCalledWith({ folderId: ROOT, documentId: 'd1' });
      expect(screen.queryByText(/This pet application forms part/)).toBeNull();
      rerender(<ShelfFolder client={client} documentId="d1" onNavigate={onNavigate} />);
      await screen.findByText(/This pet application forms part/);
      rerender(<ShelfFolder client={client} documentId={null} onNavigate={onNavigate} />);
      await screen.findByText('Documents');
    });

    it('initialDocumentId deep-links into the document\'s own folder', async () => {
      mount(fakeApi(), { initialDocumentId: 'd1' });
      await screen.findByText(/This pet application forms part/);
      const crumbs = screen.getByRole('navigation', { name: 'Folder path' });
      await waitFor(() => expect(within(crumbs).getByText('Contracts')).toBeTruthy());
    });
  });

  it('(g) a hostile spec renders inert', async () => {
    const hostile = {
      version: 1,
      generated_at: '2026-10-08T09:00:04Z',
      source: { text_hash: 'sha256:' + 'a'.repeat(64) },
      blocks: [
        // Markup in a block is refused by the validator (the block is skipped); what is accepted is drawn as text.
        { type: 'hero', props: { title: '<script>window.__pwned = 1</script>', kind: 'Receipt' } },
        { type: 'summary', props: { text: '<img src=x onerror="window.__pwned=2"> javascript:window.__pwned=3' } },
        { type: 'key_facts', props: { items: [{ label: 'Link', value: 'javascript:alert(1)' }, { label: 'Data', value: 'data:text/html,hello' }] } },
        { type: 'parties', props: { from: { name: 'onerror=window.__pwned=4', lines: ['vbscript:msgbox(1)'] } } },
        { type: 'source', props: { note: 'javascript:alert(2)' } },
        { type: 'unknown_block', props: { html: '<script>alert(1)</script>' } },
      ],
    };
    const api = fakeApi({ doc: detail({ has_site: true }), siteBody: site({ spec: hostile }) });
    const { container } = mount(api, { initialDocumentId: 'd1' });
    fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
    await screen.findByText('javascript:alert(1)');
    const root = container.querySelector('.shelf-sdk__docsite') as HTMLElement;
    expect(root.querySelector('script, iframe, img, b, object, embed, style, form')).toBeNull();
    expect(root.innerHTML).not.toMatch(/<script/i);
    expect(root.innerHTML).not.toMatch(/href="(javascript|data|vbscript):/i);
    expect(root.textContent).not.toContain('window.__pwned = 1'); // the block with markup was skipped
    expect(root.textContent).toContain('data:text/html,hello'); // plain text, not a link
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
    // The only link out is the app's own original route, never anything from the spec.
    const links = Array.from(root.querySelectorAll('a')).map((a) => a.getAttribute('href'));
    expect(links.length).toBeGreaterThan(0);
    for (const href of links) expect(href).toMatch(/^\/api\/shelf\/files\/d1\/original\//);
  });
});

function mount_(api: ReturnType<typeof fakeApi>) {
  return { ...mount(api, { initialDocumentId: 'd1' }), api };
}
