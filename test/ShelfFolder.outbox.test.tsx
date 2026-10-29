// @vitest-environment jsdom
import 'fake-indexeddb/auto'; // globals: IDBKeyRange, ...
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShelfFolder } from '../src/react';
import { ShelfError } from '../src';
import type { ShelfClient, ShelfItem } from '../src';
import { disposeAllSessions } from '../src/react/session';

const BASE = 'https://shelf.test/api';
const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: [], ...o,
});

/** Network state of the fake client: while `net.offline`, every request fails like a dropped connection. */
const net = { offline: false };
const down = () => new TypeError('Failed to fetch');
const setOnline = (online: boolean) => {
  net.offline = !online;
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
};

function mock(access: 'read' | 'read_write', over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const gate = <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>) =>
    vi.fn(async (...a: A): Promise<R> => {
      if (net.offline) throw down();
      return fn(...a);
    });
  const c = {
    baseUrl: BASE,
    info: vi.fn(async () => ({ access })),
    folders: vi.fn(async () => [{ id: 'root', name: 'Aisle CMS', parent_id: null }, { id: 'sub', name: 'Contracts', parent_id: 'root' }]),
    listFiles: vi.fn(async () => ({ items: [item(), item({ id: 'f2', filename: 'notes.pdf' })], next_cursor: null })),
    getFile: gate(async (id: string) => ({ ...item({ id, filename: id === 'f2' ? 'notes.pdf' : 'plan.pdf' }), parsed_text: 'text' })),
    upload: gate(async (_f: Blob, o?: { filename?: string }) => item({ id: 'new-' + o?.filename, filename: o?.filename ?? 'x' })),
    updateFile: gate(async (id: string, patch: object) => ({ ...item({ id }), ...patch })),
    deleteFile: gate(async () => undefined),
    thumbnailUrl: (id: string, size?: string | number) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
    ...over,
  };
  return c as unknown as ShelfClient & typeof c;
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

const file = (name: string) => new File([name], name, { type: 'application/pdf' });
const pickFiles = async (...names: string[]) => fireEvent.change(await screen.findByLabelText('Upload files'), { target: { files: names.map(file) } });
const banner = () => screen.queryByTestId('shelf-outbox-banner');

async function rename(from: string, to: string) {
  fireEvent.click(await screen.findByLabelText(`Actions for ${from}`));
  fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
  fireEvent.change(await screen.findByLabelText('New name'), { target: { value: to } });
  fireEvent.click(screen.getByText('Save name'));
}

