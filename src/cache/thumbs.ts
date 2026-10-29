import { ShelfError } from '../client';
import type { CreateThumbLoaderFn, ThumbLoader, ThumbRequest } from '../internal/contracts';
import type { PreviewSize } from '../types';

/** A cached thumbnail is revalidated with If-None-Match at most this often per id+size. */
export const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

const isAbort = (e: unknown): boolean => (e as { name?: string } | null)?.name === 'AbortError';

interface Flight {
  controller: AbortController;
  waiters: number;
  promise: Promise<string | null>;
}

export const createThumbLoader = ({ client, cache, maxConcurrent = 6, now = Date.now }: Parameters<CreateThumbLoaderFn>[0] & { now?: () => number }): ThumbLoader => {
  /** Resolved object URLs by `${id}|${size}|${version}`, with how many loads handed each one out. */
  const urls = new Map<string, { url: string; refs: number }>();
  /** Latest URL per id+size, for synchronous peek. */
  const latest = new Map<string, string>();
  const flights = new Map<string, Flight>();
  const revalidating = new Set<string>();
  const queue: Array<() => void> = [];
  let active = 0;
  let disposed = false;

  const baseKey = (id: string, size: string): string => `${id}|${size}`;
  const fullKey = (r: { id: string; size: string; version?: string | null }): string => `${r.id}|${r.size}|${r.version ?? ''}`;

  async function slot<T>(fn: () => Promise<T>): Promise<T> {
    if (active >= maxConcurrent) await new Promise<void>((res) => queue.push(res));
    active++;
    try {
      return await fn();
    } finally {
      active--;
      queue.shift()?.();
    }
  }

  function makeUrl(bytes: ArrayBuffer, type: string): string {
    return URL.createObjectURL(new Blob([bytes], { type }));
  }

  function remember(key: string, id: string, size: string, url: string): void {
    const prev = urls.get(key);
    urls.set(key, { url, refs: (prev?.refs ?? 0) });
    latest.set(baseKey(id, size), url);
  }

  /** Counts one more load on `url` when it is one of ours (a fallback URL is not tracked). */
  function claim(key: string, url: string | null): string | null {
    const e = urls.get(key);
    if (e && e.url === url) e.refs++;
    return url;
  }

  function hand(key: string): string | null {
    const e = urls.get(key);
    if (!e) return null;
    e.refs++;
    return e.url;
  }

  /** Revalidates a stale cached blob in the background; a 200 replaces the bytes for later loads. */
  async function revalidate(key: string, blobKey: string, req: ThumbRequest, etag: string | null, bytes: ArrayBuffer, type: string): Promise<void> {
    if (revalidating.has(key) || !client.thumbnail) return;
    revalidating.add(key);
    try {
      const res = await slot(() => client.thumbnail!(req.id, req.size, { etag }));
      if (disposed) return;
      if (res.status === 304) {
        await cache.putBlob(blobKey, { bytes, type, etag }); // refreshes storedAt: next check in 24h
      } else {
        await cache.putBlob(blobKey, { bytes: res.bytes, type: res.type, etag: res.etag });
      }
    } catch {
      /* keep what we have; try again on a later load */
    } finally {
      revalidating.delete(key);
    }
  }

  async function fetchAndStore(key: string, blobKey: string, req: ThumbRequest, signal: AbortSignal): Promise<string | null> {
    const fallback = client.thumbnailUrl(req.id, req.size);
    if (!client.thumbnail) return fallback;
    try {
      const res = await slot(() => client.thumbnail!(req.id, req.size, { signal }));
      if (res.status === 304) return fallback; // cannot happen without an etag; be safe
      if (disposed) return null;
      void cache.putBlob(blobKey, { bytes: res.bytes, type: res.type, etag: res.etag });
      const url = makeUrl(res.bytes, res.type);
      remember(key, req.id, req.size, url);
      return url;
    } catch (err) {
      if (signal.aborted || isAbort(err)) return null;
      if (err instanceof ShelfError && err.status === 404) return null;
      return fallback;
    }
  }

  async function resolve(req: ThumbRequest, key: string, signal: AbortSignal): Promise<string | null> {
    const blobKey = key;
    const cached = await cache.getBlob(blobKey);
    if (disposed) return null;
    if (cached) {
      const url = makeUrl(cached.bytes, cached.type);
      remember(key, req.id, req.size, url);
      if (now() - cached.storedAt > REVALIDATE_AFTER_MS) void revalidate(key, blobKey, req, cached.etag, cached.bytes, cached.type);
      return url;
    }
    return fetchAndStore(key, blobKey, req, signal);
  }

  return {
    peek(id: string, size: PreviewSize): string | null {
      return latest.get(baseKey(id, size)) ?? null;
    },

    load(req: ThumbRequest): Promise<string | null> {
      if (disposed) return Promise.resolve(null);
      const key = fullKey(req);
      const have = hand(key);
      if (have) {
        latest.set(baseKey(req.id, req.size), have);
        return Promise.resolve(have);
      }
      if (req.signal?.aborted) return Promise.resolve(null);

      let flight = flights.get(key);
      if (!flight) {
        const controller = new AbortController();
        const f: Flight = { controller, waiters: 0, promise: null as unknown as Promise<string | null> };
        f.promise = resolve(req, key, controller.signal).finally(() => {
          if (flights.get(key) === f) flights.delete(key);
        });
        flights.set(key, f);
        flight = f;
      }
      const f = flight;
      f.waiters++;
      return new Promise<string | null>((res) => {
        let done = false;
        const onAbort = (): void => {
          if (done) return;
          done = true;
          if (--f.waiters <= 0) f.controller.abort();
          res(null);
        };
        req.signal?.addEventListener('abort', onAbort, { once: true });
        f.promise.then(
          (url) => {
            if (done) return;
            done = true;
            req.signal?.removeEventListener('abort', onAbort);
            f.waiters--;
            res(claim(key, url));
          },
          () => {
            if (done) return;
            done = true;
            req.signal?.removeEventListener('abort', onAbort);
            f.waiters--;
            res(client.thumbnailUrl(req.id, req.size));
          },
        );
      });
    },

    dispose(): void {
      disposed = true;
      for (const f of flights.values()) f.controller.abort();
      flights.clear();
      for (const { url } of urls.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          /* ignore */
        }
      }
      urls.clear();
      latest.clear();
    },
  };
};
