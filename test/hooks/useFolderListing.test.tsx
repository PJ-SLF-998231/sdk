// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheStore } from '../../src/cache/store';
import { createSwr } from '../../src/cache/swr';
import type { SwrImpl } from '../../src/cache/swr';
import type { ShelfClient } from '../../src/client';
import { useFolderListing } from '../../src/hooks/useFolderListing';
import type { CacheStore } from '../../src/internal/contracts';
import { namespaceFor, openKv } from '../../src/storage/db';
import type { ListFilesParams, ShelfItem } from '../../src/types';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
let cache: CacheStore;
let swr: SwrImpl;

const mk = (i: number, extra: Partial<ShelfItem> = {}): ShelfItem => ({
  id: `f${i}`,
  filename: `file-${i}.pdf`,
  content_type: 'application/pdf',
  size_bytes: 1,
  folder_id: null,
  parse_status: 'done',
  created_at: 't',
  edited_at: null,
  parsed_at: null,
  preview_sizes: [],
  ...extra,
});

/** A server holding `total` items, served in cursor pages. */
function server(total: number, override?: (i: number) => Partial<ShelfItem>) {
  const calls: ListFilesParams[] = [];
  const client = {
    listFiles: vi.fn(async (p: ListFilesParams = {}) => {
      calls.push(p);
      const start = p.cursor ? Number(p.cursor) : 0;
      const limit = p.limit ?? 200;
      const end = Math.min(total, start + limit);
      return { items: Array.from({ length: end - start }, (_, k) => mk(start + k, override?.(start + k))), next_cursor: end < total ? String(end) : null };
    }),
  } as unknown as ShelfClient;
  return { client, calls };
}

beforeEach(async () => {
  g.indexedDB = new IDBFactory();
  cache = createCacheStore(await openKv(await namespaceFor({ baseUrl: 'https://a.test', cacheScope: 'u1' })));
  swr = createSwr(cache);
});
afterEach(() => {
  cleanup();
  swr.destroy();
  cache.close();
  g.indexedDB = original;
});

describe('useFolderListing', () => {
  it('loads page 1 with a page size of 200', async () => {
    const { client, calls } = server(5000);
    const { result } = renderHook(() => useFolderListing(swr, client, { folderId: null }));
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    expect(calls[0]).toMatchObject({ limit: 200 });
    expect(calls[0]!.cursor).toBeUndefined();
    expect(result.current.complete).toBe(false);
  });

  it('5000 items: prefetchNext called many times sends one request', async () => {
    const { client, calls } = server(5000);
    const { result } = renderHook(() => useFolderListing(swr, client, { folderId: null }));
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    await act(async () => {
      await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map(() => result.current.prefetchNext()));
    });
    expect(calls.filter((c) => c.cursor)).toHaveLength(1);
    expect(result.current.items).toHaveLength(400);
    // and it can walk to the end
    for (let i = 0; i < 30 && !result.current.complete; i++) await act(async () => result.current.prefetchNext());
    expect(result.current.items).toHaveLength(5000);
    expect(result.current.complete).toBe(true);
    expect(new Set(result.current.items.map((x) => x.id)).size).toBe(5000);
  });

  it('revalidate with an unchanged page 1 keeps the later pages and item identity', async () => {
    const { client } = server(450);
    const { result } = renderHook(() => useFolderListing(swr, client, { folderId: null }));
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    await act(async () => result.current.prefetchNext());
    await act(async () => result.current.prefetchNext());
    expect(result.current.items).toHaveLength(450);
    const before = result.current.items;
    await act(async () => result.current.refresh());
    expect(result.current.items).toHaveLength(450);
    expect(result.current.items).toBe(before);
  });

  it('revalidate with a changed page 1 resets to page 1', async () => {
    let rev = 0;
    const { client } = server(450, (i) => (rev > 0 && i === 3 ? { filename: 'renamed.pdf' } : {}));
    const { result } = renderHook(() => useFolderListing(swr, client, { folderId: null }));
    await waitFor(() => expect(result.current.items).toHaveLength(200));
    const kept = result.current.items[0];
    await act(async () => result.current.prefetchNext());
    expect(result.current.items).toHaveLength(400);
    rev = 1;
    await act(async () => result.current.refresh());
    expect(result.current.items).toHaveLength(200);
    expect(result.current.items[3]!.filename).toBe('renamed.pdf');
    expect(result.current.items[0]).toBe(kept); // unchanged rows keep identity
    expect(result.current.complete).toBe(false);
  });

  it('serves a cached listing instantly in a new session', async () => {
    const { client } = server(300);
    const first = renderHook(() => useFolderListing(swr, client, { folderId: 'd1' }));
    await waitFor(() => expect(first.result.current.items).toHaveLength(200));
    first.unmount();
    swr.destroy();
    swr = createSwr(cache);
    let release!: () => void;
    const slow = {
      listFiles: vi.fn(() => new Promise((r) => (release = () => r({ items: [], next_cursor: null })))),
    } as unknown as ShelfClient;
    const second = renderHook(() => useFolderListing(swr, slow, { folderId: 'd1' }));
    await waitFor(() => expect(second.result.current.items).toHaveLength(200));
    expect(second.result.current).toMatchObject({ fromCache: true, stale: true });
    await act(async () => release());
    await waitFor(() => expect(second.result.current.items).toHaveLength(0));
  });
});

describe('mergeListing', () => {
  it('resets when page 1 became a final shorter page', async () => {
    const { mergeListing } = await import('../../src/hooks/useFolderListing');
    const base = { folderId: null, loadedAt: 1 };
    const prev = { ...base, items: [mk(1), mk(2), mk(3)], nextCursor: null, complete: true };
    const next = { ...base, items: [mk(1), mk(2)], nextCursor: null, complete: true };
    expect(mergeListing(prev, next).items).toHaveLength(2);
  });
});
