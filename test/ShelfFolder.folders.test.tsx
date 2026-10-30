// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { ShelfError } from '../src';
import type { ShelfClient, ShelfFolder as FolderRecord, ShelfItem } from '../src';
import { disposeAllSessions } from '../src/react/session';

const BASE = 'https://shelf.test/api';
const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: [], ...o,
});

const net = { offline: false };
const down = () => new TypeError('Failed to fetch');
const setOnline = (online: boolean) => {
  net.offline = !online;
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
};

/** A fake server with real folder semantics: the folders it holds change as writes land. */
function mock(access: 'read' | 'read_write', over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const server: FolderRecord[] = [
    { id: 'root', name: 'Aisle CMS', parent_id: null },
    { id: 'sub', name: 'Contracts', parent_id: 'root' },
    { id: 'deep', name: 'Signed', parent_id: 'sub' },
    { id: 'other', name: 'Reports', parent_id: 'root' },
  ];
  const landed: string[] = []; // POSTs that reached the server (not those a dropped connection refused)
  const gate = <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>) =>
    vi.fn(async (...a: A): Promise<R> => {
      if (net.offline) throw down();
      return fn(...a);
    });
  const c = {
    baseUrl: BASE,
    info: vi.fn(async () => ({ access })),
    folders: vi.fn(async () => server.map((f) => ({ ...f }))),
    listFiles: vi.fn(async () => ({ items: [item()], next_cursor: null })),
    getFile: gate(async (id: string) => ({ ...item({ id }), parsed_text: 'text' })),
    upload: gate(async () => item({ id: 'new' })),
    updateFile: gate(async (id: string, patch: object) => ({ ...item({ id }), ...patch })),
    deleteFile: gate(async () => undefined),
    createFolder: gate(async (input: { name: string; parent_id?: string }) => {
      landed.push(input.name);
      const f = { id: 'srv-' + input.name, name: input.name, parent_id: input.parent_id ?? 'root' };
      server.push(f);
      return { ...f, item_count: 0, total_item_count: 0 };
    }),
    updateFolder: gate(async (id: string, patch: { name?: string; parent_id?: string }) => {
      const f = server.find((x) => x.id === id)!;
      Object.assign(f, patch);
      return { ...f };
    }),
    deleteFolder: gate(async (id: string) => {
      const at = server.findIndex((x) => x.id === id);
      if (at >= 0) server.splice(at, 1);
    }),
    thumbnailUrl: (id: string, size?: string | number) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
    ...over,
  };
  return Object.assign(c as unknown as ShelfClient & typeof c, { landed });
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  window.localStorage.clear();
  net.offline = false;
});
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

const newFolder = async () => fireEvent.click(await screen.findByRole('button', { name: 'New folder' }));
const submitForm = (label: string, name?: string) => {
  const input = screen.getByLabelText(label) as HTMLInputElement;
  if (name !== undefined) fireEvent.change(input, { target: { value: name } });
  fireEvent.submit(input.closest('form')!);
};
const openMenu = async (what: string, action: string) => {
  fireEvent.click(await screen.findByLabelText(`Actions for ${what}`));
  fireEvent.click(screen.getByRole('menuitem', { name: action }));
};
const tile = (name: string) => screen.getByRole('article', { name: `Folder ${name}` });

