import { createCacheStore } from '../cache/store';
import { registerPurge } from '../cache/purgeRegistry';
import { createSwr } from '../cache/swr';
import type { SwrImpl } from '../cache/swr';
import { createThumbLoader } from '../cache/thumbs';
import { isAuthLost, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import type { CacheStore, ThumbLoader } from '../internal/contracts';
import { createOutbox } from '../outbox';
import type { OutboxHandle } from '../outbox';
import { namespaceFor, openKv } from '../storage/db';

export interface SessionParts {
  cache: CacheStore;
  swr: SwrImpl;
  loader: ThumbLoader;
}

/**
 * The cache, SWR engine and thumbnail loader of one ShelfFolder scope. Shared by every ShelfFolder with the
 * same client + cacheScope; disposed when the last one unmounts. React-free so it can be tested alone.
 */
export interface Session {
  /** The client to use: it reports a lost session (401 / not_configured) to this session. */
  readonly client: ShelfClient;
  /** Null until the store has opened (a few ms; immediately for a memory-only cache). */
  parts: SessionParts | null;
  /** True once the session was lost; the entry is no longer shared. */
  authLost: boolean;
  disposed: boolean;
  /** The offline outbox; null until `ensureOutbox()` has run (read_write keys only). */
  outbox: OutboxHandle | null;
  /** How many queued changes were thrown away when the session was lost. */
  discarded: number;
  /** Creates the outbox once the store is open; null while it is not or after the session was lost. */
  ensureOutbox(): OutboxHandle | null;
  onAuthLost(listener: (err: ShelfError) => void): () => void;
  onReady(listener: () => void): () => void;
  /** `discarded` changed. */
  onDiscarded(listener: () => void): () => void;
  /** Reports a lost session (idempotent): purges the cache and tells listeners. */
  loseAuth(err: unknown): void;
  retain(): void;
  release(): void;
}

const registry = new Map<unknown, SessionImpl>();
const IDLE_DISPOSE_MS = 5000;

class SessionImpl implements Session {
  parts: SessionParts | null = null;
  authLost = false;
  disposed = false;
  outbox: OutboxHandle | null = null;
  discarded = 0;
  private discardListeners = new Set<() => void>();
  readonly client: ShelfClient;
  private refs = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lostListeners = new Set<(err: ShelfError) => void>();
  private readyListeners = new Set<() => void>();
  private unregister: (() => void) | null = null;

  constructor(
    private readonly raw: ShelfClient,
    private readonly key: unknown,
    scope: string | false | undefined,
  ) {
    this.client = guardClient(raw, (e) => this.loseAuth(e));
    void this.open(scope);
    // Rendered but never mounted (an abandoned render): do not keep a store open for ever.
    this.armIdle();
  }

  private async open(scope: string | false | undefined): Promise<void> {
    try {
      const ns = await namespaceFor({ baseUrl: this.raw.baseUrl, cacheScope: scope });
      const kv = await openKv(ns);
      if (this.disposed) return;
      const cache = createCacheStore(kv);
      const swr = createSwr(cache, { onAuthLost: () => this.loseAuth(this.lastAuthError) });
      const loader = createThumbLoader({ client: this.client, cache });
      this.parts = { cache, swr, loader };
      this.unregister = registerPurge(async () => {
        await swr.purge();
      });
      for (const l of [...this.readyListeners]) l();
    } catch {
      /* the cache is an optimisation: without it the view still loads, just not from cache */
    }
  }

  private lastAuthError: unknown;

  ensureOutbox(): OutboxHandle | null {
    if (this.outbox) return this.outbox;
    if (!this.parts || this.disposed || this.authLost) return null;
    // Persistent exactly when the cache is (the host gave a cacheScope); otherwise the kv is memory-only.
    const ob = createOutbox({ kv: this.parts.cache.kv, client: this.client }) as OutboxHandle;
    ob.on('authLost', ({ discarded }) => this.noteDiscarded(discarded));
    this.outbox = ob;
    return ob;
  }

  private noteDiscarded(n: number): void {
    if (n <= this.discarded) return;
    this.discarded = n;
    for (const l of [...this.discardListeners]) l();
  }

  onDiscarded(listener: () => void): () => void {
    this.discardListeners.add(listener);
    return () => void this.discardListeners.delete(listener);
  }

  /** Queued changes are thrown away with the session: from the live outbox, or straight from storage. */
  private async purgeOutbox(): Promise<void> {
    try {
      if (this.outbox) {
        this.noteDiscarded(await this.outbox.purge());
      } else if (this.parts) {
        const kv = this.parts.cache.kv;
        const rows = await kv.list('outbox');
        this.noteDiscarded(rows.filter((r) => !r.key.startsWith('~')).length);
        await kv.clear(['outbox']);
      }
    } catch {
      /* best effort */
    }
  }

  loseAuth(err: unknown): void {
    if (this.authLost || this.disposed) return;
    this.authLost = true;
    this.lastAuthError = err;
    if (registry.get(this.key) === this) registry.delete(this.key);
    const e = err instanceof ShelfError ? err : new ShelfError(401, 'unauthorized', 'The session is no longer authorised');
    void Promise.all([this.parts ? this.parts.swr.purge() : Promise.resolve(), this.purgeOutbox()]).finally(() => {
      for (const l of [...this.lostListeners]) {
        try {
          l(e);
        } catch {
          /* host callback must not break the view */
        }
      }
    });
  }

  onAuthLost(listener: (err: ShelfError) => void): () => void {
    this.lostListeners.add(listener);
    return () => void this.lostListeners.delete(listener);
  }

  onReady(listener: () => void): () => void {
    this.readyListeners.add(listener);
    return () => void this.readyListeners.delete(listener);
  }

  private armIdle(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.refs === 0) this.dispose();
    }, IDLE_DISPOSE_MS);
  }

  retain(): void {
    this.refs++;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  release(): void {
    this.refs = Math.max(0, this.refs - 1);
    // Deferred: StrictMode unmounts and remounts straight away and must find the session alive.
    if (this.refs === 0) this.armIdle();
  }

  private dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (registry.get(this.key) === this) registry.delete(this.key);
    this.unregister?.();
    const p = this.parts;
    this.parts = null;
    this.outbox?.destroy();
    this.outbox = null;
    if (p) {
      p.swr.destroy();
      p.loader.dispose();
      p.cache.close();
    }
    this.lostListeners.clear();
    this.readyListeners.clear();
    this.discardListeners.clear();
  }
}

