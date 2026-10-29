/**
 * IndexedDB-backed key/value primitive with an in-memory fallback. Nothing here throws or rejects:
 * every IndexedDB call is wrapped, and any fatal error (no indexedDB, open failure or hang, a broken
 * transaction) moves the store to memory for the rest of the session (`persistent` flips to false).
 * Values must be structured-cloneable plain objects; bytes are stored as ArrayBuffer, never Blob.
 * Treat values read back as immutable.
 */

export type StoreName = 'entries' | 'blobs' | 'outbox';
export type PutResult = 'ok' | 'quota' | 'failed';

export interface Namespace {
  /** 32 hex chars: sha256(absoluteBaseUrl + NUL + cacheScope). The raw scope never appears anywhere. */
  id: string;
  /** False when the host gave no cacheScope (or no baseUrl): memory only. */
  persistent: boolean;
}

export interface KvStore {
  /** Namespace id (see `Namespace.id`). */
  readonly ns: string;
  /** True while data really goes to IndexedDB; flips to false after a fatal error. */
  readonly persistent: boolean;
  get<T = unknown>(store: StoreName, key: string): Promise<T | undefined>;
  put(store: StoreName, key: string, value: unknown): Promise<PutResult>;
  delete(store: StoreName, key: string): Promise<void>;
  /** All entries of this namespace in `store`, ordered by key. */
  list<T = unknown>(store: StoreName): Promise<Array<{ key: string; value: T }>>;
  /**
   * Read-modify-write in ONE readwrite transaction. `fn` must be synchronous. Returning undefined
   * deletes the key. Atomic against other tabs.
   */
  update<T = unknown>(store: StoreName, key: string, fn: (current: T | undefined) => T | undefined): Promise<PutResult>;
  /** Removes this namespace's data in `stores` (default: all three). */
  clear(stores?: StoreName[]): Promise<void>;
}

export interface OpenKvOptions {
  openTimeoutMs?: number;
}

export const DB_NAME = 'shelf-sdk';
export const DB_VERSION = 1;
export const STORE_NAMES: readonly StoreName[] = ['entries', 'blobs', 'outbox'];
/** BroadcastChannel name for cross-tab notifications in a namespace. */
export const STORAGE_CHANNEL = (ns: string): string => 'shelf-sdk:' + ns;

// ---------------------------------------------------------------- namespace

function fnv1a(str: string, seed: number): string {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

async function hash32(input: string): Promise<string> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (subtle) {
      const digest = await subtle.digest('SHA-256', new TextEncoder().encode(input));
      return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
    }
  } catch {
    /* fall through to FNV */
  }
  return fnv1a(input, 0) + fnv1a(input, 1) + fnv1a(input, 2) + fnv1a(input, 3);
}

function absoluteBase(baseUrl: string): string {
  let abs = baseUrl;
  try {
    abs = new URL(baseUrl, globalThis.location?.href).href;
  } catch {
    /* relative URL without a document: keep as given */
  }
  return abs.replace(/\/+$/, '');
}

export async function namespaceFor(opts: { baseUrl?: string; cacheScope?: string | false }): Promise<Namespace> {
  const scope = typeof opts.cacheScope === 'string' ? opts.cacheScope : undefined;
  const persistent = !!opts.baseUrl && scope !== undefined;
  const id = await hash32(absoluteBase(opts.baseUrl ?? '') + '\0' + (scope ?? ''));
  return { id, persistent };
}

// ------------------------------------------------------------------- memory

type MemMap = Map<StoreName, Map<string, unknown>>;

