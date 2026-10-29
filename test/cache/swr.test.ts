import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSwr } from '../../src/cache/swr';
import { createCacheStore } from '../../src/cache/store';
import { reconcile } from '../../src/cache/reconcile';
import { ShelfError } from '../../src/client';
import type { CacheStore } from '../../src/internal/contracts';
import { namespaceFor, openKv } from '../../src/storage/db';

const g = globalThis as { indexedDB?: unknown };
const original = g.indexedDB;
let cache: CacheStore;
let clock = 1_000_000;
const now = () => clock;

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((r) => setTimeout(r, 0));
const flush = async () => {
  for (let i = 0; i < 5; i++) await tick();
};

beforeEach(async () => {
  g.indexedDB = new IDBFactory();
  clock = 1_000_000;
  cache = createCacheStore(await openKv(await namespaceFor({ baseUrl: 'https://a.test', cacheScope: 'u1' })), { now });
});
afterEach(() => {
  cache.close();
  g.indexedDB = original;
});

describe('createSwr', () => {
  it('renders cached data before the fetch resolves, then replaces it', async () => {
    await cache.setEntry('k', ['cached']);
    const swr = createSwr(cache, { now });
    const d = deferred<string[]>();
    const fetcher = vi.fn(() => d.promise);
    const h = swr.handle({ key: 'k', fetcher });
    const un = h.subscribe(() => undefined);
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(h.snapshot()).toMatchObject({ data: ['cached'], fromCache: true, stale: true });
    d.resolve(['fresh']);
    await flush();
    expect(h.snapshot()).toMatchObject({ data: ['fresh'], fromCache: false, stale: false, error: undefined });
    expect((await cache.getEntry('k'))?.value).toEqual(['fresh']);
    un();
    swr.destroy();
  });

  it('persists across instances', async () => {
    const a = createSwr(cache, { now });
    const h = a.handle({ key: 'k', fetcher: async () => 'v1' });
    h.subscribe(() => undefined);
    await flush();
    a.destroy();
    const b = createSwr(cache, { now });
    const d = deferred<string>();
    const h2 = b.handle({ key: 'k', fetcher: () => d.promise });
    h2.subscribe(() => undefined);
    await flush();
    expect(h2.snapshot().data).toBe('v1');
    b.destroy();
  });

  it('keeps object identity for unchanged items through merge', async () => {
    const swr = createSwr(cache, { now });
    let n = 0;
    const merge = (prev: Array<{ id: string; v: number }> | undefined, next: Array<{ id: string; v: number }>) => reconcile(prev, next);
    const h = swr.handle({
      key: 'k',
      staleMs: 0,
      merge,
      fetcher: async () => (n++ === 0 ? [{ id: 'a', v: 1 }, { id: 'b', v: 1 }] : [{ id: 'a', v: 1 }, { id: 'b', v: 2 }]),
    });
    h.subscribe(() => undefined);
    await flush();
    const first = h.snapshot().data!;
    await h.refresh();
    const second = h.snapshot().data!;
    expect(second[0]).toBe(first[0]);
    expect(second[1]).not.toBe(first[1]);
    await h.refresh();
    expect(h.snapshot().data).toBe(second);
    swr.destroy();
  });

  it('dedupes concurrent refreshes and shares one handle per key', async () => {
    const swr = createSwr(cache, { now });
    const d = deferred<number>();
    const fetcher = vi.fn(() => d.promise);
    const h1 = swr.handle({ key: 'k', fetcher });
    const h2 = swr.handle({ key: 'k', fetcher });
    expect(h1).toBe(h2);
    h1.subscribe(() => undefined);
    h2.subscribe(() => undefined);
    void h1.refresh();
    void h2.refresh();
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    d.resolve(1);
    await flush();
    swr.destroy();
  });

  it('aborts the in-flight fetch when the last subscriber leaves', async () => {
    const swr = createSwr(cache, { now });
    let signal!: AbortSignal;
    const h = swr.handle({
      key: 'k',
      fetcher: (s) => {
        signal = s;
        return new Promise<number>(() => undefined);
      },
    });
    const u1 = h.subscribe(() => undefined);
    const u2 = h.subscribe(() => undefined);
    await flush();
    expect(signal.aborted).toBe(false);
    u1();
    expect(signal.aborted).toBe(false);
    u2();
    expect(signal.aborted).toBe(true);
    expect(h.snapshot().loading).toBe(false);
    swr.destroy();
  });

  it('refreshes on focus at most every 5s, and on online straight after an offline failure', async () => {
    const swr = createSwr(cache, { now });
    // jsdom-free: stand in window/document event targets
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('window', win);
    vi.stubGlobal('document', doc);
    swr.destroy();
    const s2 = createSwr(cache, { now });
    let calls = 0;
    let failing = false;
    const h = s2.handle({
      key: 'k',
      staleMs: 0,
      fetcher: async () => {
        calls++;
        if (failing) throw new TypeError('Failed to fetch');
        return calls;
      },
    });
    h.subscribe(() => undefined);
    await flush();
    expect(calls).toBe(1);
    clock += 1000;
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(calls).toBe(1); // throttled
    clock += 5000;
    win.dispatchEvent(new Event('focus'));
    await flush();
    expect(calls).toBe(2);
    win.dispatchEvent(new Event('focus'));
    doc.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(calls).toBe(2);
    clock += 6000;
    failing = true;
    win.dispatchEvent(new Event('focus'));
    await flush();
    expect(h.snapshot()).toMatchObject({ offline: true, data: 2 });
    failing = false;
    clock += 10; // inside the throttle window, but offline: online refetches at once
    win.dispatchEvent(new Event('online'));
    await flush();
    expect(h.snapshot()).toMatchObject({ offline: false, error: undefined });
    expect(calls).toBe(4);
    s2.destroy();
    vi.unstubAllGlobals();
  });

  it('does not refetch on focus inside the fresh window', async () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const swr = createSwr(cache, { now });
    const fetcher = vi.fn(async () => 1);
    swr.handle({ key: 'k', staleMs: 60_000, fetcher }).subscribe(() => undefined);
    await flush();
    clock += 10_000;
    win.dispatchEvent(new Event('focus'));
    await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
    swr.destroy();
    vi.unstubAllGlobals();
  });

  it('503 not_configured: onAuthLost once, cache emptied, data dropped', async () => {
    await cache.setEntry('k', 'cached');
    await cache.setEntry('other', 'x');
    const onAuthLost = vi.fn();
    const swr = createSwr(cache, { now, onAuthLost });
    const err = new ShelfError(503, 'not_configured', 'no key');
    const a = swr.handle({ key: 'k', fetcher: async () => Promise.reject(err) });
    const b = swr.handle({ key: 'other', fetcher: async () => Promise.reject(err) });
    a.subscribe(() => undefined);
    b.subscribe(() => undefined);
    await flush();
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    expect(await cache.getEntry('k')).toBeUndefined();
    expect(await cache.getEntry('other')).toBeUndefined();
    expect(a.snapshot().data).toBeUndefined();
    swr.destroy();
  });

  it('401 also counts as auth lost', async () => {
    const onAuthLost = vi.fn();
    const swr = createSwr(cache, { now, onAuthLost });
    swr.handle({ key: 'k', fetcher: async () => Promise.reject(new ShelfError(401, 'unauthorized', 'no')) }).subscribe(() => undefined);
    await vi.waitFor(() => expect(onAuthLost).toHaveBeenCalledTimes(1)); // not a fixed number of ticks: IDB speed varies under load
    await flush();
    expect(onAuthLost).toHaveBeenCalledTimes(1);
    swr.destroy();
  });

  it('502 keeps data and the cache, sets error and offline, no onAuthLost', async () => {
    await cache.setEntry('k', 'cached');
    const onAuthLost = vi.fn();
    const swr = createSwr(cache, { now, onAuthLost });
    const h = swr.handle({ key: 'k', fetcher: async () => Promise.reject(new ShelfError(502, 'bad_gateway', 'down')) });
    h.subscribe(() => undefined);
    await flush();
    expect(h.snapshot()).toMatchObject({ data: 'cached', offline: true, stale: true });
    expect(h.snapshot().error).toBeInstanceOf(ShelfError);
    expect((await cache.getEntry('k'))?.value).toBe('cached');
    expect(onAuthLost).not.toHaveBeenCalled();
    swr.destroy();
  });

  it('a non-offline error keeps data and is not marked offline', async () => {
    const swr = createSwr(cache, { now });
    let fail = false;
    const h = swr.handle({ key: 'k', fetcher: async () => (fail ? Promise.reject(new ShelfError(500, 'boom', 'x')) : 'ok') });
    h.subscribe(() => undefined);
    await flush();
    fail = true;
    await h.refresh();
    expect(h.snapshot()).toMatchObject({ data: 'ok', offline: false });
    expect(h.snapshot().error).toBeDefined();
    swr.destroy();
  });

  it('abortInFlight supersedes a running fetch', async () => {
    const swr = createSwr(cache, { now });
    const signals: AbortSignal[] = [];
    const ds = [deferred<string>(), deferred<string>()];
    const h = swr.handle({ key: 'k', fetcher: (s) => (signals.push(s), ds[signals.length - 1]!.promise) });
    h.subscribe(() => undefined);
    await flush();
    void h.refresh({ abortInFlight: true });
    await flush();
    expect(signals[0]!.aborted).toBe(true);
    ds[0]!.resolve('old');
    ds[1]!.resolve('new');
    await flush();
    expect(h.snapshot().data).toBe('new');
    swr.destroy();
  });
});
