import { isAuthLost, isOfflineError, ShelfError } from '../client';
import type { ShelfClient } from '../client';
import type {
  CreateOutboxFn,
  CreateOutboxOptions,
  Outbox,
  OutboxEntry,
  OutboxEvents,
  OutboxOp,
  OutboxStatus,
} from '../internal/contracts';
import { STORAGE_CHANNEL } from '../storage/db';
import type { ShelfFolder, ShelfItem } from '../types';
import { fileKeyOf, isFolderOp, LOCAL_FOLDER } from './overlay';

const MiB = 1024 * 1024;
const MAX_ATTEMPTS = 8;
const CLAIM_TTL_MS = 120_000;
const CLAIM_BEAT_MS = 30_000;
const POLL_MS = 5_000;
const OTHER_OPS_CONCURRENCY = 4;
const SEQ_KEY = '~seq';

/** The slice of `navigator.locks` the outbox needs (injectable for tests). */
export interface LockManagerLike {
  request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => unknown): Promise<unknown>;
}

export interface OutboxOptions extends CreateOutboxOptions {
  /** One upload larger than this is kept in memory only (`durable: false`). Default 25 MiB. */
  maxFileBytes?: number;
  /** Total upload bytes persisted; beyond it new uploads stay in memory. Default 100 MiB. */
  maxBytes?: number;
  /** Default `navigator.locks`. Pass `null` to force the claim-in-IndexedDB fallback. */
  locks?: LockManagerLike | null;
  /** Called when the user discards an entry (revert optimistic state). */
  onDiscarded?: (entry: OutboxEntry) => void;
  /** Identifies this instance in claims. Default a fresh uuid. */
  tabId?: string;
  /** A claim older than this may be taken over. Default 120 000. */
  claimTtlMs?: number;
}

/** An entry as `list()` reports it: `durable` is false while it exists only in memory. */
export type PublicOutboxEntry = OutboxEntry & { durable: boolean };

export interface OutboxHandle extends Outbox {
  list(): PublicOutboxEntry[];
  enqueue(op: OutboxOp): Promise<PublicOutboxEntry>;
  /** Reachability as last observed by a request. */
  readonly offline: boolean;
}

interface Stored extends OutboxEntry {
  claimedBy?: string;
  claimedAt?: number;
  /** Retry with `force`: skip the compare-before-write check. */
  force?: boolean;
}

type Settle = { applied: ShelfItem | ShelfFolder | true } | { conflict: Partial<ShelfItem> | null; message: string };