function memBackend(): Backend {
  const data: MemMap = new Map(STORE_NAMES.map((s) => [s, new Map<string, unknown>()]));
  const m = (s: StoreName) => data.get(s)!;
  return {
    async get(s, k) {
      return m(s).get(k);
    },
    async put(s, k, v) {
      m(s).set(k, v);
      return 'ok';
    },
    async delete(s, k) {
      m(s).delete(k);
    },
    async list(s) {
      return [...m(s).entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([key, value]) => ({ key, value }));
    },
    async update(s, k, fn) {
      try {
        const next = fn(m(s).get(k));
        if (next === undefined) m(s).delete(k);
        else m(s).set(k, next);
        return 'ok';
      } catch {
        return 'failed';
      }
    },
    async clear(stores) {
      for (const s of stores ?? STORE_NAMES) m(s).clear();
    },
  };
}

// ---------------------------------------------------------------- indexeddb

interface Backend {
  get(s: StoreName, k: string): Promise<unknown>;
  put(s: StoreName, k: string, v: unknown): Promise<PutResult>;
  delete(s: StoreName, k: string): Promise<void>;
  list(s: StoreName): Promise<Array<{ key: string; value: unknown }>>;
  update(s: StoreName, k: string, fn: (cur: unknown) => unknown): Promise<PutResult>;
  clear(stores?: StoreName[]): Promise<void>;
}

const NON_FATAL = new Set(['QuotaExceededError', 'DataCloneError', 'DataError']);
const errName = (e: unknown): string => (e as { name?: string } | null)?.name ?? '';
const isQuota = (e: unknown): boolean => errName(e) === 'QuotaExceededError';

/** One open connection per IDBFactory, so every KvStore in the page shares it. */
const connections = new WeakMap<object, Promise<IDBDatabase | null>>();

function openDb(factory: IDBFactory, timeoutMs: number): Promise<IDBDatabase | null> {
  const cached = connections.get(factory);
  if (cached) return cached;
  const p = new Promise<IDBDatabase | null>((resolve) => {
    let settled = false;
    const settle = (db: IDBDatabase | null) => {
      if (settled) {
        db?.close(); // opened after the timeout already gave up: do not leak the connection
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(db);
    };
    const timer = setTimeout(() => settle(null), timeoutMs);
    try {
      const req = factory.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        try {
          const db = req.result;
          for (const s of STORE_NAMES) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        } catch {
          /* open will fail below */
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          connections.delete(factory);
        };
        settle(db);
      };
      req.onerror = () => settle(null);
      req.onblocked = () => {
        /* the timeout decides */
      };
    } catch {
      settle(null);
    }
  }).then((db) => {
    if (!db) connections.delete(factory);
    return db;
  });
  connections.set(factory, p);
  return p;
}

function withTx<T>(db: IDBDatabase, store: StoreName, mode: IDBTransactionMode, body: (os: IDBObjectStore, set: (v: T) => void) => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let result: T;
    let tx: IDBTransaction;
    try {
      tx = db.transaction(store, mode);
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(tx.error ?? new DOMException('transaction aborted', 'AbortError'));
    tx.onerror = () => {
      /* onabort follows and carries the error */
    };
    try {
      body(tx.objectStore(store), (v) => {
        result = v;
      });
    } catch (e) {
      try {
        tx.abort();
      } catch {
        /* already finished */
      }
      reject(e);
    }
  });
}

