// @vitest-environment jsdom
import 'fake-indexeddb/auto'; // globals: IDBKeyRange, ...
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ShelfFolder, clearCache } from '../src/react';
import { ShelfError } from '../src';
import type { ShelfClient, ShelfItem } from '../src';
import { disposeAllSessions } from '../src/react/session';
import { namespaceFor, openKv } from '../src/storage/db';

const BASE = 'https://shelf.test/api';
const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: [], ...o,
});
const FOLDERS = [
  { id: 'root', name: 'Aisle CMS', parent_id: null },
  { id: 'sub', name: 'Contracts', parent_id: 'root' },
];

const recursiveCalls = (c: { listFiles: unknown }) =>
  (c.listFiles as { mock: { calls: unknown[][] } }).mock.calls.filter(([p]) => (p as { recursive?: boolean } | undefined)?.recursive === true);

function mock(over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const c = {
    baseUrl: BASE,
    info: vi.fn(async () => ({ access: 'read' })),
    folders: vi.fn(async () => FOLDERS),
    listFiles: vi.fn(async () => ({ items: [item(), item({ id: 'f2', filename: 'notes.pdf' })], next_cursor: null })),
    getFile: vi.fn(async (id: string) => ({ ...item({ id }), parsed_text: 'text' })),
    upload: vi.fn(),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    thumbnailUrl: (id: string, size?: string | number) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
    ...over,
  };
  return c as unknown as ShelfClient & typeof c;
}

