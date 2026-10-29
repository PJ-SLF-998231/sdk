// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { ShelfError } from '../src';
import type { ShelfClient } from '../src';
import type { ShelfItem } from '../src';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: ['small', 'medium', 'large'], ...o,
});

function mock(access: 'read' | 'read_write', over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const c = {
    info: vi.fn(async () => ({ access })),
    folders: vi.fn(async () => [
      { id: 'root', name: 'Aisle CMS', parent_id: null },
      { id: 'sub', name: 'Contracts', parent_id: 'root' },
    ]),
    listFiles: vi.fn(async (p?: { folder_id?: string; recursive?: boolean }) =>
      p?.recursive
        ? { items: [item(), item({ id: 'f2', filename: 'notes.docx', content_type: DOCX, preview_sizes: [] }), item({ id: 'f9', filename: 'deep.txt', preview_sizes: [], folder_id: 'sub' })], next_cursor: null }
        : p?.folder_id === 'sub'
          ? { items: [item({ id: 'f9', filename: 'deep.txt', preview_sizes: [], folder_id: 'sub' })], next_cursor: null }
          : { items: [item(), item({ id: 'f2', filename: 'notes.docx', content_type: DOCX, preview_sizes: [] })], next_cursor: null }),
    getFile: vi.fn(async (id: string) => ({ ...item({ id }), parsed_text: 'hello parsed text' })),
    upload: vi.fn(async () => item()),
    updateFile: vi.fn(async (id: string, patch: object) => ({ ...item({ id }), ...patch })),
    deleteFile: vi.fn(async () => undefined),
    thumbnailUrl: (id: string, size?: string) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
    ...over,
  };
  return c as unknown as ShelfClient & typeof c;
}