describe('ShelfFolder write path through the outbox', () => {
  it('offline rename shows the new name at once, pending, with the banner count; reconnecting sends it once', async () => {
    const client = mock('read_write');
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await act(async () => setOnline(false));
    await rename('plan.pdf', 'renamed.pdf');
    await screen.findByText('renamed.pdf');
    expect(screen.queryByText('plan.pdf')).toBeNull();
    expect(screen.getByText('Pending')).toBeTruthy();
    await waitFor(() => expect(banner()?.textContent).toMatch(/offline.*1 change /i));
    expect(client.updateFile).not.toHaveBeenCalled();

    await act(async () => setOnline(true));
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledTimes(1));
    expect(client.updateFile).toHaveBeenCalledWith('f1', { filename: 'renamed.pdf' }, expect.anything());
    await waitFor(() => expect(screen.queryByText('Pending')).toBeNull());
    expect(screen.getByText('renamed.pdf')).toBeTruthy();
    await waitFor(() => expect(banner()).toBeNull());
  });

  it('4 offline uploads show 4 pending cards at once, and at most 3 are in flight on reconnect', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const releases: Array<() => void> = [];
    const client = mock('read_write', {
      upload: vi.fn(async (_f: Blob, o?: { filename?: string }) => {
        if (net.offline) throw down();
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise<void>((r) => releases.push(r));
        inFlight--;
        return item({ id: 'new-' + o?.filename, filename: o?.filename ?? 'x' });
      }),
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await act(async () => setOnline(false));
    await pickFiles('a.pdf', 'b.pdf', 'c.pdf', 'd.pdf');
    await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(4));
    for (const n of ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']) expect(screen.getByText(n)).toBeTruthy();
    expect(banner()?.textContent).toMatch(/4 changes/);

    await act(async () => setOnline(true));
    await waitFor(() => expect(inFlight).toBe(3));
    await new Promise((r) => setTimeout(r, 100));
    expect(inFlight).toBe(3); // the fourth waits for a free slot
    await act(async () => releases.shift()!());
    // the 4th starts once a slot is free (it may still be in its backoff from the offline attempt)
    await waitFor(() => expect(releases.length).toBeGreaterThan(2), { timeout: 4000 });
    while (releases.length) await act(async () => releases.shift()!());
    await waitFor(() => expect(screen.queryByText('Pending')).toBeNull(), { timeout: 4000 });
    expect(maxInFlight).toBe(3);
    for (const n of ['a.pdf', 'b.pdf', 'c.pdf', 'd.pdf']) expect(screen.getByText(n)).toBeTruthy();
  });

  it('a 415 shows a failed card and Discard removes it', async () => {
    const client = mock('read_write', { upload: vi.fn(async () => { throw new ShelfError(415, 'unsupported', 'This file type is not supported'); }) });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await pickFiles('odd.exe');
    await screen.findByText('Failed');
    expect(screen.getByText('This file type is not supported')).toBeTruthy();
    expect(screen.getByText('Retry')).toBeTruthy();
    fireEvent.click(screen.getByText('Discard'));
    await waitFor(() => expect(screen.queryByText('odd.exe')).toBeNull());
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('a conflict shows its message', async () => {
    const client = mock('read_write', {
      getFile: vi.fn(async (id: string) => ({ ...item({ id, filename: 'theirs.pdf' }), parsed_text: 't' })),
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await rename('plan.pdf', 'mine.pdf');
    await screen.findByText('Conflict');
    expect(screen.getByText(/Renamed on the server to "theirs\.pdf"/)).toBeTruthy();
    expect(client.updateFile).not.toHaveBeenCalled();
    expect(screen.queryByText('Retry')).toBeNull(); // a conflict is a choice, not a retry
    expect(screen.getByText('Discard')).toBeTruthy();
    fireEvent.click(screen.getByText('Keep mine')); // forces the change over the server's value
    await waitFor(() => expect(client.updateFile).toHaveBeenCalledTimes(1));
    expect(client.updateFile).toHaveBeenCalledWith('f1', expect.objectContaining({ filename: 'mine.pdf' }), expect.anything());
  });

  it('Discard on a conflict keeps the server value and sends nothing', async () => {
    const client = mock('read_write', {
      getFile: vi.fn(async (id: string) => ({ ...item({ id, filename: 'theirs.pdf' }), parsed_text: 't' })),
    });
    render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await rename('plan.pdf', 'mine.pdf');
    await screen.findByText('Conflict');
    fireEvent.click(screen.getByText('Discard'));
    await waitFor(() => expect(screen.queryByText('Conflict')).toBeNull());
    expect(client.updateFile).not.toHaveBeenCalled();
    expect(screen.queryByText('mine.pdf')).toBeNull();
  });

  it('unmount and remount with the same scope keeps the upload listed, then drains it', async () => {
    const client = mock('read_write');
    const props = { client, cacheScope: 'user-1' } as const;
    const first = render(<ShelfFolder {...props} />);
    await screen.findByText('plan.pdf');
    await act(async () => setOnline(false));
    await pickFiles('keep.pdf');
    await screen.findByText('keep.pdf');
    await waitFor(() => expect(screen.getByText('Pending')).toBeTruthy());
    first.unmount();
    disposeAllSessions(); // a page reload: only IndexedDB survives

    render(<ShelfFolder {...props} />);
    await screen.findByText('keep.pdf');
    expect(screen.getByText('Pending')).toBeTruthy();
    const before = vi.mocked(client.upload).mock.calls.length;

    await act(async () => setOnline(true));
    await waitFor(() => expect(vi.mocked(client.upload).mock.calls.length).toBeGreaterThan(before));
    await waitFor(() => expect(screen.queryByText('Pending')).toBeNull());
    expect(screen.getByText('keep.pdf')).toBeTruthy();
  });

  it('delete hides the card at once and a 404 counts as done', async () => {
    let reject!: (e: unknown) => void;
    const client = mock('read_write', { deleteFile: vi.fn(() => new Promise<void>((_, rej) => { reject = rej; })) });
    render(<ShelfFolder client={client} />);
    await screen.findByText('notes.pdf');
    fireEvent.click(await screen.findByLabelText('Actions for notes.pdf'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(screen.getByRole('alertdialog', { name: 'Confirm delete' }).textContent).toMatch(/^Move notes\.pdf to the Shelf trash\? You can restore it in Shelf\./);
    fireEvent.click(screen.getByText('Confirm delete'));
    await waitFor(() => expect(screen.queryByText('notes.pdf')).toBeNull());
    await waitFor(() => expect(client.deleteFile).toHaveBeenCalledTimes(1)); // still in flight
    await act(async () => reject(new ShelfError(404, 'not_found', 'gone')));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText('notes.pdf')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Conflict')).toBeNull();
    expect(banner()).toBeNull();
  });

  it('a read-only key shows no outbox controls, offline or not', async () => {
    const client = mock('read');
    render(<ShelfFolder client={client} cacheScope="ro" />);
    await screen.findByText('plan.pdf');
    await act(async () => setOnline(false));
    expect(banner()).toBeNull();
    for (const t of ['Add documents', 'Retry', 'Discard', 'Pending']) expect(screen.queryByText(t)).toBeNull();
    expect(screen.queryByLabelText('Upload files')).toBeNull();
    expect(screen.queryByLabelText(/^Actions for/)).toBeNull();
  });

  it('auth lost shows not-connected and how many pending changes were discarded', async () => {
    const client = mock('read_write');
    const onAuthLost = vi.fn();
    render(<ShelfFolder client={client} cacheScope="u" onAuthLost={onAuthLost} />);
    await screen.findByText('plan.pdf');
    await act(async () => setOnline(false));
    await pickFiles('a.pdf', 'b.pdf');
    await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(2));
    vi.mocked(client.upload).mockImplementation(async () => { throw new ShelfError(401, 'unauthorized', 'signed out'); });
    await act(async () => setOnline(true));
    await screen.findByText("Shelf isn't connected");
    await waitFor(() => expect(screen.getByTestId('shelf-discarded').textContent).toMatch(/^2 pending changes could not be sent and were discarded/));
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('a.pdf')).toBeNull();
  });
});