/** Wraps a client so a lost session reported by any call reaches `onLost` before the error propagates. */
function guardClient(raw: ShelfClient, onLost: (err: unknown) => void): ShelfClient {
  const wrap = <K extends 'info' | 'folders' | 'listFiles' | 'getFile' | 'upload' | 'updateFile' | 'deleteFile'>(name: K): ShelfClient[K] =>
    (async (...args: unknown[]) => {
      try {
        return await (raw[name] as (...a: unknown[]) => Promise<unknown>).apply(raw, args);
      } catch (err) {
        if (isAuthLost(err)) onLost(err);
        throw err;
      }
    }) as ShelfClient[K];
  const guarded: ShelfClient = {
    baseUrl: raw.baseUrl,
    info: wrap('info'),
    folders: wrap('folders'),
    listFiles: wrap('listFiles'),
    getFile: wrap('getFile'),
    upload: wrap('upload'),
    updateFile: wrap('updateFile'),
    deleteFile: wrap('deleteFile'),
    thumbnailUrl: (id, size) => raw.thumbnailUrl(id, size),
    originalUrl: (id, name) => raw.originalUrl(id, name),
  };
  if (typeof raw.thumbnail === 'function') {
    guarded.thumbnail = async (...args) => {
      try {
        return await raw.thumbnail!.apply(raw, args);
      } catch (err) {
        if (isAuthLost(err)) onLost(err);
        throw err;
      }
    };
  }
  return guarded;
}

/**
 * The session for this client + scope, created if there is none. Sessions with a `cacheScope` are shared by
 * client base URL + scope; memory-only ones belong to their client. Call `retain()` in an effect and
 * `release()` in its cleanup.
 */
export function getSession(client: ShelfClient, cacheScope: string | false | undefined): Session {
  const scoped = typeof cacheScope === 'string' && !!client.baseUrl;
  const key: unknown = scoped ? `${client.baseUrl}\0${cacheScope}` : client;
  const existing = registry.get(key);
  if (existing && !existing.disposed && !existing.authLost) return existing;
  const made = new SessionImpl(client, key, scoped ? cacheScope : undefined);
  registry.set(key, made);
  return made;
}

/** Tears every session down at once (tests simulate a page reload with it). Not part of the public API. */
export function disposeAllSessions(): void {
  for (const s of [...registry.values()]) (s as unknown as { dispose(): void }).dispose();
  registry.clear();
}
