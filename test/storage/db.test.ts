import 'fake-indexeddb/auto'; // globals: IDBKeyRange, IDBObjectStore, ...
import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearAllShelfData, namespaceFor, openKv, STORAGE_CHANNEL } from '../../src/storage/db';
import type { Namespace } from '../../src/storage/db';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
const ns = (id: string, persistent = true): Namespace => ({ id, persistent });

beforeEach(() => {
  g.indexedDB = new IDBFactory();
});
afterEach(() => {
  g.indexedDB = original;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('namespaceFor', () => {
  it('is persistent only with a baseUrl and a string scope', async () => {
    expect((await namespaceFor({ baseUrl: 'https://a.test/api', cacheScope: 'user-1' })).persistent).toBe(true);
    expect((await namespaceFor({ baseUrl: 'https://a.test/api' })).persistent).toBe(false);
    expect((await namespaceFor({ baseUrl: 'https://a.test/api', cacheScope: false })).persistent).toBe(false);
    expect((await namespaceFor({ cacheScope: 'user-1' })).persistent).toBe(false);
  });

  it('never leaks the raw scope or base URL into the id, and varies with both', async () => {
    const a = await namespaceFor({ baseUrl: 'https://a.test/api', cacheScope: 'secret-scope-123' });
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.id).not.toContain('secret');
    expect(STORAGE_CHANNEL(a.id)).toBe('shelf-sdk:' + a.id);
    expect(STORAGE_CHANNEL(a.id)).not.toContain('secret-scope-123');
    const b = await namespaceFor({ baseUrl: 'https://a.test/api', cacheScope: 'other' });
    const c = await namespaceFor({ baseUrl: 'https://b.test/api', cacheScope: 'secret-scope-123' });
    const again = await namespaceFor({ baseUrl: 'https://a.test/api/', cacheScope: 'secret-scope-123' });
    expect(new Set([a.id, b.id, c.id]).size).toBe(3);
    expect(again.id).toBe(a.id);
  });

  it('falls back to a 32-hex FNV id when crypto.subtle is missing', async () => {
    vi.stubGlobal('crypto', {});
    try {
      const a = await namespaceFor({ baseUrl: 'https://a.test', cacheScope: 's' });
      const b = await namespaceFor({ baseUrl: 'https://a.test', cacheScope: 't' });
      expect(a.id).toMatch(/^[0-9a-f]{32}$/);
      expect(a.id).not.toBe(b.id);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('KvStore on IndexedDB', () => {
  it('get/put/delete/list round-trip, ArrayBuffer survives', async () => {
    const kv = await openKv(ns('n1'));
    expect(kv.persistent).toBe(true);
    expect(await kv.get('entries', 'a')).toBeUndefined();
    expect(await kv.put('entries', 'a', { v: 1 })).toBe('ok');
    expect(await kv.put('entries', 'b', { v: 2 })).toBe('ok');
    expect(await kv.get('entries', 'a')).toEqual({ v: 1 });
    expect((await kv.list('entries')).map((e) => e.key)).toEqual(['a', 'b']);
    const bytes = new Uint8Array([9, 8, 7]).buffer;
    await kv.put('blobs', 'img', { bytes, type: 'image/webp' });
    const back = await kv.get<{ bytes: ArrayBuffer; type: string }>('blobs', 'img');
    expect([...new Uint8Array(back!.bytes)]).toEqual([9, 8, 7]);
    await kv.delete('entries', 'a');
    expect(await kv.get('entries', 'a')).toBeUndefined();
    expect((await kv.list('entries')).map((e) => e.key)).toEqual(['b']);
    expect(kv.persistent).toBe(true); // nothing above fell back to memory
  });

  it('persists across openKv calls (a reload)', async () => {
    await (await openKv(ns('n1'))).put('outbox', 'op1', { x: 1 });
    expect(await (await openKv(ns('n1'))).get('outbox', 'op1')).toEqual({ x: 1 });
  });

  it('isolates namespaces, including list and clear', async () => {
    const a = await openKv(ns('nsA'));
    const b = await openKv(ns('nsB'));
    await a.put('entries', 'k', 'A');
    await b.put('entries', 'k', 'B');
    expect(await a.get('entries', 'k')).toBe('A');
    expect(await b.get('entries', 'k')).toBe('B');
    expect((await a.list('entries')).map((e) => e.value)).toEqual(['A']);
    await a.clear();
    expect(await a.get('entries', 'k')).toBeUndefined();
    expect(await b.get('entries', 'k')).toBe('B');
  });

  it('clear(stores) only touches the named stores', async () => {
    const kv = await openKv(ns('n1'));
    await kv.put('entries', 'e', 1);
    await kv.put('blobs', 'b', 2);
    await kv.clear(['blobs']);
    expect(await kv.get('entries', 'e')).toBe(1);
    expect(await kv.get('blobs', 'b')).toBeUndefined();
  });

  it('update is a read-modify-write; undefined deletes; a throwing fn changes nothing', async () => {
    const kv = await openKv(ns('n1'));
    expect(await kv.update<number>('entries', 'c', (cur) => (cur ?? 0) + 1)).toBe('ok');
    await kv.update<number>('entries', 'c', (cur) => (cur ?? 0) + 1);
    expect(await kv.get('entries', 'c')).toBe(2);
    expect(await kv.update('entries', 'c', () => { throw new Error('boom'); })).toBe('failed');
    expect(await kv.get('entries', 'c')).toBe(2);
    expect(kv.persistent).toBe(true);
    await kv.update('entries', 'c', () => undefined);
    expect(await kv.get('entries', 'c')).toBeUndefined();
  });

  it('concurrent updates do not lose increments', async () => {
    const kv = await openKv(ns('n1'));
    await Promise.all(Array.from({ length: 20 }, () => kv.update<number>('entries', 'n', (c) => (c ?? 0) + 1)));
    expect(await kv.get('entries', 'n')).toBe(20);
  });

  it('a quota error on put returns "quota" and stays persistent', async () => {
    const kv = await openKv(ns('n1'));
    const spy = vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
      throw new DOMException('full', 'QuotaExceededError');
    });
    expect(await kv.put('blobs', 'big', { bytes: new ArrayBuffer(8) })).toBe('quota');
    expect(await kv.update('blobs', 'big', () => ({ x: 1 }))).toBe('quota');
    expect(kv.persistent).toBe(true);
    spy.mockRestore();
    expect(await kv.put('blobs', 'small', 1)).toBe('ok');
  });

  it('clearAllShelfData removes every namespace and does not throw', async () => {
    const a = await openKv(ns('nsA'));
    await a.put('entries', 'k', 1);
    await clearAllShelfData();
    const b = await openKv(ns('nsA'));
    expect(await b.get('entries', 'k')).toBeUndefined();
    expect(b.persistent).toBe(true);
  });
});

describe('memory fallback', () => {
  async function expectWorkingMemory(n: Namespace, opts?: { openTimeoutMs?: number }) {
    const kv = await openKv(n, opts);
    expect(kv.persistent).toBe(false);
    expect(await kv.put('entries', 'k', { v: 1 })).toBe('ok');
    expect(await kv.get('entries', 'k')).toEqual({ v: 1 });
    expect(await kv.update<number>('outbox', 'c', (c) => (c ?? 0) + 1)).toBe('ok');
    expect((await kv.list('entries')).map((e) => e.key)).toEqual(['k']);
    await kv.clear();
    expect(await kv.get('entries', 'k')).toBeUndefined();
  }

  it('indexedDB undefined', async () => {
    g.indexedDB = undefined;
    await expectWorkingMemory(ns('n1'));
  });

  it('indexedDB.open throws', async () => {
    g.indexedDB = { open: () => { throw new DOMException('denied', 'SecurityError'); } };
    await expectWorkingMemory(ns('n1'));
  });

  it('open error event', async () => {
    g.indexedDB = {
      open: () => {
        const req: { onerror?: () => void } = {};
        setTimeout(() => req.onerror?.(), 0);
        return req;
      },
    };
    await expectWorkingMemory(ns('n1'));
  });

  it('open hangs: gives up after 2000 ms (fake timers)', async () => {
    vi.useFakeTimers();
    g.indexedDB = { open: () => ({}) }; // never fires any event
    const pending = openKv(ns('n1'));
    let settled = false;
    void pending.then(() => { settled = true; });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2);
    const kv = await pending;
    expect(kv.persistent).toBe(false);
    expect(await kv.put('entries', 'k', 1)).toBe('ok');
    expect(await kv.get('entries', 'k')).toBe(1);
  });

  it('no-scope namespace is memory-only even with indexedDB available', async () => {
    const n = await namespaceFor({ baseUrl: 'https://a.test' });
    expect(n.persistent).toBe(false);
    const kv = await openKv(n);
    expect(kv.persistent).toBe(false);
    await kv.put('entries', 'k', 1);
    expect(await kv.get('entries', 'k')).toBe(1);
  });

  it('a fatal IDB error mid-session flips persistent to false and keeps working in memory', async () => {
    const kv = await openKv(ns('n1'));
    await kv.put('entries', 'before', 1);
    expect(kv.persistent).toBe(true);
    vi.spyOn(IDBDatabase.prototype, 'transaction').mockImplementation(() => {
      throw new DOMException('closing', 'InvalidStateError');
    });
    expect(await kv.put('entries', 'after', 2)).toBe('ok');
    expect(kv.persistent).toBe(false);
    expect(await kv.get('entries', 'after')).toBe(2);
  });
});
