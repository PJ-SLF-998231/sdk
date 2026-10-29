import { DEFAULT_LIMITS } from '../internal/contracts';
import type { CachedBlob, CachedEntry, CacheLimits, CacheStore, CreateCacheStoreFn } from '../internal/contracts';
import { STORAGE_CHANNEL } from '../storage/db';
import type { KvStore, PutResult } from '../storage/db';

/** What actually sits in the `entries` store: the contract's CachedEntry plus bookkeeping. */
interface StoredEntry<T = unknown> extends CachedEntry<T> {
  size: number;
  lastUsed: number;
}

interface Meta {
  size: number;
  lastUsed: number;
}

type CacheMessage = { t: 'cache'; op: 'set' | 'delete'; keys: string[] } | { t: 'cache'; op: 'purge' };

/** Persisted lastUsed is refreshed at most this often per blob (a touch rewrites the bytes). */
const TOUCH_PERSIST_MS = 10 * 60 * 1000;

export const createCacheStore: CreateCacheStoreFn = (kv: KvStore, opts = {}): CacheStore => {
  const limits: CacheLimits = { ...DEFAULT_LIMITS, ...(opts.limits ?? {}) };
  const now = opts.now ?? Date.now;

  /** Memory mirror: entries in full (they are small), blobs as an index only (bytes stay in the kv). */
  const entries = new Map<string, StoredEntry>();
  const entryMeta = new Map<string, Meta>();
  const blobMeta = new Map<string, Meta & { persistedUsed: number }>();
  const listeners = new Set<(keys: string[]) => void>();
  let closed = false;

  let channel: BroadcastChannel | null = null;
  if (kv.persistent && typeof BroadcastChannel !== 'undefined') {
    try {
      channel = new BroadcastChannel(STORAGE_CHANNEL(kv.ns));
      channel.onmessage = (ev: MessageEvent) => onMessage(ev.data as CacheMessage | undefined);
    } catch {
      channel = null;
    }
  }

  function post(msg: CacheMessage): void {
    try {
      channel?.postMessage(msg);
    } catch {
      /* closed or unsupported: other tabs just revalidate later */
    }
  }

  function emit(keys: string[]): void {
    for (const l of [...listeners]) {
      try {
        l(keys);
      } catch {
        /* a listener must not break the store */
      }
    }
  }

  function onMessage(msg: CacheMessage | undefined): void {
    if (!msg || msg.t !== 'cache' || closed) return;
    if (msg.op === 'purge') {
      const keys = [...entryMeta.keys()];
      entries.clear();
      entryMeta.clear();
      blobMeta.clear();
      emit(keys);
    } else {
      for (const k of msg.keys) {
        entries.delete(k);
        entryMeta.delete(k);
      }
      emit(msg.keys);
    }
  }

  // Everything that mutates the index runs one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  function serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  }

  /** Resolves once the writes queued so far have finished. */
  const settled = (): Promise<unknown> => chain;

  // ------------------------------------------------------------ open: load index, drop the too old
  let loaded: Promise<void> | null = null;
  function ready(): Promise<void> {
    if (!loaded) loaded = load().catch(() => undefined);
    return loaded;
  }

  async function load(): Promise<void> {
    const cutoff = now() - limits.maxAgeMs;
    const [es, bs] = await Promise.all([kv.list<StoredEntry>('entries'), kv.list<CachedBlob>('blobs')]);
    for (const { key, value } of es) {
      if (!value || typeof value !== 'object') continue;
      const used = value.lastUsed ?? value.storedAt ?? 0;
      if (used < cutoff) {
        await kv.delete('entries', key);
        continue;
      }
      const size = typeof value.size === 'number' ? value.size : sizeOf(value.value);
      entries.set(key, value);
      entryMeta.set(key, { size, lastUsed: used });
    }
    for (const { key, value } of bs) {
      if (!value || typeof value !== 'object') continue;
      const used = value.lastUsed ?? value.storedAt ?? 0;
      if (used < cutoff) {
        await kv.delete('blobs', key);
        continue;
      }
      blobMeta.set(key, { size: value.size ?? value.bytes?.byteLength ?? 0, lastUsed: used, persistedUsed: used });
    }
    await trim(0);
  }

  // ----------------------------------------------------------------------------- accounting
  const sum = (m: Map<string, Meta>): number => {
    let n = 0;
    for (const v of m.values()) n += v.size;
    return n;
  };
  const sizeOf = (value: unknown): number => {
    try {
      return JSON.stringify(value)?.length ?? 0;
    } catch {
      return Infinity;
    }
  };
  const oldest = (m: Map<string, Meta>, skip?: string): string | undefined => {
    let best: string | undefined;
    let bestUsed = Infinity;
    for (const [k, v] of m) {
      if (k !== skip && v.lastUsed < bestUsed) {
        best = k;
        bestUsed = v.lastUsed;
      }
    }
    return best;
  };

  async function dropBlob(key: string): Promise<void> {
    blobMeta.delete(key);
    await kv.delete('blobs', key);
  }
  async function dropEntry(key: string): Promise<void> {
    entries.delete(key);
    entryMeta.delete(key);
    await kv.delete('entries', key);
  }

  /** Evicts (LRU blobs first, then oldest entries) until the total, plus `incoming`, fits `target`. */
  async function evictTo(target: number, incoming: number, keep?: string): Promise<void> {
    while (sum(blobMeta) + sum(entryMeta) + incoming > target) {
      const b = oldest(blobMeta, keep);
      if (b !== undefined) {
        await dropBlob(b);
        continue;
      }
      const e = oldest(entryMeta, keep);
      if (e === undefined) return;
      await dropEntry(e);
    }
  }

  async function trim(incomingBlob: number, keep?: string): Promise<void> {
    while (sum(blobMeta) + incomingBlob > limits.blobBudgetBytes) {
      const b = oldest(blobMeta, keep);
      if (b === undefined) break;
      await dropBlob(b);
    }
    await evictTo(limits.totalBudgetBytes, incomingBlob, keep);
  }

  /** Puts, and on 'quota' evicts down to 80% of what is held and retries once. */
  async function putWithRetry(store: 'entries' | 'blobs', key: string, value: unknown, keep: string): Promise<PutResult> {
    let r = await kv.put(store, key, value);
    if (r !== 'quota') return r;
    await evictTo(Math.floor((sum(blobMeta) + sum(entryMeta)) * 0.8), 0, keep);
    r = await kv.put(store, key, value);
    return r;
  }

  // ---------------------------------------------------------------------------------- entries
  const store: CacheStore = {
    kv,
    ns: kv.ns,
    get persistent() {
      return kv.persistent;
    },
    limits,

    async getEntry<T>(key: string) {
      await ready();
      await settled(); // read your own writes
      let e = entries.get(key) as StoredEntry<T> | undefined;
      if (!e) {
        const fromKv = await kv.get<StoredEntry<T>>('entries', key);
        if (fromKv && typeof fromKv === 'object' && 'value' in fromKv) {
          e = fromKv;
          entries.set(key, e);
          entryMeta.set(key, { size: e.size ?? sizeOf(e.value), lastUsed: e.lastUsed ?? e.storedAt });
        }
      }
      if (!e) return undefined;
      const meta = entryMeta.get(key);
      if (meta) meta.lastUsed = now();
      return { value: e.value, storedAt: e.storedAt, etag: e.etag ?? null };
    },

    setEntry<T>(key: string, value: T, etag?: string | null) {
      return serial(async () => {
        await ready();
        let v: unknown = value;
        let size = sizeOf(v);
        if (size > limits.maxEntryBytes) {
          // A document with a huge text body is still worth caching without the text.
          const text = (v as { parsed_text?: unknown } | null)?.parsed_text;
          if (v && typeof v === 'object' && typeof text === 'string') {
            const { parsed_text: _drop, ...rest } = v as Record<string, unknown>;
            void _drop;
            v = rest;
            size = sizeOf(v);
          }
          if (size > limits.maxEntryBytes) return 'failed' as PutResult;
        }
        const t = now();
        const rec: StoredEntry = { value: v, storedAt: t, etag: etag ?? null, size, lastUsed: t };
        entryMeta.delete(key);
        await evictTo(limits.totalBudgetBytes, size, key);
        const r = await putWithRetry('entries', key, rec, key);
        if (r === 'ok') {
          entries.set(key, rec);
          entryMeta.set(key, { size, lastUsed: t });
          post({ t: 'cache', op: 'set', keys: [key] });
        }
        return r;
      });
    },

    deleteEntry(key: string) {
      return serial(async () => {
        await ready();
        await dropEntry(key);
        post({ t: 'cache', op: 'delete', keys: [key] });
      });
    },

    // ------------------------------------------------------------------------------- blobs
    async getBlob(key: string) {
      await ready();
      await settled();
      const meta = blobMeta.get(key);
      if (!meta) return undefined;
      const blob = await kv.get<CachedBlob>('blobs', key);
      if (!blob || !blob.bytes) {
        blobMeta.delete(key);
        return undefined;
      }
      const t = now();
      meta.lastUsed = t;
      if (t - meta.persistedUsed > TOUCH_PERSIST_MS) {
        meta.persistedUsed = t;
        void kv.update<CachedBlob>('blobs', key, (cur) => (cur ? { ...cur, lastUsed: t } : undefined));
      }
      return { ...blob, lastUsed: t };
    },

    putBlob(key: string, blob: Omit<CachedBlob, 'size' | 'storedAt' | 'lastUsed'>) {
      return serial(async () => {
        await ready();
        const size = blob.bytes.byteLength;
        if (size > limits.maxBlobBytes || size > limits.blobBudgetBytes) return 'failed' as PutResult;
        const t = now();
        const rec: CachedBlob = { bytes: blob.bytes, type: blob.type, etag: blob.etag, size, storedAt: t, lastUsed: t };
        blobMeta.delete(key);
        await trim(size, key);
        const r = await putWithRetry('blobs', key, rec, key);
        if (r === 'ok') blobMeta.set(key, { size, lastUsed: t, persistedUsed: t });
        return r;
      });
    },

    purge() {
      return serial(async () => {
        entries.clear();
        entryMeta.clear();
        blobMeta.clear();
        await kv.clear(['entries', 'blobs']);
        loaded = Promise.resolve();
        post({ t: 'cache', op: 'purge' });
      });
    },

    onExternalChange(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    close() {
      closed = true;
      listeners.clear();
      try {
        channel?.close();
      } catch {
        /* ignore */
      }
      channel = null;
    },
  };

  return store;
};