describe('ShelfFolder folder controls (read_write)', () => {
  it('New folder: appears at once with a Pending pill, then exactly one POST after the drain', async () => {
    let release!: () => void;
    const created = new Promise<void>((r) => (release = r));
    const client = mock('read_write');
    const original = client.createFolder!.bind(client);
    client.createFolder = vi.fn(async (...a: Parameters<typeof original>) => {
      await created;
      return original(...a);
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await newFolder();
    submitForm('New folder name', '  Invoices ');
    const card = await screen.findByRole('article', { name: 'Folder Invoices' });
    expect(within(card).getByText('Pending')).toBeTruthy();
    expect(screen.queryByLabelText('New folder name')).toBeNull(); // the form closed
    expect(within(card).queryByLabelText('Actions for folder Invoices')).toBeNull(); // a local folder has no menu
    await act(async () => release());
    await waitFor(() => expect(within(tile('Invoices')).queryByText('Pending')).toBeNull());
    await new Promise((r) => setTimeout(r, 150));
    expect(client.createFolder).toHaveBeenCalledTimes(1);
    expect(client.createFolder).toHaveBeenCalledWith({ name: 'Invoices', parent_id: 'root' }, expect.anything());
  });

  it('Escape cancels the form and sends nothing', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await newFolder();
    fireEvent.keyDown(screen.getByLabelText('New folder name'), { key: 'Escape' });
    expect(screen.queryByLabelText('New folder name')).toBeNull();
    expect(client.createFolder).not.toHaveBeenCalled();
  });

  it('a taken or empty name is an inline field error and sends nothing', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await newFolder();
    submitForm('New folder name', 'contracts');
    expect((await screen.findByRole('alert')).textContent).toBe('A folder named “contracts” is already there.');
    expect(screen.getByLabelText('New folder name').getAttribute('aria-invalid')).toBe('true');
    fireEvent.change(screen.getByLabelText('New folder name'), { target: { value: '' } });
    expect(screen.queryByRole('alert')).toBeNull(); // editing clears it
    submitForm('New folder name');
    expect((await screen.findByRole('alert')).textContent).toBe('Give the folder a name.');
    expect(client.createFolder).not.toHaveBeenCalled();
  });

  it('a create made offline survives a reload, cannot be opened, and is sent once on reconnect', async () => {
    const client = mock('read_write');
    const props = { client, cacheScope: 'user-1' } as const;
    const first = render(<ShelfFolder {...props} />);
    await screen.findByText('Contracts');
    await act(async () => setOnline(false));
    await newFolder();
    submitForm('New folder name', 'Drafts');
    await screen.findByRole('article', { name: 'Folder Drafts' });
    expect(client.createFolder).not.toHaveBeenCalled();
    first.unmount();
    disposeAllSessions(); // a page reload: only IndexedDB survives

    render(<ShelfFolder {...props} />);
    const card = await screen.findByRole('article', { name: 'Folder Drafts' });
    expect(within(card).getByText('Pending')).toBeTruthy();
    const listCalls = vi.mocked(client.listFiles).mock.calls.length;
    fireEvent.click(within(card).getByRole('button', { name: /^Drafts/ })); // cannot be opened until it has synced
    expect(screen.queryByRole('navigation', { name: 'Folder path' })?.textContent).toBe('Aisle CMS');
    expect(vi.mocked(client.listFiles).mock.calls.length).toBe(listCalls);

    await act(async () => setOnline(true));
    await waitFor(() => expect(within(tile('Drafts')).queryByText('Pending')).toBeNull());
    await new Promise((r) => setTimeout(r, 150));
    expect(client.landed).toEqual(['Drafts']); // a try while offline never reached the server
    fireEvent.click(within(tile('Drafts')).getByRole('button', { name: /^Drafts/ })); // now it opens
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('Aisle CMSDrafts'));
  });

  it('a refused create shows Failed with the server message, Retry and Discard', async () => {
    const client = mock('read_write', { createFolder: vi.fn(async () => { throw new ShelfError(409, 'conflict', 'Folders can’t be nested that deep.'); }) });
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await newFolder();
    submitForm('New folder name', 'Too deep');
    const card = await screen.findByRole('article', { name: 'Folder Too deep' });
    await waitFor(() => expect(within(card).getByText('Failed')).toBeTruthy());
    expect(within(card).getByText('Folders can’t be nested that deep.')).toBeTruthy();
    expect(within(card).getByText('Retry')).toBeTruthy();
    fireEvent.click(within(card).getByText('Discard'));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Folder Too deep' })).toBeNull());
  });

  it('Rename on a card is an inline form; the new name shows at once and is sent once', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await openMenu('folder Contracts', 'Rename');
    submitForm('Rename Contracts', 'Agreements');
    await screen.findByRole('article', { name: 'Folder Agreements' });
    await waitFor(() => expect(client.updateFolder).toHaveBeenCalledTimes(1));
    expect(client.updateFolder).toHaveBeenCalledWith('sub', { name: 'Agreements' }, expect.anything());
    await waitFor(() => expect(within(tile('Agreements')).queryByText('Pending')).toBeNull());
  });

  it('Rename to a sibling’s name is an inline error on that card', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await openMenu('folder Contracts', 'Rename');
    submitForm('Rename Contracts', 'Reports');
    expect((await within(tile('Contracts')).findByRole('alert')).textContent).toBe('A folder named “Reports” is already there.');
    expect(client.updateFolder).not.toHaveBeenCalled();
    fireEvent.keyDown(screen.getByLabelText('Rename Contracts'), { key: 'Escape' });
    expect(screen.queryByLabelText('Rename Contracts')).toBeNull();
  });

  it('Move to… offers neither the folder, nor what is below it, nor its parent; the move is sent once', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await openMenu('folder Contracts', 'Move to…');
    const select = (await screen.findByLabelText('Destination folder')) as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.textContent)).toEqual(['Aisle CMS / Reports']); // not Contracts, Signed (below it) or Aisle CMS (its parent)
    fireEvent.click(screen.getByText('Move here'));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Folder Contracts' })).toBeNull());
    await waitFor(() => expect(client.updateFolder).toHaveBeenCalledTimes(1));
    expect(client.updateFolder).toHaveBeenCalledWith('sub', { parent_id: 'other' }, expect.anything());
  });

  it('Delete asks with the exact wording, then hides the folder and sends one DELETE', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await openMenu('folder Contracts', 'Delete');
    const dialog = await screen.findByRole('alertdialog', { name: 'Confirm delete folder' });
    expect(dialog.textContent).toMatch(/^Move “Contracts” and everything in it to the Shelf trash\? You can restore it in Shelf\./);
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Folder Contracts' })).toBeNull());
    await waitFor(() => expect(client.deleteFolder).toHaveBeenCalledTimes(1));
    expect(client.deleteFolder).toHaveBeenCalledWith('sub', expect.anything());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Cancel on the delete dialog sends nothing', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await openMenu('folder Contracts', 'Delete');
    fireEvent.click(await screen.findByText('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(client.deleteFolder).not.toHaveBeenCalled();
  });

  it('the header menu belongs to the open folder; deleting it goes up to its parent', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    expect(screen.queryByLabelText('Actions for folder Aisle CMS')).toBeNull(); // the key's own folder
    fireEvent.click(within(tile('Contracts')).getByRole('button', { name: /^Contracts/ }));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('Aisle CMSContracts'));
    await openMenu('folder Contracts', 'Delete');
    expect((await screen.findByRole('alertdialog')).textContent).toMatch(/Move “Contracts” and everything in it/);
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('Aisle CMS'));
    await waitFor(() => expect(client.deleteFolder).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('article', { name: 'Folder Contracts' })).toBeNull();
  });

  it('the header menu renames the open folder inline', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} initialFolderId="sub" />);
    await screen.findByText('Signed');
    await openMenu('folder Contracts', 'Rename');
    submitForm('Rename Contracts', 'Deals');
    await waitFor(() => expect(client.updateFolder).toHaveBeenCalledWith('sub', { name: 'Deals' }, expect.anything()));
    await waitFor(() => expect(screen.getByRole('navigation', { name: 'Folder path' }).textContent).toBe('Deals'));
  });

  it('list layout: New folder is a row above the table and a folder row has the menu', async () => {
    window.localStorage.setItem('shelf-sdk:layout', 'list');
    const { LAYOUT_KEY } = await import('../src/react/ShelfFolder');
    window.localStorage.setItem(LAYOUT_KEY, 'list');
    const client = mock('read_write');
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await newFolder();
    expect(container.querySelector('.shelf-sdk__list-new-folder')).toBeTruthy();
    submitForm('New folder name', 'Listed');
    await screen.findByText('Listed');
    await openMenu('Contracts', 'Rename');
    expect(screen.getByLabelText('Rename Contracts')).toBeTruthy();
  });
});

describe('ShelfFolder folder controls are hidden', () => {
  it('for a read key: no New folder, no menus, same markup as before', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.queryByLabelText('Actions for folder Contracts')).toBeNull();
    expect(screen.queryByText('Pending')).toBeNull();
  });

  it('for the key’s own folder, even when the key is opened on a sub-folder', async () => {
    const client = mock('read_write', { info: vi.fn(async () => ({ access: 'read_write', root_folder_id: 'root' })) });
    render(<ShelfFolder client={client} />);
    await screen.findByText('Contracts');
    expect(screen.queryByLabelText('Actions for folder Aisle CMS')).toBeNull();
    expect(await screen.findByLabelText('Actions for folder Contracts')).toBeTruthy();
  });
});