function idbBackend(db: IDBDatabase, ns: string): Backend {
  const k = (key: string): IDBValidKey => [ns, key];
  const range = () => IDBKeyRange.bound([ns], [ns, []]);
  return {
    get: (s, key) =>
      withTx<unknown>(db, s, 'readonly', (os, set) => {
        const r = os.get(k(key));
        r.onsuccess = () => set(r.result);
      }),
    async put(s, key, v) {
      try {
        await withTx<void>(db, s, 'readwrite', (os) => {
          os.put(v, k(key));
        });
        return 'ok';
      } catch (e) {
        if (isQuota(e)) return 'quota';
        if (NON_FATAL.has(errName(e))) return 'failed';
        throw e;
      }
    },
    delete: (s, key) =>
      withTx<void>(db, s, 'readwrite', (os) => {
        os.delete(k(key));
      }),
    list: (s) =>
      withTx<Array<{ key: string; value: unknown }>>(db, s, 'readonly', (os, set) => {
        const out: Array<{ key: string; value: unknown }> = [];
        const cur = os.openCursor(range());
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            out.push({ key: String((c.key as IDBValidKey[])[1]), value: c.value });
            c.continue();
          } else set(out);
        };
      }),
    async update(s, key, fn) {
      let failed = false;
      let quota = false;
      try {
        await withTx<void>(db, s, 'readwrite', (os) => {
          const r = os.get(k(key));
          r.onsuccess = () => {
            try {
              const next = fn(r.result);
              if (next === undefined) os.delete(k(key));
              else os.put(next, k(key));
            } catch (e) {
              // Thrown inside an event handler: record it and abort, the rejection below reports it.
              if (isQuota(e)) quota = true;
              else failed = true;
              os.transaction.abort();
            }
          };
        });
        return 'ok';
      } catch (e) {
        if (quota) return 'quota';
        if (failed) return 'failed';
        if (isQuota(e)) return 'quota';
        if (NON_FATAL.has(errName(e))) return 'failed';
        throw e;
      }
    },
    async clear(stores) {
      for (const s of stores ?? STORE_NAMES) {
        await withTx<void>(db, s, 'readwrite', (os) => {
          os.delete(range());
        });
      }
    },
  };
}

// ------------------------------------------------------------------- openKv

export async function openKv(ns: Namespace, opts: OpenKvOptions = {}): Promise<KvStore> {
  const memory = memBackend();
  let backend: Backend = memory;
  let persistent = false;

  if (ns.persistent) {
    try {
      const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
      if (factory) {
        const db = await openDb(factory, opts.openTimeoutMs ?? 2000);
        if (db) {
          backend = idbBackend(db, ns.id);
          persistent = true;
        }
      }
    } catch {
      /* memory */
    }
  }

  /** Runs an op on IndexedDB; a fatal error moves everything to memory and re-runs the op there. */
  async function run<T>(op: (b: Backend) => Promise<T>, fallback: T): Promise<T> {
    try {
      return await op(backend);
    } catch {
      if (backend === memory) return fallback;
      backend = memory;
      persistent = false;
      try {
        return await op(memory);
      } catch {
        return fallback;
      }
    }
  }

  return {
    ns: ns.id,
    get persistent() {
      return persistent;
    },
    get: <T,>(s: StoreName, key: string) => run(async (b) => (await b.get(s, key)) as T | undefined, undefined),
    put: (s, key, value) => run((b) => b.put(s, key, value), 'failed' as PutResult),
    delete: (s, key) => run((b) => b.delete(s, key), undefined),
    list: <T,>(s: StoreName) => run(async (b) => (await b.list(s)) as Array<{ key: string; value: T }>, []),
    update: <T,>(s: StoreName, key: string, fn: (cur: T | undefined) => T | undefined) =>
      run((b) => b.update(s, key, fn as (cur: unknown) => unknown), 'failed' as PutResult),
    clear: (stores) => run((b) => b.clear(stores), undefined),
  };
}

/** Wipes the whole 'shelf-sdk' database (every namespace). In-memory stores are per-instance: clear those with `kv.clear()`. Never throws. */
export async function clearAllShelfData(opts: OpenKvOptions = {}): Promise<void> {
  try {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) return;
    const cached = connections.get(factory);
    if (cached) {
      connections.delete(factory);
      try {
        (await cached)?.close();
      } catch {
        /* ignore */
      }
    }
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, opts.openTimeoutMs ?? 2000);
      const done = () => {
        clearTimeout(timer);
        resolve();
      };
      try {
        const req = factory.deleteDatabase(DB_NAME);
        req.onsuccess = done;
        req.onerror = done;
        req.onblocked = () => {
          /* other tabs close on versionchange; the timeout bounds the wait */
        };
      } catch {
        done();
      }
    });
  } catch {
    /* never throws */
  }
}