describe('ShelfFolder', () => {
  it('lists subfolders and files with thumbnail or type badge', async () => {
    const client = mock('read');
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    expect(screen.getByText('Contracts')).toBeTruthy();
    // The read path passes an abort signal as the second argument now.
    expect(client.listFiles).toHaveBeenCalledWith(expect.objectContaining({ folder_id: 'root', recursive: false }), expect.anything());
    await waitFor(() => expect(container.querySelector('img[src="/t/f1?size=medium"]')).toBeTruthy());
    expect(container.querySelector('.shelf-sdk__file-card-type')?.textContent).toBe('DOCX');
    expect(screen.getAllByText(/^2\.0 KB · PDF$/).length).toBe(1);
  });

  it('opens a subfolder and shows breadcrumb', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('Contracts'));
    await screen.findByText('deep.txt');
    const nav = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(nav).getByText('Aisle CMS').getAttribute('aria-current')).toBeNull();
    expect(within(nav).getByText('Contracts').getAttribute('aria-current')).toBe('page');
    fireEvent.click(within(nav).getByText('Aisle CMS'));
    await screen.findByText('plan.pdf');
  });

  it('pages with Load more', async () => {
    const client = mock('read', {
      listFiles: vi.fn(async (p?: { cursor?: string; recursive?: boolean }) =>
        p?.recursive
          ? { items: [], next_cursor: null }
          : p?.cursor
            ? { items: [item({ id: 'f3', filename: 'page2.pdf' })], next_cursor: null }
            : { items: [item()], next_cursor: 'c1' }),
    });
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('Load more'));
    await screen.findByText('page2.pdf');
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('document view shows details, text, preview and download link', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');
    const panel = screen.getByRole('region', { name: 'Document details' });
    expect(within(panel).getByRole('heading', { level: 1 }).textContent).toBe('plan.pdf');
    expect(within(panel).getByText('Location').nextElementSibling?.textContent).toBe('Aisle CMS');
    expect(within(panel).getByText('Status').nextElementSibling?.textContent).toBe('Ready');
    fireEvent.click(within(panel).getByRole('tab', { name: 'Preview' }));
    // A PDF is shown from its original route in the browser's viewer (this client has no original() to read bytes with).
    expect(within(panel).getByTitle('plan.pdf').getAttribute('src')).toBe('/o/f1/plan.pdf#view=FitH&navpanes=0');
    // Download sits in the menu, as on Shelf web, and saves the original under its name.
    const saved: Array<{ href: string; download: string }> = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      saved.push({ href: this.getAttribute('href') ?? '', download: this.download });
    });
    fireEvent.click(within(panel).getByLabelText('Actions for plan.pdf'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download' }));
    await waitFor(() => expect(saved).toEqual([{ href: '/o/f1/plan.pdf', download: 'plan.pdf' }]));
    fireEvent.click(within(panel).getByText('Back to Aisle CMS'));
    await screen.findByText('notes.docx');
  });

  it('read-only key hides every write control', async () => {
    render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    expect(screen.queryByText('Add documents')).toBeNull();
    expect(screen.queryByLabelText('Upload files')).toBeNull();
    expect(screen.queryByText(/Drop documents here/)).toBeNull();
    expect(screen.queryByLabelText(/^Actions for/)).toBeNull();
    fireEvent.click(screen.getByText('plan.pdf'));
    await screen.findByText('hello parsed text');
    // The document's menu holds Download only: no pencil, no Move, no Delete.
    expect(screen.queryByLabelText('Edit name')).toBeNull();
    fireEvent.click(screen.getByLabelText('Actions for plan.pdf'));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Download']);
    for (const label of ['Rename', 'Move to…', 'Delete']) expect(screen.queryByText(label)).toBeNull();
  });

  it('offers no folder actions the integration API cannot do', async () => {
    render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('Contracts');
    expect(screen.queryByText('New folder')).toBeNull();
    expect(screen.queryByLabelText(/Actions for Contracts/)).toBeNull();
    expect(screen.queryByLabelText(/Actions for shelf|Actions for folder/)).toBeNull();
    // Documents do get a menu: rename, move and delete are real routes.
    fireEvent.click(await screen.findByLabelText('Actions for plan.pdf')); // write controls arrive with the lazy outbox chunk
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Move to…', 'Delete']);
  });

  it('shows header counts, folder captions and the drop hint', async () => {
    const { container } = render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toBe('3 items · 2 folders'));
    expect(container.querySelector('.shelf-sdk__folder-tile .shelf-sdk__card-meta')?.textContent).toBe('1 item');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__dropzone-limits')?.textContent?.replace(/ /g, ' ')).toBe(
      'Drop documents here to add them to Aisle CMS · PDF, Word, Excel, text, Markdown, JSON, or scans and photos of documents · up to 25 MB',
    ));
  });

  it('omits counts it cannot verify', async () => {
    const client = mock('read', {
      listFiles: vi.fn(async (p?: { recursive?: boolean }) => {
        if (p?.recursive) throw new ShelfError(500, 'boom', 'x');
        return { items: [item()], next_cursor: null };
      }),
    });
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toBe('2 folders');
    expect(container.querySelector('.shelf-sdk__folder-tile .shelf-sdk__card-meta')).toBeNull();
  });

  it('uploads via picker and drop into the current folder', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    const file = new File(['x'], 'new.pdf', { type: 'application/pdf' });
    fireEvent.change(await screen.findByLabelText('Upload files'), { target: { files: [file] } });
    // Uploads go through the outbox: a Blob of the bytes, the file name and an idempotency client_ref.
    await waitFor(() => expect(client.upload).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ filename: 'new.pdf', folder_id: 'root', client_ref: expect.any(String) }), expect.anything()));
    const dropped = new File(['y'], 'drop.pdf');
    fireEvent.drop(screen.getByTestId('shelf-dropzone'), { dataTransfer: { files: [dropped] } });
    await waitFor(() => expect(client.upload).toHaveBeenCalledWith(expect.any(Blob), expect.objectContaining({ filename: 'drop.pdf', folder_id: 'root' }), expect.anything()));
    await waitFor(() => expect(vi.mocked(client.listFiles).mock.calls.filter(([p]) => p?.recursive === false)).toHaveLength(3));
  });

  it('marks the drop zone while files are dragged over it', async () => {
    render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('plan.pdf');
    const zone = screen.getByTestId('shelf-dropzone');
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'] } });
    expect(zone.getAttribute('data-drop')).toBe('valid');
    fireEvent.dragLeave(zone, { relatedTarget: null });
    expect(zone.getAttribute('data-drop')).toBeNull();
  });

  it('shows failed cards for 413 and 415', async () => {
    const client = mock('read_write', {
      upload: vi.fn(async (f: File) => {
        throw f.name === 'big.pdf' ? new ShelfError(413, 'too_large', 'x') : new ShelfError(415, 'bad_type', 'x');
      }),
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    fireEvent.change(await screen.findByLabelText('Upload files'), {
      target: { files: [new File(['x'], 'big.pdf'), new File(['x'], 'odd.exe')] },
    });
    await screen.findByText('big.pdf');
    await waitFor(() => expect(screen.getAllByText('Failed')).toHaveLength(2));
    expect(screen.getByText('odd.exe')).toBeTruthy();
    expect(screen.getAllByText('Discard')).toHaveLength(2);
  });

  it('renames and moves from the document view, deletes from a card menu', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');

    // Rename is the pencil beside the menu, as on Shelf web.
    fireEvent.click(await screen.findByLabelText('Edit name'));
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'renamed.pdf' } });
    fireEvent.click(screen.getByText('Save name'));
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledWith('f1', { filename: 'renamed.pdf' }, expect.anything()));
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('renamed.pdf'));

    fireEvent.click(await screen.findByLabelText('Actions for renamed.pdf'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Move to…' }));
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: 'sub' } });
    fireEvent.click(screen.getByText('Move here'));
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledWith('f1', { folder_id: 'sub' }, expect.anything()));
    await screen.findByText('notes.docx');
    expect(screen.queryByText('renamed.pdf')).toBeNull();

    fireEvent.click(await screen.findByLabelText('Actions for notes.docx'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' }).textContent).toMatch(/^Move .+ to the Shelf trash\? You can restore it in Shelf\.Confirm deleteCancel/);
    expect(client.deleteFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(client.deleteFile).toHaveBeenCalledWith('f2', expect.anything()));
    await waitFor(() => expect(screen.queryByText('notes.docx')).toBeNull());
  });

  it('shows "Shelf isn\'t connected" on not_configured', async () => {
    const client = mock('read', { info: vi.fn(async () => { throw new ShelfError(503, 'not_configured', 'nope'); }) });
    render(<ShelfFolder client={client} />);
    await screen.findByText("Shelf isn't connected");
    expect(client.listFiles).not.toHaveBeenCalled();
  });

  it('applies theme and className on the scoped root', async () => {
    const { container } = render(<ShelfFolder client={mock('read')} theme="dark" className="mine" />);
    await screen.findByText('plan.pdf');
    const root = container.firstElementChild!;
    expect(root.className).toBe('shelf-sdk mine');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  it('initialFolderId opens that folder as the top of the breadcrumb', async () => {
    render(<ShelfFolder client={mock('read')} initialFolderId="sub" />);
    await screen.findByText('deep.txt');
    const nav = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(nav).getAllByRole('button').map((b) => b.textContent)).toEqual(['Contracts']);
  });

  it('every class it renders is prefixed, so host CSS cannot match it', async () => {
    const { container } = render(<ShelfFolder client={mock('read_write')} className="mine" />);
    await screen.findByText('plan.pdf');
    fireEvent.click(await screen.findByLabelText('Actions for plan.pdf'));
    for (const el of Array.from(container.querySelectorAll('[class]'))) {
      for (const c of Array.from(el.classList)) expect(c === 'shelf-sdk' || c === 'mine' || c.startsWith('shelf-sdk__'), c).toBe(true);
    }
  });
});

