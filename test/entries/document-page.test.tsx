// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { DocumentContentTab, DocumentPage, DocumentPreviewTab, DocumentTextTab } from '../../src/entries/document-page';
import { ShelfFolder } from '../../src/react';
import { ShelfProvider } from '../../src/react/ShelfProvider';
import { disposeAllSessions } from '../../src/react/session';
import receipt from '../fixtures/site-receipt.json';
import { LAZY_TIMEOUT, POLL_TIMEOUT } from '../asyncTimeouts';
import { freshDb, item, mock } from '../react/helpers';

beforeEach(() => {
  freshDb();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

const TEXT = 'PET APPLICATION\nThis pet application forms part of the Conduct Rules.';
const detail = (o: object = {}) => ({ ...item({ id: 'd1', filename: 'rules.pdf', preview_sizes: ['small', 'medium', 'large'] }), parsed_text: TEXT, parsed_meta: { page_count: 2 }, has_site: false, ...o });
const readySite = { file_id: 'd1', status: 'ready', stale: false, error_code: null, error: null, spec: receipt };
const withSite = (o: object = {}) => mock({ getFile: vi.fn(async () => detail({ has_site: true, ...o })), getSite: vi.fn(async () => readySite) });
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const IMG = { filename: 'scan.png', content_type: 'image/png' };

describe('DocumentTextTab', () => {
  it('shows the text with Copy and needs no session', () => {
    const { container } = render(<DocumentTextTab text={TEXT} />);
    expect(container.querySelector('.shelf-sdk')).toBeTruthy();
    expect(container.querySelector('pre.shelf-sdk__doc-text')?.textContent).toBe(TEXT);
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy();
  });

  it('says so while there is no text, and offers no Copy', () => {
    render(<DocumentTextTab text={undefined} />);
    expect(screen.getByText(/appears here once Shelf has read the file/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
  });

  it('Copy puts the text on the clipboard', async () => {
    const write = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: write }, configurable: true });
    render(<DocumentTextTab text={TEXT} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await screen.findByText('Copied the text.');
    expect(write).toHaveBeenCalledWith(TEXT);
  });
});

describe('DocumentPreviewTab', () => {
  it('shows the size bar by default and the image at the original size', async () => {
    const { container } = render(<DocumentPreviewTab document={detail(IMG)} client={mock()} />);
    await waitFor(() => expect(container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    const group = screen.getByRole('group', { name: 'Image size' });
    expect(Array.from(group.querySelectorAll('button')).map((b) => b.textContent)).toEqual(['Small', 'Medium', 'Large', 'Original']);
    expect(within(group).getByText('Original').getAttribute('aria-pressed')).toBe('true');
  });

  it('showPreviewSizes={false} hides the bar and keeps the image at the same default size, lazy-loaded', async () => {
    const withBar = render(<DocumentPreviewTab document={detail(IMG)} client={mock()} />);
    await waitFor(() => expect(withBar.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    const defaultSrc = withBar.container.querySelector('img')!.getAttribute('src');
    cleanup();
    const { container } = render(<DocumentPreviewTab document={detail(IMG)} client={mock()} showPreviewSizes={false} />);
    await waitFor(() => expect(container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Image size' })).toBeNull();
    expect(screen.queryByText('Original')).toBeNull();
    const img = container.querySelector('img')!;
    expect(img.getAttribute('src')).toBe(defaultSrc);
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(img.getAttribute('alt')).toBe('scan.png');
  });

  it('showPreviewSizes does not touch a PDF or a Word file', async () => {
    const { container } = render(<DocumentPreviewTab document={detail()} client={mock()} showPreviewSizes={false} />);
    expect(await screen.findByTitle('rules.pdf')).toBeTruthy();
    cleanup();
    const docx = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const w = render(<DocumentPreviewTab document={detail({ filename: 'a.docx', content_type: docx })} client={mock()} showPreviewSizes={false} />);
    expect(w.container.querySelector('.shelf-sdk__preview-placeholder')?.textContent).toContain("Browsers can't display Word or Excel files");
    expect(container).toBeTruthy();
  });

  it('takes its client from a ShelfProvider, and says when there is none', () => {
    render(<ShelfProvider client={mock()}><DocumentPreviewTab document={detail()} /></ShelfProvider>);
    expect(screen.getByTitle('rules.pdf')).toBeTruthy();
    cleanup();
    render(<DocumentPreviewTab document={detail()} />);
    expect(screen.getByRole('alert').textContent).toContain("Shelf isn't connected");
  });
});

describe('DocumentContentTab', () => {
  it('draws the document site (a lazy chunk) for a document with one', async () => {
    const client = withSite();
    const { container } = render(<DocumentContentTab documentId="d1" client={client} hasSite />);
    await waitFor(() => expect(container.querySelector('.shelf-sdk__doc-site-panel')).toBeTruthy());
    await screen.findByText('Corner Cafe receipt');
    expect(client.getSite).toHaveBeenCalled();
  });

  it('hasSite={false} renders nothing and asks for neither the document nor the site', async () => {
    const client = withSite();
    const { container } = render(<DocumentContentTab documentId="d1" client={client} hasSite={false} />);
    await new Promise((r) => setTimeout(r, 40));
    expect(container.querySelector('.shelf-sdk')?.children.length).toBe(0);
    expect(client.getSite).not.toHaveBeenCalled();
    expect(client.getFile).not.toHaveBeenCalled();
  });

  it('without hasSite it reads the document first and never asks for the site of one that has none', async () => {
    const client = mock();
    const { container } = render(<DocumentContentTab documentId="d1" client={client} />);
    await waitFor(() => expect(client.getFile).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 40));
    expect(client.getSite).not.toHaveBeenCalled();
    expect(container.querySelector('.shelf-sdk')?.children.length).toBe(0);
  });
});

describe('DocumentPage (connected)', () => {
  it('with a client and a documentId renders the eyebrow, title and text', async () => {
    const { container } = render(<DocumentPage documentId="d1" client={mock({ getFile: vi.fn(async () => detail()) })} location="Aisle CMS / Contracts" folderName="Contracts" />);
    await screen.findByText(/This pet application forms part/);
    expect(container.querySelector('.shelf-sdk')).toBeTruthy();
    expect(container.querySelector('.shelf-sdk__section-eyebrow')?.textContent).toBe('PDF · 2.0 KB');
    expect(container.querySelector('h1.shelf-sdk__section-title')?.textContent).toBe('rules.pdf');
    expect(screen.getByText('Location').nextElementSibling?.textContent).toBe('Aisle CMS / Contracts');
    expect(tabNames()).toEqual(['Text', 'Preview']);
  });

  it('shows the listing record while the document loads', async () => {
    let release!: () => void;
    const client = mock({ getFile: vi.fn(() => new Promise((r) => { release = () => r(detail()); })) });
    render(<DocumentPage documentId="d1" client={client} initial={item({ id: 'd1', filename: 'rules.pdf' })} />);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('rules.pdf');
    expect(screen.getByText(/appears here once Shelf has read the file/)).toBeTruthy();
    release();
    await screen.findByText(/This pet application forms part/);
  });

  it('reads through a ShelfProvider and calls onClose', async () => {
    const onClose = vi.fn();
    render(<ShelfProvider client={mock({ getFile: vi.fn(async () => detail()) })}><DocumentPage documentId="d1" folderName="Contracts" onClose={onClose} /></ShelfProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Back to Contracts' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a read key (no actions) offers Download only; granted actions add the pencil, Move and Delete', async () => {
    const client = mock({ getFile: vi.fn(async () => detail()) });
    const r = render(<DocumentPage documentId="d1" client={client} />);
    await screen.findByText(/This pet application forms part/);
    expect(screen.queryByRole('button', { name: 'Edit name' })).toBeNull();
    fireEvent.click(screen.getByLabelText('Actions for rules.pdf'));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Download']);
    r.unmount();
    const actions = { rename: vi.fn(), move: vi.fn(), delete: vi.fn() };
    render(<DocumentPage documentId="d1" client={client} actions={actions} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Edit name' }));
    expect(actions.rename).toHaveBeenCalled();
    fireEvent.click(screen.getByLabelText('Actions for rules.pdf'));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Move to…', 'Download', 'Delete']);
  });

  it('without a client it says Shelf is not connected', () => {
    render(<DocumentPage documentId="d1" />);
    expect(screen.getByRole('alert').textContent).toContain("Shelf isn't connected");
  });

  it('showPreviewSizes: the bar is there by default and gone when false, the image stays', async () => {
    const client = mock({ getFile: vi.fn(async () => detail(IMG)) });
    const a = render(<DocumentPage documentId="d1" client={client} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(a.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.getByRole('group', { name: 'Image size' })).toBeTruthy();
    a.unmount();
    const b = render(<DocumentPage documentId="d1" client={client} showPreviewSizes={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(b.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Image size' })).toBeNull();
  });

  it('keeps polling while the site is building, even when every answer is the same', async () => {
    let n = 0;
    const client = mock({
      getFile: vi.fn(async () => detail({ has_site: true })),
      getSite: vi.fn(async () => (++n < 4 ? { file_id: 'd1', status: 'building', stale: false, error_code: null, error: null } : readySite)),
    });
    render(<DocumentPage documentId="d1" client={client} documentTabs={['content', 'text']} />);
    await screen.findByText(/Building this page/);
    expect(client.getSite).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.getSite).toHaveBeenCalledTimes(3), { timeout: POLL_TIMEOUT });
    await screen.findByText('Corner Cafe receipt', undefined, { timeout: LAZY_TIMEOUT });
    expect(client.getSite).toHaveBeenCalledTimes(4);
  }, 20000);
});

describe('ShelfFolder document page (the presentational view)', () => {
  it('keeps polling while the site is building, even when every answer is the same', async () => {
    let n = 0;
    const client = mock({
      getFile: vi.fn(async (id: string) => ({ ...item({ id, filename: 'plan.pdf' }), parsed_text: 'hello', has_site: true })),
      getSite: vi.fn(async () => (++n < 4 ? { file_id: 'f1', status: 'building', stale: false, error_code: null, error: null } : readySite)),
    });
    render(<ShelfFolder client={client} initialDocumentId="f1" />);
    await screen.findByText('hello');
    fireEvent.click(await screen.findByRole('tab', { name: 'Content' }));
    await screen.findByText(/Building this page/);
    await waitFor(() => expect(client.getSite).toHaveBeenCalledTimes(3), { timeout: POLL_TIMEOUT });
    await screen.findByText('Corner Cafe receipt', undefined, { timeout: LAZY_TIMEOUT });
  }, 20000);
});

describe('documentTabs', () => {
  const page = (client: ReturnType<typeof mock>, documentTabs?: readonly ('content' | 'preview' | 'text')[], extra: object = {}) =>
    render(<DocumentPage documentId="d1" client={client} documentTabs={documentTabs} {...extra} />);
  const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

  it('defaults to Text, Preview, Content', async () => {
    page(withSite());
    await screen.findByRole('tab', { name: 'Content' });
    expect(tabNames()).toEqual(['Text', 'Preview', 'Content']);
    expect(selected()).toEqual(['Text']);
  });

  it('sets the order', async () => {
    page(withSite(), ['content', 'preview', 'text']);
    await screen.findByRole('tab', { name: 'Content' });
    expect(tabNames()).toEqual(['Content', 'Preview', 'Text']);
  });

  it('sets the subset', async () => {
    page(withSite(), ['preview', 'text']);
    await screen.findByText(/This pet application forms part|appears here/).catch(() => undefined);
    expect(tabNames()).toEqual(['Preview', 'Text']);
    expect(screen.queryByRole('tab', { name: 'Content' })).toBeNull();
  });

  it('skips a listed Content tab when the document has no site', async () => {
    const client = mock({ getFile: vi.fn(async () => detail()) });
    page(client, ['content', 'preview', 'text']);
    await screen.findByRole('tab', { name: 'Preview' });
    expect(tabNames()).toEqual(['Preview', 'Text']);
    expect(client.getSite).not.toHaveBeenCalled();
  });

  it('opens on the first available tab: Content for a document with a site, Preview without', async () => {
    page(withSite(), ['content', 'preview', 'text']);
    await screen.findByText('Corner Cafe receipt');
    expect(selected()).toEqual(['Content']);
    cleanup();
    page(mock({ getFile: vi.fn(async () => detail()) }), ['content', 'preview', 'text']);
    expect(await screen.findByTitle('rules.pdf')).toBeTruthy();
    expect(selected()).toEqual(['Preview']);
  });

  it('falls back to Text when nothing listed applies', async () => {
    page(mock({ getFile: vi.fn(async () => detail()) }), ['content']);
    await screen.findByText(/This pet application forms part/);
    expect(tabNames()).toEqual(['Text', 'Preview']);
    cleanup();
    page(mock({ getFile: vi.fn(async () => detail()) }), []);
    await screen.findByText(/This pet application forms part/);
    expect(tabNames()).toEqual(['Text', 'Preview']);
  });

  it('a tab the reader picked stays until it goes away', async () => {
    page(withSite(), ['preview', 'text', 'content']);
    fireEvent.click(await screen.findByRole('tab', { name: 'Text' }));
    expect(selected()).toEqual(['Text']);
    fireEvent.click(screen.getByRole('tab', { name: 'Content' }));
    await screen.findByText('Corner Cafe receipt');
    expect(selected()).toEqual(['Content']);
  });

  it('arrow keys, Home and End follow the visual order and move focus', async () => {
    page(withSite(), ['content', 'preview', 'text']);
    await screen.findByText('Corner Cafe receipt');
    const list = screen.getByRole('tablist', { name: 'View' });
    const tab = (name: string) => screen.getByRole('tab', { name });
    tab('Content').focus();
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected()).toEqual(['Preview']);
    expect(document.activeElement).toBe(tab('Preview'));
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected()).toEqual(['Text']);
    fireEvent.keyDown(list, { key: 'ArrowRight' });
    expect(selected()).toEqual(['Content']);
    fireEvent.keyDown(list, { key: 'ArrowLeft' });
    expect(selected()).toEqual(['Text']);
    expect(document.activeElement).toBe(tab('Text'));
    fireEvent.keyDown(list, { key: 'Home' });
    expect(selected()).toEqual(['Content']);
    fireEvent.keyDown(list, { key: 'End' });
    expect(selected()).toEqual(['Text']);
    fireEvent.keyDown(list, { key: 'a' });
    expect(selected()).toEqual(['Text']);
  });

  it('does not change what the page reports to the host', async () => {
    const onClose = vi.fn();
    page(withSite(), ['content', 'preview', 'text'], { onClose, folderName: 'Contracts' });
    await screen.findByText('Corner Cafe receipt');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Contracts' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
