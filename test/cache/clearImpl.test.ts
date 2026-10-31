import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearCacheNow } from '../../src/cache/clearImpl';
import { livePurges, registerPurge } from '../../src/cache/purgeRegistry';
import { namespaceFor, openKv } from '../../src/storage/db';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
const BASE = 'https://a.test/api';
const kvFor = async (cacheScope: string) => openKv(await namespaceFor({ baseUrl: BASE, cacheScope }));

beforeEach(() => {
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  livePurges.clear();
  g.indexedDB = original;
});

describe('purgeRegistry', () => {
  it('registers a live purge and the returned function unregisters it', () => {
    const purge = vi.fn(async () => undefined);
    const off = registerPurge(purge);
    expect(livePurges.has(purge)).toBe(true);
    off();
    expect(livePurges.has(purge)).toBe(false);
  });
});

describe('clearCacheNow', () => {
  it('runs every live purge, and a failing one does not stop the rest', async () => {
    const ok = vi.fn(async () => undefined);
    registerPurge(vi.fn(async () => Promise.reject(new Error('boom'))));
    registerPurge(ok);
    await expect(clearCacheNow()).resolves.toBeUndefined();
    expect(ok).toHaveBeenCalledOnce();
  });

  it('scoped: empties that scope\'s entries and blobs, keeps its outbox and other scopes', async () => {
    const mine = await kvFor('u1');
    const theirs = await kvFor('u2');
    for (const kv of [mine, theirs]) {
      await kv.put('entries', 'e', { n: 1 });
      await kv.put('blobs', 'b', 'bytes');
      await kv.put('outbox', 'o', { op: 1 });
    }
    await clearCacheNow({ baseUrl: BASE, cacheScope: 'u1' });
    expect(await mine.get('entries', 'e')).toBeUndefined();
    expect(await mine.get('blobs', 'b')).toBeUndefined();
    expect(await mine.get('outbox', 'o')).toEqual({ op: 1 });
    expect(await theirs.get('entries', 'e')).toEqual({ n: 1 });
  });

  it('unscoped: deletes the whole database, queued changes included', async () => {
    const kv = await kvFor('u1');
    await kv.put('entries', 'e', { n: 1 });
    await kv.put('outbox', 'o', { op: 1 });
    await clearCacheNow();
    const after = await kvFor('u1');
    expect(await after.get('entries', 'e')).toBeUndefined();
    expect(await after.get('outbox', 'o')).toBeUndefined();
  });

  it('is best effort: no IndexedDB at all does not throw', async () => {
    g.indexedDB = undefined;
    await expect(clearCacheNow()).resolves.toBeUndefined();
    await expect(clearCacheNow({ baseUrl: BASE, cacheScope: 'u1' })).resolves.toBeUndefined();
  });
});
