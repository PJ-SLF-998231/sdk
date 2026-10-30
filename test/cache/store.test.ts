import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCacheStore } from '../../src/cache/store';
import type { CacheStore } from '../../src/internal/contracts';
import { namespaceFor, openKv } from '../../src/storage/db';
import type { KvStore } from '../../src/storage/db';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
const open = async (scope?: string, baseUrl = 'https://a.test/api'): Promise<KvStore> => openKv(await namespaceFor({ baseUrl, cacheScope: scope }));
const stores: CacheStore[] = [];
const make = (kv: KvStore, o?: Parameters<typeof createCacheStore>[1]): CacheStore => {
  const s = createCacheStore(kv, o);
  stores.push(s);
  return s;
};
const buf = (n: number): ArrayBuffer => new ArrayBuffer(n);

beforeEach(() => {
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  while (stores.length) stores.pop()!.close();
  g.indexedDB = original;
});

describe('entries', () => {
  it('misses, hits, and persists across instances', async () => {
    const a = make(await open('u1'));
    expect(await a.getEntry('k')).toBeUndefined();
    expect(await a.setEntry('k', { n: 1 }, 'etag-1')).toBe('ok');
    expect((await a.getEntry<{ n: number }>('k'))?.value).toEqual({ n: 1 });
    expect((await a.getEntry('k'))?.etag).toBe('etag-1');
    a.close();
    const b = make(await open('u1'));
    expect(b.persistent).toBe(true);
    expect((await b.getEntry<{ n: number }>('k'))?.value).toEqual({ n: 1 });
  });

  it('isolates scopes: other scope, other baseUrl and no scope all miss', async () => {
    const a = make(await open('u1'));
    await a.setEntry('k', 1);
    expect(await make(await open('u2')).getEntry('k')).toBeUndefined();
    expect(await make(await open('u1', 'https://b.test/api')).getEntry('k')).toBeUndefined();
    const memOnly = make(await open(undefined));
    expect(memOnly.persistent).toBe(false);
    expect(await memOnly.getEntry('k')).toBeUndefined();
    await memOnly.setEntry('k', 'mem');
    expect((await memOnly.getEntry('k'))?.value).toBe('mem');
    // memory-only writes never reach IndexedDB
    expect((await make(await open('u1')).getEntry('k'))?.value).toBe(1);
  });

  it('does not store an entry over maxEntryBytes', async () => {
    const s = make(await open('u1'), { limits: { maxEntryBytes: 100 } });
    expect(await s.setEntry('big', { s: 'x'.repeat(500) })).toBe('failed');
    expect(await s.getEntry('big')).toBeUndefined();
  });

  it('stores a document over the cap without parsed_text', async () => {
    const s = make(await open('u1'), { limits: { maxEntryBytes: 200 } });
    const doc = { id: 'd1', filename: 'a.pdf', parsed_text: 'x'.repeat(5000) };
    expect(await s.setEntry('doc', doc)).toBe('ok');
    expect((await s.getEntry('doc'))?.value).toEqual({ id: 'd1', filename: 'a.pdf' });
    expect(doc.parsed_text.length).toBe(5000); // the caller's object is untouched
  });

  it('drops entries unused for maxAgeMs on open', async () => {
    let t = 1000;
    const kv = await open('u1');
    const a = make(kv, { now: () => t, limits: { maxAgeMs: 500 } });
    await a.setEntry('old', 1);
    a.close();
    t = 2000;
    const b = make(kv, { now: () => t, limits: { maxAgeMs: 500 } });
    expect(await b.getEntry('old')).toBeUndefined();
  });

  it('evicts the oldest entries when the total budget is exceeded', async () => {
    let t = 0;
    const s = make(await open('u1'), { now: () => ++t, limits: { totalBudgetBytes: 100 } });
    const v = (c: string) => ({ s: c.repeat(30) }); // ~38 bytes each
    await s.setEntry('a', v('a'));
    await s.setEntry('b', v('b'));
    await s.setEntry('c', v('c'));
    expect(await s.getEntry('a')).toBeUndefined();
    expect(await s.getEntry('c')).toBeDefined();
  });
});

