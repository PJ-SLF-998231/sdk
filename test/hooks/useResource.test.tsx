// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheStore } from '../../src/cache/store';
import { createSwr } from '../../src/cache/swr';
import type { SwrImpl } from '../../src/cache/swr';
import type { CacheStore } from '../../src/internal/contracts';
import { useResource } from '../../src/hooks/useResource';
import { namespaceFor, openKv } from '../../src/storage/db';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
let cache: CacheStore;
let swr: SwrImpl;

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

describe('useResource', () => {
  it('shows cached data first, then the fetched data', async () => {
    await cache.setEntry('k', 'cached');
    let resolve!: (v: string) => void;
    const fetcher = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const { result } = renderHook(() => useResource(swr, { key: 'k', fetcher }));
    await waitFor(() => expect(result.current.data).toBe('cached'));
    expect(result.current).toMatchObject({ fromCache: true, stale: true });
    await act(async () => resolve('fresh'));
    await waitFor(() => expect(result.current).toMatchObject({ data: 'fresh', fromCache: false, stale: false }));
  });

  it('aborts the fetch on unmount', async () => {
    let signal!: AbortSignal;
    const { unmount } = renderHook(() =>
      useResource(swr, {
        key: 'k',
        fetcher: (s) => {
          signal = s;
          return new Promise<string>(() => undefined);
        },
      }),
    );
    await waitFor(() => expect(signal).toBeDefined());
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it('is idle without a cache or options', () => {
    const { result } = renderHook(() => useResource<string>(null, null));
    expect(result.current).toMatchObject({ data: undefined, loading: false });
  });
});