/** Number of rows in the raw IndexedDB `entries` + `blobs` stores, whatever the namespace. */
async function storedRows(): Promise<number> {
  const dbs = await indexedDB.databases();
  if (!dbs.some((d) => d.name === 'shelf-sdk')) return 0;
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('shelf-sdk');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  let n = 0;
  for (const store of ['entries', 'blobs']) {
    if (!db.objectStoreNames.contains(store)) continue;
    n += await new Promise<number>((res, rej) => {
      const r = db.transaction(store).objectStore(store).count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }
  db.close();
  return n;
}

async function seeded(scope: string): Promise<number> {
  const kv = await openKv(await namespaceFor({ baseUrl: BASE, cacheScope: scope }));
  return (await kv.list('entries')).length;
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  disposeAllSessions(); // a "page reload": the next mount starts from storage alone
  vi.restoreAllMocks();
});

/** Mounts with a cache scope, waits for the rows and for them to reach IndexedDB, then "reloads". */
async function warm(scope: string): Promise<void> {
  const view = render(<ShelfFolder client={mock()} cacheScope={scope} />);
  await screen.findByText('plan.pdf');
  await waitFor(async () => expect(await seeded(scope)).toBeGreaterThanOrEqual(3)); // info, folders, listing
  view.unmount();
  disposeAllSessions();
}

describe('ShelfFolder cache', () => {
  it('a second mount with the same cacheScope shows rows before listFiles resolves', async () => {
    await warm('user-1');
    let release: (v: unknown) => void = () => undefined;
    const slow = mock({ listFiles: vi.fn(() => new Promise((r) => (release = r))) });
    render(<ShelfFolder client={slow} cacheScope="user-1" />);
    await screen.findByText('plan.pdf');
    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(slow.listFiles).toHaveBeenCalled();
    release({ items: [item()], next_cursor: null }); // the fresh answer replaces the cached one
    await waitFor(() => expect(screen.queryByText('notes.pdf')).toBeNull());
  });

  it('another cacheScope does not see them', async () => {
    await warm('user-1');
    const slow = mock({ listFiles: vi.fn(() => new Promise(() => undefined)) });
    render(<ShelfFolder client={slow} cacheScope="user-2" />);
    await screen.findByText('Contracts'); // folders come back (they are answered), documents do not
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('plan.pdf')).toBeNull();
  });

  it('without a cacheScope nothing is shown from before and nothing is written to IndexedDB', async () => {
    await warm('user-1');
    const before = await storedRows();
    const slow = mock({ listFiles: vi.fn(() => new Promise(() => undefined)) });
    const view = render(<ShelfFolder client={slow} />);
    await screen.findByText('Contracts');
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('plan.pdf')).toBeNull();
    view.unmount();
    expect(await storedRows()).toBe(before);

    // And on a clean slate: a full memory-only session leaves IndexedDB untouched.
    (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
    for (const scope of [undefined, false] as const) {
      const v = render(<ShelfFolder client={mock()} cacheScope={scope} />);
      await screen.findByText('plan.pdf');
      await new Promise((r) => setTimeout(r, 50));
      v.unmount();
      expect(await storedRows()).toBe(0);
    }
  });

  it.each([
    ['503 not_configured', () => new ShelfError(503, 'not_configured', 'revoked')],
    ['401', () => new ShelfError(401, 'unauthorized', 'bad key')],
  ])('%s: shows "not connected", calls onAuthLost once, and the cache is gone', async (_n, make) => {
    await warm('user-1');
    const err = make();
    const dead = mock({
      info: vi.fn(async () => { throw err; }),
      folders: vi.fn(async () => { throw err; }),
      listFiles: vi.fn(async () => { throw err; }),
    });
    const onAuthLost = vi.fn();
    render(<ShelfFolder client={dead} cacheScope="user-1" onAuthLost={onAuthLost} />);
    await screen.findByText("Shelf isn't connected");
    await new Promise((r) => setTimeout(r, 100));
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(onAuthLost.mock.calls[0]![0]).toBeInstanceOf(ShelfError);
    expect(onAuthLost.mock.calls[0]![0].status).toBe(err.status);
    expect(screen.queryByText('plan.pdf')).toBeNull();
    expect(await seeded('user-1')).toBe(0);

    // A fresh mount starts empty: nothing is shown as if it were live.
    cleanup();
    disposeAllSessions();
    const fresh = mock({ info: vi.fn(() => new Promise(() => undefined)) });
    render(<ShelfFolder client={fresh} cacheScope="user-1" />);
    await new Promise((r) => setTimeout(r, 100));
    expect(screen.queryByText('plan.pdf')).toBeNull();
    expect(screen.queryByText('Contracts')).toBeNull();
  });

  it('a 401 on a write, with rows showing, replaces them with "not connected" and purges the cache', async () => {
    const client = mock({
      info: vi.fn(async () => ({ access: 'read_write' })),
      upload: vi.fn(async () => { throw new ShelfError(401, 'unauthorized', 'x'); }),
    });
    const onAuthLost = vi.fn();
    render(<ShelfFolder client={client} cacheScope="user-1" onAuthLost={onAuthLost} />);
    await screen.findByText('plan.pdf');
    await waitFor(async () => expect(await seeded('user-1')).toBeGreaterThanOrEqual(3));
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [new File(['x'], 'new.pdf')] } });
    await screen.findByText("Shelf isn't connected");
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('plan.pdf')).toBeNull();
    expect(await seeded('user-1')).toBe(0);
  });

  it('502 keeps the cached rows and shows a small offline note', async () => {
    await warm('user-1');
    const down = new ShelfError(502, 'bad_gateway', 'upstream');
    const offline = mock({
      info: vi.fn(async () => { throw down; }),
      folders: vi.fn(async () => { throw down; }),
      listFiles: vi.fn(async () => { throw down; }),
    });
    const onAuthLost = vi.fn();
    render(<ShelfFolder client={offline} cacheScope="user-1" onAuthLost={onAuthLost} />);
    await screen.findByText('plan.pdf');
    await screen.findByTestId('shelf-offline');
    expect(screen.getByText('notes.pdf')).toBeTruthy();
    expect(screen.queryByText("Shelf isn't connected")).toBeNull();
    expect(onAuthLost).not.toHaveBeenCalled();
    expect(await seeded('user-1')).toBeGreaterThanOrEqual(3); // still on disk
  });

  it('a plain 503 and a network failure also keep rows', async () => {
    for (const make of [() => new ShelfError(503, 'unavailable', 'x'), () => new TypeError('Failed to fetch')]) {
      await warm('user-2');
      const e = make();
      const offline = mock({
        info: vi.fn(async () => { throw e; }),
        folders: vi.fn(async () => { throw e; }),
        listFiles: vi.fn(async () => { throw e; }),
      });
      const view = render(<ShelfFolder client={offline} cacheScope="user-2" />);
      await screen.findByText('plan.pdf');
      await screen.findByTestId('shelf-offline');
      view.unmount();
      disposeAllSessions();
    }
  });

  it('uses item_count / total_item_count from /folders and makes no recursive listing call', async () => {
    const client = mock({
      folders: vi.fn(async () => [
        { id: 'root', name: 'Aisle CMS', parent_id: null, item_count: 1, total_item_count: 4 },
        { id: 'sub', name: 'Contracts', parent_id: 'root', item_count: 3, total_item_count: 3 },
      ]),
    });
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toBe('4 items · 2 folders'));
    expect(container.querySelector('.shelf-sdk__folder-tile .shelf-sdk__card-meta')?.textContent).toBe('3 items');
    expect(recursiveCalls(client)).toHaveLength(0);
  });

  it('falls back to the census when /folders carries no counts', async () => {
    const client = mock({
      listFiles: vi.fn(async (p?: { recursive?: boolean }) => ({ items: p?.recursive ? [item(), item({ id: 'f3', folder_id: 'sub' })] : [item()], next_cursor: null })),
    });
    const { container } = render(<ShelfFolder client={client} />);
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toBe('2 items · 2 folders'));
    expect(recursiveCalls(client)).toHaveLength(1);
  });

  it('5000 documents render at most 60 cards (gallery) or rows (list)', async () => {
    const many = Array.from({ length: 5000 }, (_, i) => item({ id: `d${i}`, filename: `doc-${i}.pdf` }));
    const client = mock({ listFiles: vi.fn(async () => ({ items: many, next_cursor: null })) });
    const t0 = performance.now();
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText('doc-0.pdf');
    const ms = performance.now() - t0;
    const cards = container.querySelectorAll('article.shelf-sdk__file-card').length;
    console.log(`5000 docs gallery: ${cards} cards in DOM, mount to first rows ${ms.toFixed(0)} ms`);
    expect(cards).toBeGreaterThan(0);
    expect(cards).toBeLessThanOrEqual(60);

    screen.getByRole('button', { name: 'List' }).click();
    await waitFor(() => expect(container.querySelector('table.shelf-sdk__item-list')).toBeTruthy());
    await screen.findByText('doc-0.pdf');
    const rows = container.querySelectorAll('tr.shelf-sdk__item-row:not(.shelf-sdk__item-row--folder)').length;
    console.log(`5000 docs list: ${rows} rows in DOM`);
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThanOrEqual(60);
  });

  it('clearCache() empties memory and IndexedDB for every scope', async () => {
    await warm('user-1');
    expect(await storedRows()).toBeGreaterThan(0);
    await clearCache();
    expect(await storedRows()).toBe(0);
  });
});