describe('blobs', () => {
  const limits = { maxBlobBytes: 1000, blobBudgetBytes: 1000, totalBudgetBytes: 100000 };
  const put = (s: CacheStore, key: string, n: number) => s.putBlob(key, { bytes: buf(n), type: 'image/webp', etag: null });

  it('evicts least recently used: touch #1, write more, #2 and #3 go', async () => {
    let t = 0;
    const s = make(await open('u1'), { now: () => ++t, limits });
    for (const k of ['1', '2', '3']) expect(await put(s, k, 300)).toBe('ok');
    expect(await s.getBlob('1')).toBeDefined(); // touch #1
    await put(s, '4', 300);
    await put(s, '5', 300);
    expect(await s.getBlob('2')).toBeUndefined();
    expect(await s.getBlob('3')).toBeUndefined();
    for (const k of ['1', '4', '5']) expect(await s.getBlob(k)).toBeDefined();
    const total = (await s.kv.list<{ size: number }>('blobs')).reduce((n, b) => n + b.value.size, 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('never stores a blob over maxBlobBytes, and stores bytes as ArrayBuffer', async () => {
    const s = make(await open('u1'), { limits: { ...limits, maxBlobBytes: 500 } });
    expect(await put(s, 'big', 501)).toBe('failed');
    expect(await s.getBlob('big')).toBeUndefined();
    await put(s, 'ok', 100);
    const b = await s.getBlob('ok');
    expect(b?.bytes).toBeInstanceOf(ArrayBuffer);
    expect(b).toMatchObject({ size: 100, type: 'image/webp', etag: null });
  });

  it('persists blobs across instances', async () => {
    const a = make(await open('u1'), { limits });
    await put(a, 'x', 10);
    a.close();
    expect((await make(await open('u1'), { limits }).getBlob('x'))?.size).toBe(10);
  });
});

describe('purge and broadcast', () => {
  it('purges only its own namespace', async () => {
    const a = make(await open('u1'));
    const b = make(await open('u2'));
    await a.setEntry('k', 1);
    await a.putBlob('b', { bytes: buf(5), type: 't', etag: null });
    await b.setEntry('k', 2);
    await a.purge();
    expect(await a.getEntry('k')).toBeUndefined();
    expect(await a.getBlob('b')).toBeUndefined();
    expect((await b.getEntry('k'))?.value).toBe(2);
    expect((await make(await open('u1')).getEntry('k'))).toBeUndefined();
  });

  it('broadcasts purge and writes to another instance of the namespace', async () => {
    const kv = await open('u1');
    const a = make(kv);
    const b = make(kv);
    await b.setEntry('k', 1);
    await a.getEntry('k'); // load a's mirror
    const seen: string[][] = [];
    a.onExternalChange((keys) => seen.push(keys));
    await b.setEntry('k2', 2);
    await vi.waitFor(() => expect(seen).toContainEqual(['k2']));
    await b.purge();
    await vi.waitFor(() => expect(seen.length).toBeGreaterThan(1));
    expect(await a.getEntry('k')).toBeUndefined();
  });
});

describe('quota', () => {
  it('evicts to 80% and retries once', async () => {
    const real = await open('u1');
    let failNext = true;
    const puts: string[] = [];
    const kv: KvStore = {
      ...real,
      get persistent() {
        return real.persistent;
      },
      put: async (s, k, v) => {
        puts.push(k);
        if (k === 'new' && failNext) {
          failNext = false;
          return 'quota';
        }
        return real.put(s, k, v);
      },
    };
    let t = 0;
    const s = make(kv, { now: () => ++t });
    for (const k of ['a', 'b', 'c', 'd', 'e']) await s.putBlob(k, { bytes: buf(100), type: 't', etag: null });
    expect(await s.setEntry('new', { v: 1 })).toBe('ok');
    expect(puts.filter((k) => k === 'new')).toHaveLength(2);
    expect(await s.getBlob('a')).toBeUndefined(); // 500 -> 400 target
    expect((await s.getEntry('new'))?.value).toEqual({ v: 1 });
  });

  it('reports quota when the retry fails too', async () => {
    const real = await open('u1');
    const kv: KvStore = { ...real, put: async () => 'quota', persistent: true } as KvStore;
    const s = make(kv);
    expect(await s.setEntry('k', 1)).toBe('quota');
  });
});
