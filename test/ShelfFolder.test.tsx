// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { ShelfError } from '../src';
import type { ShelfClient } from '../src';
import type { ShelfItem } from '../src';

afterEach(cleanup);

const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'done', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: ['small', 'medium', 'large'], ...o,
});

function mock(access: 'read' | 'read_write', over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const c = {
    info: vi.fn(async () => ({ access })),
    folders: vi.fn(async () => [
      { id: 'root', name: 'Aisle CMS', parent_id: null },
      { id: 'sub', name: 'Contracts', parent_id: 'root' },
    ]),
    listFiles: vi.fn(async (p?: { folder_id?: string }) =>
      p?.folder_id === 'sub'
        ? { items: [item({ id: 'f9', filename: 'deep.txt', preview_sizes: [], folder_id: 'sub' })], next_cursor: null }
        : { items: [item(), item({ id: 'f2', filename: 'notes.docx', preview_sizes: [] })], next_cursor: null }),
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
  it('lists subfolders and files with thumbnail or extension badge', async () => {
    const client = mock('read');
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    expect(screen.getByText('Contracts')).toBeTruthy();
    expect(client.listFiles).toHaveBeenCalledWith(expect.objectContaining({ folder_id: 'root', recursive: false }));
    expect(container.querySelector('img[src="/t/f1?size=small"]')).toBeTruthy();
    expect(screen.getByText('docx')).toBeTruthy();
    expect(screen.getAllByText('2.0 KB').length).toBeTruthy();
  });

  it('opens a subfolder and shows breadcrumb', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('Contracts'));
    await screen.findByText('deep.txt');
    const nav = screen.getByRole('navigation', { name: 'Folder path' });
    expect(within(nav).getByText('Aisle CMS')).toBeTruthy();
    fireEvent.click(within(nav).getByText('Aisle CMS'));
    await screen.findByText('plan.pdf');
  });

  it('pages with Load more', async () => {
    const client = mock('read', {
      listFiles: vi.fn(async (p?: { cursor?: string }) =>
        p?.cursor ? { items: [item({ id: 'f3', filename: 'page2.pdf' })], next_cursor: null } : { items: [item()], next_cursor: 'c1' }),
    });
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('Load more'));
    await screen.findByText('page2.pdf');
    expect(screen.getByText('plan.pdf')).toBeTruthy();
    expect(screen.queryByText('Load more')).toBeNull();
  });

  it('document panel shows details, text, preview and download link', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');
    const panel = screen.getByRole('region', { name: 'Document details' });
    expect(within(panel).getByAltText('Preview of plan.pdf').getAttribute('src')).toBe('/t/f1?size=medium');
    const dl = within(panel).getByText('Download') as HTMLAnchorElement;
    expect(dl.getAttribute('href')).toBe('/o/f1/plan.pdf');
    expect(dl.hasAttribute('download')).toBe(true);
  });

  it('read-only key hides every write control', async () => {
    render(<ShelfFolder client={mock('read')} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');
    expect(screen.queryByLabelText('Upload files')).toBeNull();
    expect(screen.queryByTestId('shelf-dropzone')).toBeNull();
    for (const label of ['Rename', 'Move', 'Delete']) expect(screen.queryByText(label)).toBeNull();
    expect(screen.getByText('Download')).toBeTruthy();
  });

  it('uploads via picker and drop into the current folder', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    const file = new File(['x'], 'new.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
    await waitFor(() => expect(client.upload).toHaveBeenCalledWith(file, { folder_id: 'root' }));
    const dropped = new File(['y'], 'drop.pdf');
    fireEvent.drop(screen.getByTestId('shelf-dropzone'), { dataTransfer: { files: [dropped] } });
    await waitFor(() => expect(client.upload).toHaveBeenCalledWith(dropped, { folder_id: 'root' }));
    await waitFor(() => expect(client.listFiles).toHaveBeenCalledTimes(3));
  });

  it('shows inline errors for 413 and 415', async () => {
    const client = mock('read_write', {
      upload: vi.fn(async (f: File) => {
        throw f.name === 'big.pdf' ? new ShelfError(413, 'too_large', 'x') : new ShelfError(415, 'bad_type', 'x');
      }),
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    fireEvent.change(screen.getByLabelText('Upload files'), {
      target: { files: [new File(['x'], 'big.pdf'), new File(['x'], 'odd.exe')] },
    });
    await screen.findByText(/big\.pdf: the file is too large/);
    expect(screen.getByText(/odd\.exe: this file type is not supported/)).toBeTruthy();
  });

  it('renames, moves and deletes', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');

    fireEvent.click(screen.getByText('Rename'));
    fireEvent.change(screen.getByLabelText('New name'), { target: { value: 'renamed.pdf' } });
    fireEvent.click(screen.getByText('Save name'));
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledWith('f1', { filename: 'renamed.pdf' }));
    await waitFor(() => expect(screen.getAllByText('renamed.pdf').length).toBeGreaterThan(0));

    fireEvent.click(screen.getByText('Move'));
    fireEvent.change(screen.getByLabelText('Destination folder'), { target: { value: 'sub' } });
    fireEvent.click(screen.getByText('Move here'));
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledWith('f1', { folder_id: 'sub' }));
    await waitFor(() => expect(screen.queryByText('renamed.pdf')).toBeNull());

    fireEvent.click(screen.getByText('notes.docx'));
    await screen.findByText('hello parsed text');
    fireEvent.click(screen.getByText('Delete'));
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' }).textContent).toMatch(/^Move .+ to the Shelf trash\? You can restore it in Shelf\.Confirm delete/);
    expect(client.deleteFile).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(client.deleteFile).toHaveBeenCalledWith('f2'));
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
});
