import { createCacheStore } from '../cache/store';
import { registerPurge } from '../cache/purgeRegistry';
import { createSwr } from '../cache/swr';
import type { SwrImpl } from '../cache/swr';
import { createShelfClient, isAuthLost, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import type { CacheStore, ThumbLoader } from '../internal/contracts';
import type { OutboxHandle } from '../outbox';
import type { ApplyFolderOutboxFn, ApplyOutboxFn, FolderOutboxEntry, OutboxEntry, OverlayFolder } from '../internal/contracts';
import type { ShelfOfflineOptions } from './contracts';
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
  /** The overlay function; set together with `outbox` (both come from the lazily loaded outbox chunk). */
  applyOutbox: ApplyOutboxFn | null;
  /** Folder overlay; set with `applyOutbox` once the outbox chunk exports it (0.4 U3), else null. */
  applyFolderOutbox: ((folders: Parameters<ApplyFolderOutboxFn>[0], entries: readonly OutboxEntry[]) => OverlayFolder[]) | null;
  /** Host callbacks already told about the lost session, so each hears it once however many hooks share the session. */
  readonly notified: Set<unknown>;
  /**
   * Creates the outbox once the store is open; null while it is not, while the (lazy) outbox chunk is loading
   * or after the session was lost. Read-only hosts never call it, so they never download the chunk.
   * Listeners of `onReady` are told when the chunk has arrived.
   */
  ensureOutbox(opts?: Pick<ShelfOfflineOptions, 'uploadConcurrency' | 'maxAttempts'>): OutboxHandle | null;
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
  applyOutbox: ApplyOutboxFn | null = null;
  applyFolderOutbox: Session['applyFolderOutbox'] = null;
  readonly notified = new Set<unknown>();
  private outboxMod: typeof import('../outbox') | null = null;
  private outboxLoading = false;
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
      const session = this;
      // The thumbnail loader is built on first use (a getter), so hooks that never draw a thumbnail never fetch its chunk.
      this.parts = {
        cache,
        swr,
        get loader() {
          return (session.thumbs ??= lazyThumbLoader(session.client, cache));
        },
      };
      this.unregister = registerPurge(async () => {
        await swr.purge();
      });
      for (const l of [...this.readyListeners]) l();
    } catch {
      /* the cache is an optimisation: without it the view still loads, just not from cache */
    }
  }

  private lastAuthError: unknown;
  thumbs: ThumbLoader | null = null;

  ensureOutbox(opts?: Pick<ShelfOfflineOptions, 'uploadConcurrency' | 'maxAttempts'>): OutboxHandle | null {
    if (this.outbox) return this.outbox;
    if (!this.parts || this.disposed || this.authLost) return null;
    if (!this.outboxMod) {
      if (!this.outboxLoading) {
        this.outboxLoading = true;
        import('../outbox').then(
          (m) => {
            this.outboxMod = m;
            this.applyOutbox = m.applyOutbox;
            // Takes the whole queue: the folder operations in it (isFolderOp) are what the overlay applies.
            this.applyFolderOutbox = (folders, entries) => m.applyFolderOutbox(folders, entries.filter((e): e is FolderOutboxEntry => m.isFolderOp(e.op)));
            if (!this.disposed) for (const l of [...this.readyListeners]) l();
          },
          () => {
            this.outboxLoading = false; // a failed chunk load: the next render retries
          },
        );
      }
      return null;
    }
    // Persistent exactly when the cache is (the host gave a cacheScope); otherwise the kv is memory-only.
    const ob = this.outboxMod.createOutbox({
      kv: this.parts.cache.kv,
      client: this.client,
      ...(opts?.uploadConcurrency !== undefined ? { uploadConcurrency: opts.uploadConcurrency } : {}),
      ...(opts?.maxAttempts !== undefined ? { maxAttempts: opts.maxAttempts } : {}),
    }) as OutboxHandle;
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
      this.thumbs?.dispose();
      this.thumbs = null;
      p.cache.close();
    }
    this.lostListeners.clear();
    this.readyListeners.clear();
    this.discardListeners.clear();
  }
}

/** A ThumbLoader whose implementation (src/cache/thumbs) is imported on first use. */
function lazyThumbLoader(client: ShelfClient, cache: CacheStore): ThumbLoader {
  let inner: ThumbLoader | null = null;
  let disposed = false;
  const ready = import('../cache/thumbs').then((m) => (disposed ? null : (inner = m.createThumbLoader({ client, cache }))));
  return {
    load: (req) => ready.then((l) => (l ? l.load(req) : null)),
    peek: (id, size) => inner?.peek(id, size) ?? null,
    dispose() {
      disposed = true;
      inner?.dispose();
      inner = null;
    },
  };
}

/**
 * Wraps a client so a lost session reported by any call reaches `onLost` before the error propagates. Every
 * function-valued member is wrapped except the `*Url` builders (synchronous, no request), so methods added to
 * the client later are covered without touching this.
 */
function guardClient(raw: ShelfClient, onLost: (err: unknown) => void): ShelfClient {
  const guarded: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value !== 'function' || name.endsWith('Url')) {
      guarded[name] = value;
      continue;
    }
    guarded[name] = async (...args: unknown[]) => {
      try {
        return await (value as (...a: unknown[]) => unknown).apply(raw, args);
      } catch (err) {
        if (isAuthLost(err)) onLost(err);
        throw err;
      }
    };
  }
  return guarded as unknown as ShelfClient;
}

const clients = new Map<string, ShelfClient>();
/** One client per base URL, so every hook and component on the same base URL shares a session and its requests. */
export function clientForBaseUrl(baseUrl: string): ShelfClient {
  let c = clients.get(baseUrl);
  if (!c) {
    c = createShelfClient({ baseUrl });
    clients.set(baseUrl, c);
  }
  return c;
}

/** Number of live sessions (tests: a server render must create none). Not part of the public API. */
export function sessionCount(): number {
  return registry.size;
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
