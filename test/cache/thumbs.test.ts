import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheStore } from '../../src/cache/store';
import { createThumbLoader, REVALIDATE_AFTER_MS } from '../../src/cache/thumbs';
import { ShelfError } from '../../src/client';
import type { ShelfClient } from '../../src/client';
import type { CacheStore } from '../../src/internal/contracts';
import { namespaceFor, openKv } from '../../src/storage/db';
import type { ThumbnailResult } from '../../src/types';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
let cache: CacheStore;
let clock = 5_000_000;
let n = 0;
const bytes = (len = 8): ArrayBuffer => new Uint8Array(len).fill(7).buffer;

function fakeClient(thumbnail: ShelfClient['thumbnail']): ShelfClient {
  return { baseUrl: 'https://a.test', thumbnailUrl: (id: string, size?: string | number) => `https://a.test/files/${id}/thumbnail?size=${size}`, thumbnail } as unknown as ShelfClient;
}

beforeEach(async () => {
  g.indexedDB = new IDBFactory();
  clock = 5_000_000;
  n = 0;
  vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => `blob:fake/${++n}`), revokeObjectURL: vi.fn() }));
  cache = createCacheStore(await openKv(await namespaceFor({ baseUrl: 'https://a.test', cacheScope: 'u1' })), { now: () => clock });
});
afterEach(() => {
  cache.close();
  g.indexedDB = original;
  vi.unstubAllGlobals();
});

describe('thumb loader', () => {
  it('miss goes to the network, stores the bytes and returns an object URL', async () => {
    const thumbnail = vi.fn(async (): Promise<ThumbnailResult> => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: '"e1"' }));
    const loader = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock });
    const url = await loader.load({ id: 'd1', size: 'small' });
    expect(url).toMatch(/^blob:/);
    expect(thumbnail).toHaveBeenCalledTimes(1);
    expect(loader.peek('d1', 'small')).toBe(url);
    expect((await cache.getBlob('d1|small|'))?.etag).toBe('"e1"');
  });

  it('shares one URL and one request between concurrent loads', async () => {
    const thumbnail = vi.fn(async (): Promise<ThumbnailResult> => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: null }));
    const loader = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock });
    const [a, b] = await Promise.all([loader.load({ id: 'd1', size: 'small' }), loader.load({ id: 'd1', size: 'small' })]);
    expect(a).toBe(b);
    expect(thumbnail).toHaveBeenCalledTimes(1);
    expect(await loader.load({ id: 'd1', size: 'small' })).toBe(a);
  });

  it('hit: a new loader serves from the cache with no network', async () => {
    const first = createThumbLoader({ client: fakeClient(async () => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: '"e1"' })), cache, now: () => clock });
    await first.load({ id: 'd1', size: 'small' });
    await cache.getBlob('d1|small|'); // let the write settle
    const thumbnail = vi.fn();
    const second = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock });
    expect(await second.load({ id: 'd1', size: 'small' })).toMatch(/^blob:/);
    expect(thumbnail).not.toHaveBeenCalled();
  });

  it('a new version is a miss', async () => {
    const thumbnail = vi.fn(async (): Promise<ThumbnailResult> => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: null }));
    const loader = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock });
    await loader.load({ id: 'd1', size: 'small', version: 'v1' });
    await loader.load({ id: 'd1', size: 'small', version: 'v2' });
    expect(thumbnail).toHaveBeenCalledTimes(2);
  });

  it('304: after 24h revalidates with If-None-Match, keeps the cached bytes, and does not ask again', async () => {
    const seed = createThumbLoader({ client: fakeClient(async () => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: '"e1"' })), cache, now: () => clock });
    await seed.load({ id: 'd1', size: 'small' });
    await cache.getBlob('d1|small|');
    clock += REVALIDATE_AFTER_MS + 1000;
    const thumbnail = vi.fn(async (): Promise<ThumbnailResult> => ({ status: 304 }));
    const loader = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock });
    const url = await loader.load({ id: 'd1', size: 'small' });
    expect(url).toMatch(/^blob:/); // served from cache at once
    await vi.waitFor(() => expect(thumbnail).toHaveBeenCalledTimes(1));
    expect((thumbnail.mock.calls[0] as unknown[])[2]).toMatchObject({ etag: '"e1"' });
    await vi.waitFor(async () => expect((await cache.getBlob('d1|small|'))?.storedAt).toBe(clock));
    const again = createThumbLoader({ client: fakeClient(thumbnail), cache, now: () => clock + 1000 });
    await again.load({ id: 'd1', size: 'small' });
    await new Promise((r) => setTimeout(r, 20));
    expect(thumbnail).toHaveBeenCalledTimes(1);
  });

  it('error falls back to client.thumbnailUrl; 404 means no thumbnail', async () => {
    const down = createThumbLoader({ client: fakeClient(async () => Promise.reject(new TypeError('Failed to fetch'))), cache, now: () => clock });
    expect(await down.load({ id: 'd1', size: 'small' })).toBe('https://a.test/files/d1/thumbnail?size=small');
    const missing = createThumbLoader({ client: fakeClient(async () => Promise.reject(new ShelfError(404, 'not_found', 'x'))), cache, now: () => clock });
    expect(await missing.load({ id: 'd2', size: 'small' })).toBeNull();
    const noMethod = createThumbLoader({ client: fakeClient(undefined), cache, now: () => clock });
    expect(await noMethod.load({ id: 'd3', size: 'medium' })).toBe('https://a.test/files/d3/thumbnail?size=medium');
  });

  it('an aborted load resolves null and aborts the request when nobody else waits', async () => {
    let sig: AbortSignal | undefined;
    const thumbnail = vi.fn((_id: string, _s: string | number, o?: { signal?: AbortSignal }) => {
      sig = o?.signal;
      return new Promise<ThumbnailResult>(() => undefined);
    });
    const loader = createThumbLoader({ client: fakeClient(thumbnail as ShelfClient['thumbnail']), cache, now: () => clock });
    const ac = new AbortController();
    const p = loader.load({ id: 'd1', size: 'small', signal: ac.signal });
    await vi.waitFor(() => expect(sig).toBeDefined());
    ac.abort();
    expect(await p).toBeNull();
    expect(sig!.aborted).toBe(true);
  });

  it('dispose revokes the URLs', async () => {
    const loader = createThumbLoader({ client: fakeClient(async () => ({ status: 200, bytes: bytes(), type: 'image/webp', etag: null })), cache, now: () => clock });
    const url = await loader.load({ id: 'd1', size: 'small' });
    loader.dispose();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
    expect(loader.peek('d1', 'small')).toBeNull();
  });
});