describe('layout and folder-tree preferences', () => {
  it('Gallery is the default; List is remembered in localStorage across mounts', async () => {
    const first = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    const group = screen.getByRole('group', { name: 'Layout' });
    expect(within(group).getByRole('button', { name: 'Gallery' }).getAttribute('aria-pressed')).toBe('true');
    expect(first.container.querySelector('table')).toBeNull();
    fireEvent.click(within(group).getByRole('button', { name: 'List' }));
    expect(window.localStorage.getItem('shelf-sdk.layout')).toBe('list');
    expect(first.container.querySelector('table.shelf-sdk__item-list')).toBeTruthy();
    first.unmount();

    const second = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    expect(second.container.querySelector('table.shelf-sdk__item-list')).toBeTruthy();
    const g2 = screen.getByRole('group', { name: 'Layout' });
    expect(within(g2).getByRole('button', { name: 'List' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(g2).getByRole('button', { name: 'Gallery' }));
    expect(window.localStorage.getItem('shelf-sdk.layout')).toBe('grid');
  });

  it('still works when localStorage throws (private window, locked-down host)', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    const { container } = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    expect(container.querySelector('table')).toBeNull(); // falls back to Gallery
    fireEvent.click(screen.getByRole('button', { name: 'List' }));
    expect(container.querySelector('table.shelf-sdk__item-list')).toBeTruthy(); // toggles anyway
    fireEvent.click(screen.getByRole('button', { name: 'Show folders' }));
    expect(screen.getByRole('navigation', { name: 'Folders in Aisle CMS' })).toBeTruthy();
  });

  it('the folder icon button opens the folder tree, and the choice is remembered', async () => {
    const first = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    expect(screen.queryByRole('navigation', { name: 'Folders in Aisle CMS' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show folders' }));
    const tree = screen.getByRole('navigation', { name: 'Folders in Aisle CMS' });
    expect(window.localStorage.getItem('shelf-sdk.folderTree')).toBe('open');
    fireEvent.click(within(tree).getByRole('button', { name: /Contracts/ }));
    await screen.findAllByText('deep.txt'); // in the gallery and, under Contracts, in the tree
    first.unmount();
    render(<ShelfFolder client={mock('read')} />);
    await screen.findByRole('navigation', { name: 'Folders in Aisle CMS' });
    expect(screen.getByRole('navigation', { name: 'Folders in Aisle CMS' })).toBeTruthy();
  });
});