function defaultUuid(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = ((b[6] ?? 0) & 0x0f) | 0x40;
  b[8] = ((b[8] ?? 0) & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export const createOutbox: CreateOutboxFn = (options: OutboxOptions): OutboxHandle => {
  const { kv, client } = options;
  const uploadConcurrency = Math.max(1, options.uploadConcurrency ?? 3);
  const baseMs = options.backoff?.baseMs ?? 1000;
  const maxMs = options.backoff?.maxMs ?? 60_000;
  const maxAttempts = options.maxAttempts ?? MAX_ATTEMPTS;
  const clock = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const uuid = options.uuid ?? defaultUuid;
  const maxFileBytes = options.maxFileBytes ?? 25 * MiB;
  const maxBytes = options.maxBytes ?? 100 * MiB;
  const claimTtl = options.claimTtlMs ?? CLAIM_TTL_MS;
  const tabId = options.tabId ?? uuid();
  const locks: LockManagerLike | null =
    options.locks !== undefined ? options.locks : ((globalThis as { navigator?: { locks?: LockManagerLike } }).navigator?.locks ?? null);

  const persisted = new Map<string, Stored>();
  const mem = new Map<string, Stored>();
  const running = new Map<string, AbortController>();
  /** `local:<ref>` / `local-folder:<ref>` -> server id for uploads and folders created by this instance (resolves ops queued meanwhile). */
  const appliedRefs = new Map<string, string>();
  const listeners: { [K in keyof OutboxEvents]: Set<(p: OutboxEvents[K]) => void> } = {
    change: new Set(),
    applied: new Set(),
    offline: new Set(),
    authLost: new Set(),
  };

  let started = false;
  let dead = false;
  let stopped = false; // auth lost: fail closed
  let offline = false;
  let pumping = false;
  let again = false;
  let bypassBackoff = false;
  let leader = false;
  let acquiring = false;
  let releaseLock: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let beat: ReturnType<typeof setInterval> | null = null;
  let localSeq = 0;
  let lastSig = '';
  let tail: Promise<unknown> = Promise.resolve();
  const waiters: Array<() => void> = [];
  const pubCache = new Map<string, { sig: string; entry: PublicOutboxEntry }>();
  const unsubs: Array<() => void> = [];
  let channel: BroadcastChannel | null = null;

  function emit<K extends keyof OutboxEvents>(event: K, payload: OutboxEvents[K]): void {
    for (const l of [...listeners[event]]) {
      try {
        l(payload);
      } catch {
        /* a listener must not break the outbox */
      }
    }
  }

  const all = (): Stored[] => [...persisted.values(), ...mem.values()].sort((a, b) => a.seq - b.seq);
  const isMem = (id: string): boolean => mem.has(id);

  function toPublic(rec: Stored): PublicOutboxEntry {
    const status: OutboxStatus = running.has(rec.id) ? 'running' : rec.status;
    const durable = !isMem(rec.id) && kv.persistent;
    const sig = `${rec.updatedAt}|${status}|${durable}`;
    const hit = pubCache.get(rec.id);
    if (hit && hit.sig === sig) return hit.entry;
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { claimedBy, claimedAt, force, ...rest } = rec;
    const entry: PublicOutboxEntry = { ...rest, status, durable };
    pubCache.set(rec.id, { sig, entry });
    return entry;
  }

  function list(): PublicOutboxEntry[] {
    const out = all().map(toPublic);
    const live = new Set(out.map((e) => e.id));
    for (const id of pubCache.keys()) if (!live.has(id)) pubCache.delete(id);
    return out;
  }

  function changed(): void {
    const l = list();
    const sig = l.map((e) => `${e.id}:${e.updatedAt}:${e.status}:${e.durable}`).join(',');
    if (sig === lastSig) return;
    lastSig = sig;
    emit('change', l);
  }

  function setOffline(v: boolean): void {
    if (offline === v) return;
    offline = v;
    emit('offline', v);
  }

  function notifyOthers(): void {
    try {
      channel?.postMessage({ from: tabId });
    } catch {
      /* closed */
    }
  }

  function mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = tail.then(fn, fn);
    tail = run.catch(() => undefined);
    return run;
  }

  async function reload(): Promise<void> {
    const rows = await kv.list<Stored>('outbox');
    persisted.clear();
    for (const r of rows) if (!r.key.startsWith('~') && r.value && typeof r.value === 'object') persisted.set(r.key, r.value);
    changed();
  }

  async function nextSeq(): Promise<number> {
    let n = 0;
    const res = await kv.update<{ n: number }>('outbox', SEQ_KEY, (cur) => {
      n = (cur?.n ?? 0) + 1;
      return { n };
    });
    if (res === 'ok' && n > 0) return n;
    localSeq = Math.max(localSeq + 1, clock());
    return localSeq;
  }

  /** Atomic read-modify-write of one entry (wherever it lives). `fn` returns the new record or undefined to delete. */
  async function patch(id: string, fn: (cur: Stored) => Stored | undefined): Promise<Stored | undefined> {
    const stamp = (cur: Stored, next: Stored): Stored => ({ ...next, updatedAt: Math.max(clock(), cur.updatedAt + 1) });
    const m = mem.get(id);
    if (m) {
      const next = fn(m);
      if (next) mem.set(id, next === m ? m : stamp(m, next));
      else mem.delete(id);
      changed();
      return mem.get(id);
    }
    let result: Stored | undefined;
    let touched = false;
    const res = await kv.update<Stored>('outbox', id, (cur) => {
      if (!cur) {
        result = undefined;
        touched = false;
        return undefined;
      }
      touched = true;
      const next = fn(cur);
      result = next === undefined || next === cur ? next : stamp(cur, next);
      return result;
    });
    if (res !== 'ok') return persisted.get(id);
    if (touched && result) persisted.set(id, result);
    else persisted.delete(id);
    changed();
    return result;
  }

  async function remove(id: string): Promise<void> {
    if (mem.delete(id)) {
      changed();
      return;
    }
    await kv.delete('outbox', id);
    persisted.delete(id);
    changed();
  }

  const freshClaim = (r: Stored): boolean => !!r.claimedBy && r.claimedBy !== tabId && clock() - (r.claimedAt ?? 0) < claimTtl;
  const isActive = (r: Stored): boolean => running.has(r.id) || freshClaim(r);

  // ---------------------------------------------------------------- enqueue

  async function store(rec: Stored, forceMem: boolean): Promise<Stored> {
    if (!forceMem && (await kv.put('outbox', rec.id, rec)) === 'ok') persisted.set(rec.id, rec);
    else mem.set(rec.id, rec);
    return rec;
  }

  function persistedUploadBytes(): number {
    let n = 0;
    for (const r of persisted.values()) if (r.op.kind === 'upload') n += r.op.bytes.byteLength;
    return n;
  }

  /** Changes queued against the not-yet-created `key` (`local:<ref>` or `local-folder:<ref>`). */
  function dependentsOf(key: string, except: string): Stored[] {
    return all().filter((r) => r.id !== except && r.op.kind !== 'upload' && r.op.kind !== 'createFolder' && fileKeyOf(r) === key);
  }

  const retarget = (op: OutboxOp, id: string): OutboxOp => ({ ...op, [isFolderOp(op) ? 'folderId' : 'fileId']: id }) as OutboxOp;

  /** The client's folder writes (optional on the interface). */
  const fc = (): Required<ShelfClient> => {
    if (!client.createFolder || !client.updateFolder || !client.deleteFolder) throw new Error('no folder writes');
    return client as Required<ShelfClient>;
  };

  async function enqueueInner(input: OutboxOp): Promise<PublicOutboxEntry> {
    if (dead) throw new Error('outbox destroyed');
    if (stopped) throw new Error('outbox stopped: authentication lost');
    await reload();
    let op = input;

    // Nothing goes into a folder that does not exist yet.
    const into = op.kind === 'createFolder' || op.kind === 'moveFolder' ? op.parentId : op.kind === 'upload' || op.kind === 'move' ? op.folderId : null;
    if (into?.startsWith(LOCAL_FOLDER)) throw new Error('the folder is not created yet');
    if (op.kind === 'upload' || op.kind === 'createFolder') op = { ...op, clientRef: op.clientRef || uuid() };

    if (op.kind !== 'upload' && op.kind !== 'createFolder') {
      const key = fileKeyOf({ op });
      if (key.startsWith(LOCAL_FOLDER) || key.startsWith('local:')) {
        const target = all().find((r) => (r.op.kind === 'upload' || r.op.kind === 'createFolder') && fileKeyOf(r) === key);
        if (target && !isActive(target)) {
          // Fold into the queued create/upload: nothing has been sent yet.
          const dep = dependentsOf(key, target.id);
          if (op.kind === 'delete' || op.kind === 'deleteFolder') {
            const gone = toPublic(target);
            await remove(target.id);
            for (const d of dep) await remove(d.id);
            notifyOthers();
            pump();
            return gone;
          }
          const o = op as { filename?: string; folderId?: string; name?: string; parentId?: string };
          const fields = 'filename' in o ? { filename: o.filename } : 'name' in o ? { name: o.name } : 'parentId' in o ? { parentId: o.parentId } : { folderId: o.folderId };
          const folded = await patch(target.id, (cur) => ({ ...cur, op: { ...cur.op, ...fields } }) as Stored);
          notifyOthers();
          if (folded) return toPublic(folded);
        } else if (!target) {
          const serverId = appliedRefs.get(key);
          if (!serverId) throw new Error('the queued item is gone');
          op = retarget(op, serverId);
        }
      }
    }

    // Coalesce with a waiting (never started) change to the same document or folder.
    if (op.kind !== 'upload' && op.kind !== 'createFolder') {
      const key = fileKeyOf({ op });
      const same = all().filter((r) => r.op.kind !== 'upload' && r.op.kind !== 'createFolder' && fileKeyOf(r) === key && r.status === 'pending' && !isActive(r));
      const o = op;
      if (o.kind === 'rename' || o.kind === 'move' || o.kind === 'renameFolder' || o.kind === 'moveFolder') {
        const prev = same.find((r) => r.op.kind === o.kind);
        if (prev) {
          const merged = await patch(prev.id, (cur) => {
            const c = cur.op;
            if (c.kind !== o.kind) return cur;
            // The first change's "base*" fields stay: that is what the user originally saw.
            return { ...cur, op: { ...o, ...Object.fromEntries(Object.entries(c).filter(([k]) => k.startsWith('base'))) } } as Stored;
          });
          notifyOthers();
          if (merged) return toPublic(merged);
        }
      } else {
        for (const r of same) if (r.op.kind !== 'delete' && r.op.kind !== 'deleteFolder') await remove(r.id);
        const dup = same.find((r) => r.op.kind === o.kind);
        if (dup) return toPublic(dup);
      }
    }

    const now = clock();
    const size = op.kind === 'upload' ? op.bytes.byteLength : 0;
    const forceMem = op.kind === 'upload' && (size > maxFileBytes || persistedUploadBytes() + size > maxBytes);
    const rec: Stored = {
      id: uuid(),
      seq: await nextSeq(),
      op,
      status: 'pending',
      attempts: 0,
      nextAttemptAt: 0,
      createdAt: now,
      updatedAt: now,
    };
    await store(rec, forceMem);
    changed();
    notifyOthers();
    start();
    return toPublic(rec);
  }

  // ---------------------------------------------------------------- drain

  function delayFor(attempts: number): number {
    const raw = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempts - 1));
    return Math.round(raw * (1 + (random() - 0.5) * 0.4));
  }

  function ensureLeadership(): void {
    if (!locks || leader || acquiring || stopped || dead) return;
    acquiring = true;
    const name = 'shelf-sdk:outbox:' + kv.ns;
    let p: Promise<unknown>;
    try {
      p = Promise.resolve(
        locks.request(name, { ifAvailable: true }, (lock) => {
          acquiring = false;
          if (!lock || dead) return undefined;
          leader = true;
          pump();
          return new Promise<void>((resolve) => {
            releaseLock = resolve;
          });
        }),
      );
    } catch {
      acquiring = false;
      return;
    }
    p.then(
      () => {
        leader = false;
        acquiring = false;
      },
      () => {
        leader = false;
        acquiring = false;
      },
    );
  }

  function pump(): void {
    if (!started || dead || stopped) return;
    if (pumping) {
      again = true;
      return;
    }
    pumping = true;
    void (async () => {
      try {
        do {
          again = false;
          await pass();
        } while (again && !dead && !stopped);
      } catch {
        /* a failing pass is retried on the next trigger */
      } finally {
        pumping = false;
        bypassBackoff = false;
        schedule();
        flushWaiters();
      }
    })();
  }

  function flushWaiters(): void {
    if (pumping || running.size > 0) return;
    for (const w of waiters.splice(0)) w();
  }

  async function pass(): Promise<void> {
    await reload();
    if (dead || stopped) return;
    ensureLeadership();
    const now = clock();
    const claimMode = !locks; // with locks only the leader drains shared entries
    const seen = new Set<string>();
    let uploads = 0;
    let others = 0;
    for (const id of running.keys()) {
      const r = persisted.get(id) ?? mem.get(id);
      if (r?.op.kind === 'upload') uploads++;
      else others++;
    }
    for (const rec of all()) {
      const key = fileKeyOf(rec);
      const blocked = seen.has(key);
      seen.add(key);
      if (blocked || rec.status !== 'pending' || running.has(rec.id)) continue;
      if (rec.nextAttemptAt > now && !bypassBackoff) continue;
      const shared = !isMem(rec.id);
      if (shared && !claimMode && !leader) continue;
      if (rec.op.kind === 'upload' ? uploads >= uploadConcurrency : others >= OTHER_OPS_CONCURRENCY) continue;
      if (rec.op.kind === 'upload') uploads++;
      else others++;
      const ac = new AbortController();
      running.set(rec.id, ac);
      let won = !shared;
      if (shared) {
        const mine = await patch(rec.id, (cur) => {
          if (cur.status !== 'pending') return cur;
          if (claimMode && freshClaim(cur)) return cur;
          won = true;
          return { ...cur, claimedBy: tabId, claimedAt: clock() };
        });
        if (!mine) won = false;
      }
      if (!won || dead || stopped) {
        running.delete(rec.id);
        if (rec.op.kind === 'upload') uploads--;
        else others--;
        continue;
      }
      changed();
      startBeat();
      void execute(rec, ac);
    }
  }

  function schedule(): void {
    if (timer) clearTimeout(timer);
    timer = null;
    if (dead || stopped || !started) return;
    const now = clock();
    let wait = Infinity;
    for (const r of all()) {
      if (r.status !== 'pending' || running.has(r.id)) continue;
      // Due but not started means blocked, or someone else's to drain: look again shortly.
      wait = Math.min(wait, r.nextAttemptAt > now ? r.nextAttemptAt - now : POLL_MS);
    }
    if (wait === Infinity) return;
    timer = setTimeout(() => {
      timer = null;
      pump();
    }, Math.max(0, wait));
  }

  function startBeat(): void {
    if (beat || dead) return;
    beat = setInterval(() => {
      if (running.size === 0) {
        stopBeat();
        return;
      }
      for (const id of running.keys()) {
        if (!isMem(id)) void patch(id, (cur) => (cur.claimedBy === tabId ? { ...cur, claimedAt: clock() } : cur));
      }
    }, CLAIM_BEAT_MS);
  }
  function stopBeat(): void {
    if (beat) clearInterval(beat);
    beat = null;
  }

  async function runOp(rec: Stored, signal: AbortSignal): Promise<Settle> {
    const op = rec.op;
    switch (op.kind) {
      case 'upload': {
        const item = await client.upload(
          new Blob([op.bytes], { type: op.contentType }),
          {
            filename: op.filename,
            client_ref: op.clientRef,
            ...(op.folderId ? { folder_id: op.folderId } : {}),
            ...(op.onDuplicate ? { on_duplicate: op.onDuplicate } : {}),
          },
          { signal },
        );
        return { applied: item };
      }
      case 'rename': {
        if (!rec.force) {
          const cur = await client.getFile(op.fileId, { signal });
          if (cur.filename === op.filename) return { applied: cur };
          if (cur.filename !== op.baseFilename) return { conflict: cur, message: `Renamed on the server to "${cur.filename}"` };
        }
        return { applied: await client.updateFile(op.fileId, { filename: op.filename }, { signal }) };
      }
      case 'move': {
        if (!rec.force) {
          const cur = await client.getFile(op.fileId, { signal });
          if (cur.folder_id === op.folderId) return { applied: cur };
          if (cur.folder_id !== op.baseFolderId) return { conflict: cur, message: 'Moved to another folder on the server' };
        }
        return { applied: await client.updateFile(op.fileId, { folder_id: op.folderId }, { signal }) };
      }
      case 'delete':
        await client.deleteFile(op.fileId, { signal });
        return { applied: true };
      case 'createFolder':
        // No idempotency key: a retry after an unknown outcome is told apart in classify (409).
        return { applied: await fc().createFolder({ name: op.name, ...(op.parentId ? { parent_id: op.parentId } : {}) }, { signal }) };
      case 'renameFolder':
      case 'moveFolder': {
        const rn = op.kind === 'renameFolder';
        const want = rn ? op.name : op.parentId;
        const base = rn ? op.baseName : op.baseParentId;
        if (!rec.force) {
          const cur = (await client.folders({ signal })).find((f) => f.id === op.folderId);
          if (!cur) return { conflict: null, message: 'deleted or moved out of reach' };
          const have = rn ? cur.name : (cur.parent_id ?? null);
          if (have === want) return { applied: cur };
          if (have !== base) return { conflict: null, message: rn ? `Renamed on the server to "${have}"` : 'Moved to another folder on the server' };
        }
        return { applied: await fc().updateFolder(op.folderId, rn ? { name: op.name } : { parent_id: op.parentId }, { signal }) };
      }
      case 'deleteFolder':
        await fc().deleteFolder(op.folderId, { signal });
        return { applied: true };
    }
  }

  async function execute(rec: Stored, ac: AbortController): Promise<void> {
    try {
      let outcome: Settle;
      try {
        outcome = await runOp(rec, ac.signal);
      } catch (err) {
        if (ac.signal.aborted || dead) return;
        outcome = await classify(rec, err);
      }
      if (ac.signal.aborted || dead) return;
      if ('applied' in outcome) await applied(rec, outcome.applied === true ? undefined : outcome.applied);
      else await settle(rec, 'conflict', { error: { message: outcome.message }, serverState: outcome.conflict ?? undefined });
    } catch {
      /* bookkeeping failed: the entry stays and is retried on the next pass */
    } finally {
      running.delete(rec.id);
      if (running.size === 0) stopBeat();
      if (!dead) {
        changed();
        pump();
      }
      flushWaiters();
    }
  }

  /** Turns a thrown error into the next state of the entry; returns a Settle only for outcomes that resolve it. */
  async function classify(rec: Stored, err: unknown): Promise<Settle> {
    if (isAuthLost(err)) {
      await authLost();
      throw err; // execute's caller treats it as dead below
    }
    const op = rec.op;
    if (isOfflineError(err)) {
      setOffline(true);
      await transient(rec, err);
      throw err;
    }
    setOffline(false);
    if (err instanceof ShelfError) {
      const info = { status: err.status, code: err.code, message: err.message };
      if (err.status === 404) {
        if (op.kind === 'delete' || op.kind === 'deleteFolder') return { applied: true };
        if (op.kind !== 'upload') return { conflict: null, message: 'deleted or moved out of reach' };
      }
      if (err.status === 409 && isFolderOp(op)) {
        if (op.kind === 'createFolder') {
          // Either an earlier attempt of ours landed (unknown outcome) or the name is taken: a sibling of that name settles it.
          try {
            const all = await client.folders();
            const root = all.find((f) => f.parent_id == null)?.id;
            const hit = all.find((f) => f.name.toLowerCase() === op.name.toLowerCase() && (f.parent_id ?? null) === (op.parentId ?? root ?? null));
            if (hit) return { applied: hit };
          } catch (e2) {
            return classify(rec, e2);
          }
        }
        await settle(rec, 'failed', { error: info }); // a cycle, nested too deep or a taken name: retrying cannot help
        throw err;
      }
      if (err.status === 409 || err.status >= 500) {
        await transient(rec, err);
        throw err;
      }
      await settle(rec, 'failed', { error: info }); // 400, 413, 415, 422 and anything else the server will not accept
      throw err;
    }
    await settle(rec, 'failed', { error: { message: message(err) } });
    throw err;
  }

  async function transient(rec: Stored, err: unknown): Promise<void> {
    const attempts = rec.attempts + 1;
    const info = err instanceof ShelfError ? { status: err.status, code: err.code, message: err.message } : { message: message(err) };
    if (attempts >= maxAttempts) await settle(rec, 'failed', { error: info, attempts });
    else await settle(rec, 'pending', { error: info, attempts, nextAttemptAt: clock() + delayFor(attempts) });
  }

  async function settle(
    rec: Stored,
    status: OutboxStatus,
    extra: { error?: OutboxEntry['error']; serverState?: Partial<ShelfItem>; attempts?: number; nextAttemptAt?: number },
  ): Promise<void> {
    await patch(rec.id, (cur) => {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { claimedBy, claimedAt, force, error, serverState, ...rest } = cur;
      return {
        ...rest,
        status,
        attempts: extra.attempts ?? cur.attempts,
        nextAttemptAt: extra.nextAttemptAt ?? 0,
        ...(extra.error ? { error: extra.error } : {}),
        ...(extra.serverState ? { serverState: extra.serverState } : {}),
      };
    });
    notifyOthers();
  }

  async function applied(rec: Stored, result: ShelfItem | ShelfFolder | undefined): Promise<void> {
    const folder = result && isFolderOp(rec.op) ? (result as ShelfFolder) : undefined;
    const item = result && !folder ? (result as ShelfItem) : undefined;
    setOffline(false);
    const snapshot = toPublic(rec);
    await remove(rec.id);
    if ((rec.op.kind === 'upload' || rec.op.kind === 'createFolder') && result) {
      const key = fileKeyOf(rec);
      appliedRefs.set(key, result.id);
      for (const d of dependentsOf(key, rec.id)) await patch(d.id, (cur) => ({ ...cur, op: retarget(cur.op, result.id) }));
    }
    notifyOthers();
    emit('applied', { entry: snapshot, ...(item ? { item } : {}), ...(folder ? { folder } : {}) });
  }

  async function purgeAll(): Promise<number> {
    for (const ac of running.values()) ac.abort();
    const count = persisted.size + mem.size;
    await kv.clear(['outbox']);
    persisted.clear();
    mem.clear();
    pubCache.clear();
    changed();
    notifyOthers();
    return count;
  }

  async function authLost(): Promise<void> {
    if (stopped) return;
    stopped = true;
    const discarded = await purgeAll();
    if (timer) clearTimeout(timer);
    timer = null;
    emit('authLost', { discarded });
  }

  // ---------------------------------------------------------------- api

  function start(): void {
    if (dead) return;
    started = true;
    if (!unsubs.length) {
      const w = globalThis as unknown as EventTarget;
      const onOnline = () => {
        bypassBackoff = true;
        setOffline(false);
        pump();
      };
      const onVisible = () => {
        if ((globalThis as { document?: { visibilityState?: string } }).document?.visibilityState !== 'hidden') {
          bypassBackoff = true;
          pump();
        }
      };
      if (typeof w.addEventListener === 'function') {
        w.addEventListener('online', onOnline);
        unsubs.push(() => w.removeEventListener('online', onOnline));
      }
      const doc = (globalThis as { document?: EventTarget }).document;
      if (doc?.addEventListener) {
        doc.addEventListener('visibilitychange', onVisible);
        unsubs.push(() => doc.removeEventListener('visibilitychange', onVisible));
      }
      unsubs.push(() => undefined);
    }
    pump();
  }

  const api: OutboxHandle = {
    list,
    get offline() {
      return offline;
    },
    enqueue: (op) => mutate(() => enqueueInner(op)),
    retry: (id, opts) =>
      mutate(async () => {
        await reload();
        const rec = persisted.get(id) ?? mem.get(id);
        if (!rec || (rec.status !== 'failed' && rec.status !== 'conflict')) return;
        await patch(id, (cur) => {
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { error, serverState, claimedBy, claimedAt, force, ...rest } = cur;
          return { ...rest, status: 'pending', attempts: 0, nextAttemptAt: 0, ...(opts?.force ? { force: true } : {}) };
        });
        notifyOthers();
        bypassBackoff = true;
        start();
      }),
    discard: (id) =>
      mutate(async () => {
        await reload();
        const rec = persisted.get(id) ?? mem.get(id);
        if (!rec) return;
        running.get(id)?.abort();
        await remove(id);
        if (rec.op.kind === 'upload' || rec.op.kind === 'createFolder') for (const d of dependentsOf(fileKeyOf(rec), id)) await remove(d.id);
        notifyOthers();
        try {
          options.onDiscarded?.(toPublic(rec));
        } catch {
          /* ignore */
        }
        pump();
      }),
    start,
    async idle() {
      await tail;
      while (pumping || running.size > 0) await new Promise<void>((r) => waiters.push(r));
    },
    purge: () => mutate(purgeAll),
    on(event, listener) {
      const set = listeners[event] as Set<typeof listener>;
      set.add(listener);
      return () => void set.delete(listener);
    },
    destroy() {
      if (dead) return;
      dead = true;
      if (timer) clearTimeout(timer);
      stopBeat();
      for (const u of unsubs.splice(0)) u();
      // Give shared claims back so a reloaded instance can take the work straight away.
      for (const [id, ac] of running) {
        ac.abort();
        if (!isMem(id)) void kv.update<Stored>('outbox', id, (cur) => (cur && cur.claimedBy === tabId ? omitClaim(cur) : cur));
      }
      running.clear();
      releaseLock?.();
      releaseLock = null;
      try {
        channel?.close();
      } catch {
        /* closed */
      }
      for (const w of waiters.splice(0)) w();
      for (const k of Object.keys(listeners) as Array<keyof OutboxEvents>) listeners[k].clear();
    },
  };

  try {
    if (typeof BroadcastChannel !== 'undefined') {
      channel = new BroadcastChannel(STORAGE_CHANNEL(kv.ns) + ':outbox');
      channel.onmessage = () => {
        if (!dead) pump();
        void reload();
      };
    }
  } catch {
    channel = null;
  }
  void reload();
  return api;
};

function omitClaim(cur: Stored): Stored {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { claimedBy, claimedAt, ...rest } = cur;
  return rest;
}
