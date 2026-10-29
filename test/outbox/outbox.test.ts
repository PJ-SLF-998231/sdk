// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createOutbox } from '../../src/outbox/outbox';
import type { OutboxHandle, OutboxOptions } from '../../src/outbox/outbox';
import type { OutboxEntry } from '../../src/internal/contracts';
import { bytes, err, fakeClient, fakeLocks, freshDb, item, openTestKv, tick, UUID_V4, upOp } from './helpers';
import type { FakeClient } from './helpers';
import type { KvStore } from '../../src/storage/db';

const live: OutboxHandle[] = [];
function make(kv: KvStore, client: FakeClient, o: Partial<OutboxOptions> = {}): OutboxHandle {
  const ob = createOutbox({ kv, client, locks: null, random: () => 0.5, ...o }) as OutboxHandle;
  live.push(ob);
  return ob;
}
const stored = async (kv: KvStore) => (await kv.list('outbox')).filter((r) => !r.key.startsWith('~'));
const online = () => window.dispatchEvent(new Event('online'));

beforeEach(() => freshDb());
afterEach(() => {
  for (const o of live.splice(0)) o.destroy();
  vi.useRealTimers();
});

describe('drain once', () => {
  async function scenario(locks: () => ReturnType<typeof fakeLocks> | null) {
    const kv = await openTestKv();
    const kv2 = await openTestKv();
    const client = fakeClient({ upload: async (_f: Blob, o: { filename?: string }) => (await tick(5), item({ id: 'srv-' + o.filename, filename: o.filename })) });
    const lm = locks();
    const a = make(kv, client, { locks: lm, tabId: 'tab-a' });
    const b = make(kv2, client, { locks: lm, tabId: 'tab-b' });
    a.start();
    b.start();
    for (let i = 0; i < 5; i++) await a.enqueue(upOp(`doc${i}.pdf`));
    await a.enqueue({ kind: 'rename', fileId: 'r1', filename: 'new.pdf', baseFilename: 'plan.pdf' });
    await b.enqueue({ kind: 'move', fileId: 'm1', folderId: 'dest', baseFolderId: null });
    await b.enqueue({ kind: 'delete', fileId: 'd1' });
    for (let i = 0; i < 3; i++) {
      online();
      await tick(2);
    }
    await vi.waitFor(async () => expect(await stored(kv)).toHaveLength(0), { timeout: 3000 });
    await a.idle();
    await b.idle();
    online();
    await a.idle();
    await b.idle();
    return { client, kv, a, b };
  }

  const verify = ({ client }: { client: FakeClient }) => {
    expect(client.upload).toHaveBeenCalledTimes(5);
    const refs = client.upload.mock.calls.map((c) => (c[1] as { client_ref: string }).client_ref);
    expect(new Set(refs).size).toBe(5);
    for (const r of refs) expect(r).toMatch(UUID_V4);
    expect(client.updateFile).toHaveBeenCalledTimes(2);
    expect(client.deleteFile).toHaveBeenCalledTimes(1);
  };

  it('with IndexedDB claims (no navigator.locks): each change is sent exactly once across two instances', async () => {
    const r = await scenario(() => null);
    verify(r);
    expect(r.a.list()).toHaveLength(0);
    expect(r.b.list()).toHaveLength(0);
  });

  it('with navigator.locks: one drainer, each change sent exactly once', async () => {
    const lm = fakeLocks();
    const r = await scenario(() => lm);
    verify(r);
    expect(lm.requests.every((q) => q.name === 'shelf-sdk:outbox:' + 'a'.repeat(32) && q.ifAvailable === true)).toBe(true);
    expect(lm.requests.some((q) => q.granted)).toBe(true);
  });
});

describe('locks', () => {
  it('a follower stays idle while another holds the lock and takes over when it is released', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const kv = await openTestKv();
    const client = fakeClient();
    const lm = fakeLocks();
    const lead = make(kv, client, { locks: lm, tabId: 'lead' });
    lead.start();
    await lead.idle();
    await vi.advanceTimersByTimeAsync(1);
    const follower = make(await openTestKv(), client, { locks: lm, tabId: 'follow' });
    follower.start();
    await follower.idle();
    await follower.enqueue(upOp('x.pdf'));
    await follower.idle();
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(1)); // the leader drained it, the follower did not
    expect(follower.list()).toHaveLength(0);
    lead.destroy();
    await vi.advanceTimersByTimeAsync(10);
    await follower.enqueue(upOp('y.pdf'));
    await vi.advanceTimersByTimeAsync(6000);
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(2));
  });
});

describe('claims', () => {
  it('skips an entry claimed by a live tab and takes over a stale claim after 120s', async () => {
    const kv = await openTestKv();
    let t = 1_000_000;
    const seed = {
      id: 'e1', seq: 1, op: { ...upOp('c.pdf'), clientRef: 'ref-1' }, status: 'pending', attempts: 0, nextAttemptAt: 0,
      createdAt: t, updatedAt: t, claimedBy: 'dead-tab', claimedAt: t - 10_000,
    };
    await kv.put('outbox', 'e1', seed);
    const client = fakeClient();
    const ob = make(kv, client, { now: () => t });
    ob.start();
    await ob.idle();
    expect(client.upload).not.toHaveBeenCalled();
    t += 130_000;
    online();
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(1));
    expect((client.upload.mock.calls[0]![1] as { client_ref: string }).client_ref).toBe('ref-1');
  });
});

describe('concurrency and ordering', () => {
  it('runs at most 3 uploads at once out of 10', async () => {
    const kv = await openTestKv();
    let inflight = 0;
    let max = 0;
    const client = fakeClient({
      upload: async () => {
        inflight++;
        max = Math.max(max, inflight);
        await tick(10);
        inflight--;
        return item({ id: 'srv' + Math.random() });
      },
    });
    const ob = make(kv, client);
    for (let i = 0; i < 10; i++) await ob.enqueue(upOp(`f${i}.pdf`));
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(10), { timeout: 3000 });
    await ob.idle();
    expect(max).toBe(3);
    expect(ob.list()).toHaveLength(0);
  });

  it('runs changes to the same document in order, one at a time', async () => {
    const kv = await openTestKv();
    const order: string[] = [];
    const client = fakeClient({
      getFile: async () => item({ id: 'z', filename: 'a.pdf', folder_id: null }),
      updateFile: async (_id: string, p: Record<string, string>) => (order.push(Object.keys(p)[0]!), await tick(10), item({ id: 'z' })),
      deleteFile: async () => void order.push('delete'),
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'rename', fileId: 'z', filename: 'b.pdf', baseFilename: 'a.pdf' });
    await ob.enqueue({ kind: 'move', fileId: 'z', folderId: 'f2', baseFolderId: null });
    await ob.idle();
    await vi.waitFor(() => expect(ob.list()).toHaveLength(0));
    expect(order).toEqual(['filename', 'folder_id']);
  });
});

describe('errors', () => {
  it('backs off 1000/2000/4000 and fails after 8 attempts; retry requeues', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    const kv = await openTestKv();
    const client = fakeClient({ upload: async () => { throw new TypeError('fetch failed'); } });
    const ob = make(kv, client);
    const offline: boolean[] = [];
    ob.on('offline', (v) => offline.push(v));
    await ob.enqueue(upOp('a.pdf'));
    await ob.idle();
    const waits: number[] = [];
    const e = () => ob.list()[0]!;
    waits.push(e().nextAttemptAt - Date.now());
    for (let i = 2; i <= 8; i++) {
      const d = e().nextAttemptAt - Date.now();
      await vi.advanceTimersByTimeAsync(d - 1);
      expect(client.upload).toHaveBeenCalledTimes(i - 1);
      await vi.advanceTimersByTimeAsync(1);
      await ob.idle();
      expect(client.upload).toHaveBeenCalledTimes(i);
      if (e().status !== 'failed') waits.push(e().nextAttemptAt - Date.now());
    }
    expect(waits.slice(0, 3)).toEqual([1000, 2000, 4000]);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000]);
    expect(e().status).toBe('failed');
    expect(e().attempts).toBe(8);
    expect(offline).toContain(true);
    client.upload.mockImplementation(async () => item({ id: 'ok' }));
    await ob.retry(e().id);
    await ob.idle();
    await vi.advanceTimersByTimeAsync(5);
    expect(client.upload).toHaveBeenCalledTimes(9);
    expect(ob.list()).toHaveLength(0);
  });

  it('fails a 415 immediately, without retrying', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ upload: async () => { throw err(415, 'unsupported_media_type'); } });
    const ob = make(kv, client);
    await ob.enqueue(upOp('a.xyz'));
    await ob.idle();
    const e = ob.list()[0]!;
    expect(e.status).toBe('failed');
    expect(e.error?.status).toBe(415);
    expect(client.upload).toHaveBeenCalledTimes(1);
    expect((await stored(kv))[0]!.value).toMatchObject({ status: 'failed' });
  });

  it.each([400, 413, 422])('fails %i immediately', async (status) => {
    const kv = await openTestKv();
    const client = fakeClient({ upload: async () => { throw err(status); } });
    const ob = make(kv, client);
    await ob.enqueue(upOp('a.pdf'));
    await ob.idle();
    expect(ob.list()[0]!.status).toBe('failed');
    expect(client.upload).toHaveBeenCalledTimes(1);
  });

  it('treats 409 as transient', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ upload: async () => { throw err(409); } });
    const ob = make(kv, client);
    await ob.enqueue(upOp('a.pdf'));
    await ob.idle();
    expect(ob.list()[0]!.status).toBe('pending');
    expect(ob.list()[0]!.attempts).toBe(1);
  });

  it('reports a rename conflict when the server filename differs, and discard fires onDiscarded', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ getFile: async () => item({ id: 'r', filename: 'someone-else.pdf' }) });
    const onDiscarded = vi.fn();
    const ob = make(kv, client, { onDiscarded });
    await ob.enqueue({ kind: 'rename', fileId: 'r', filename: 'mine.pdf', baseFilename: 'plan.pdf' });
    await ob.idle();
    const e = ob.list()[0]!;
    expect(e.status).toBe('conflict');
    expect(e.serverState?.filename).toBe('someone-else.pdf');
    expect(client.updateFile).not.toHaveBeenCalled();
    await ob.discard(e.id);
    expect(onDiscarded).toHaveBeenCalledTimes(1);
    expect((onDiscarded.mock.calls[0]![0] as OutboxEntry).id).toBe(e.id);
    expect(ob.list()).toHaveLength(0);
    expect(await stored(kv)).toHaveLength(0);
  });

  it('retry with force overwrites after a conflict', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ getFile: async () => item({ id: 'r', filename: 'someone-else.pdf' }) });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'rename', fileId: 'r', filename: 'mine.pdf', baseFilename: 'plan.pdf' });
    await ob.idle();
    await ob.retry(ob.list()[0]!.id, { force: true });
    await ob.idle();
    await vi.waitFor(() => expect(ob.list()).toHaveLength(0));
    expect(client.updateFile).toHaveBeenCalledWith('r', { filename: 'mine.pdf' }, expect.anything());
  });

  it('reports a move conflict when the folder differs, and 404 on rename/move as a conflict', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      getFile: async (id: string) => {
        if (id === 'gone') throw err(404, 'not_found');
        return item({ id, folder_id: 'elsewhere' });
      },
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'move', fileId: 'm', folderId: 'dest', baseFolderId: null });
    await ob.enqueue({ kind: 'rename', fileId: 'gone', filename: 'n.pdf', baseFilename: 'o.pdf' });
    await ob.idle();
    await vi.waitFor(() => expect(ob.list().map((e) => e.status)).toEqual(['conflict', 'conflict']));
    expect(ob.list()[1]!.error?.message).toMatch(/deleted or moved out of reach/);
    expect(client.updateFile).not.toHaveBeenCalled();
  });

  it('treats 404 on delete as applied', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ deleteFile: async () => { throw err(404, 'not_found'); } });
    const ob = make(kv, client);
    const applied = vi.fn();
    ob.on('applied', applied);
    await ob.enqueue({ kind: 'delete', fileId: 'x' });
    await ob.idle();
    await vi.waitFor(() => expect(ob.list()).toHaveLength(0));
    expect(applied).toHaveBeenCalledTimes(1);
    expect(await stored(kv)).toHaveLength(0);
  });

  it('on auth loss calls authLost once, purges the outbox and stops draining', async () => {
    const kv = await openTestKv();
    // The 401 is held back until all five are queued: no timing race between enqueueing and the rejection.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const client = fakeClient({ upload: async () => { await gate; throw err(401, 'unauthorized'); } });
    const ob = make(kv, client);
    const lost = vi.fn();
    ob.on('authLost', lost);
    for (let i = 0; i < 5; i++) await ob.enqueue(upOp(`f${i}.pdf`));
    release();
    await vi.waitFor(() => expect(lost).toHaveBeenCalled());
    // Wait on the observable end state (purged from memory and storage), not on a clock.
    await vi.waitFor(async () => {
      expect(ob.list()).toHaveLength(0);
      expect(await stored(kv)).toHaveLength(0);
    });
    await ob.idle();
    expect(lost).toHaveBeenCalledTimes(1);
    expect(lost.mock.calls[0]![0].discarded).toBe(5);
    expect(ob.list()).toHaveLength(0);
    expect(await stored(kv)).toHaveLength(0);
    const calls = client.upload.mock.calls.length;
    expect(calls).toBeLessThanOrEqual(3);
    online();
    await ob.idle();
    expect(client.upload.mock.calls.length).toBe(calls);
    await expect(ob.enqueue(upOp('late.pdf'))).rejects.toThrow(/authentication lost/);
  });

  it('503 not_configured is auth loss, plain 503 is offline', async () => {
    const kv = await openTestKv();
    const c1 = fakeClient({ deleteFile: async () => { throw err(503, 'not_configured'); } });
    const a = make(kv, c1);
    const lost = vi.fn();
    a.on('authLost', lost);
    await a.enqueue({ kind: 'delete', fileId: 'q' });
    await vi.waitFor(() => expect(lost).toHaveBeenCalledTimes(1));
    const kv2 = await openTestKv('b'.repeat(32));
    const c2 = fakeClient({ deleteFile: async () => { throw err(503, 'unavailable'); } });
    const b = make(kv2, c2);
    await b.enqueue({ kind: 'delete', fileId: 'q' });
    await b.idle();
    expect(b.list()[0]!.status).toBe('pending');
    expect(b.offline).toBe(true);
  });
});

describe('coalescing', () => {
  async function queuedOnly() {
    const kv = await openTestKv();
    const client = fakeClient();
    const lm = fakeLocks();
    lm.hold('shelf-sdk:outbox:' + kv.ns); // another tab is the drainer: nothing leaves this one
    const ob = make(kv, client, { locks: lm });
    return { kv, client, ob };
  }

  it('delete of a queued upload sends nothing and removes it', async () => {
    const { kv, client, ob } = await queuedOnly();
    const up = await ob.enqueue(upOp('a.pdf'));
    expect(ob.list()).toHaveLength(1);
    await ob.enqueue({ kind: 'delete', fileId: 'local:' + (up.op as { clientRef: string }).clientRef });
    await ob.idle();
    expect(ob.list()).toHaveLength(0);
    expect(await stored(kv)).toHaveLength(0);
    for (const m of [client.upload, client.getFile, client.updateFile, client.deleteFile]) expect(m).not.toHaveBeenCalled();
  });

  it('rename and move of a queued upload fold into it', async () => {
    const { client, ob } = await queuedOnly();
    const up = await ob.enqueue(upOp('a.pdf'));
    const ref = 'local:' + (up.op as { clientRef: string }).clientRef;
    await ob.enqueue({ kind: 'rename', fileId: ref, filename: 'b.pdf', baseFilename: 'a.pdf' });
    await ob.enqueue({ kind: 'move', fileId: ref, folderId: 'f9', baseFolderId: null });
    expect(ob.list()).toHaveLength(1);
    expect(ob.list()[0]!.op).toMatchObject({ kind: 'upload', filename: 'b.pdf', folderId: 'f9' });
    expect(client.upload).not.toHaveBeenCalled();
  });

  it('merges repeated renames and drops renames when the document is then deleted', async () => {
    const { ob } = await queuedOnly();
    await ob.enqueue({ kind: 'rename', fileId: 'z', filename: 'b.pdf', baseFilename: 'a.pdf' });
    await ob.enqueue({ kind: 'rename', fileId: 'z', filename: 'c.pdf', baseFilename: 'b.pdf' });
    expect(ob.list()).toHaveLength(1);
    expect(ob.list()[0]!.op).toMatchObject({ filename: 'c.pdf', baseFilename: 'a.pdf' });
    await ob.enqueue({ kind: 'delete', fileId: 'z' });
    expect(ob.list().map((e) => e.op.kind)).toEqual(['delete']);
  });
});

describe('reload', () => {
  it('a new outbox drains an entry the old one was sending, with the same client_ref', async () => {
    const kv = await openTestKv();
    let started!: () => void;
    const began = new Promise<void>((r) => (started = r));
    const first = fakeClient({ upload: (_f: Blob, _o: unknown, req?: { signal?: AbortSignal }) => new Promise((_res, rej) => { started(); req?.signal?.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))); }) });
    const a = make(kv, first);
    await a.enqueue(upOp('doc.pdf'));
    await began;
    const ref1 = (first.upload.mock.calls[0]![1] as { client_ref: string }).client_ref;
    a.destroy(); // page unload
    await tick(10);
    expect(await stored(kv)).toHaveLength(1);
    const second = fakeClient();
    const kv2 = await openTestKv();
    const b = make(kv2, second);
    b.start();
    await vi.waitFor(() => expect(second.upload).toHaveBeenCalledTimes(1));
    expect((second.upload.mock.calls[0]![1] as { client_ref: string }).client_ref).toBe(ref1);
    await vi.waitFor(async () => expect(await stored(kv2)).toHaveLength(0));
    expect(first.upload).toHaveBeenCalledTimes(1);
  });
});

describe('memory fallback', () => {
  it('keeps an oversized upload in memory (durable:false) and still uploads it', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const lm = fakeLocks();
    lm.hold('shelf-sdk:outbox:' + kv.ns);
    const ob = make(kv, client, { locks: lm, maxFileBytes: 10 });
    const big = await ob.enqueue(upOp('big.pdf', { size: 50 }));
    const small = await ob.enqueue(upOp('small.pdf', { size: 5 }));
    expect(big.durable).toBe(false);
    expect(small.durable).toBe(true);
    expect((await stored(kv)).map((r) => (r.value as { op: { filename: string } }).op.filename)).toEqual(['small.pdf']);
    // a memory entry belongs to this tab alone, so it drains here even without the lock
    ob.start();
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(1));
    expect((client.upload.mock.calls[0]![1] as { filename: string }).filename).toBe('big.pdf');
  });

  it('falls back to memory when the store reports quota', async () => {
    const kv = await openTestKv();
    const quota: KvStore = { ...kv, put: async (s, k, v) => (s === 'outbox' && k !== '~seq' ? 'quota' : kv.put(s, k, v)) } as KvStore;
    Object.defineProperty(quota, 'persistent', { get: () => true });
    const client = fakeClient();
    const ob = make(quota, client);
    const e = await ob.enqueue(upOp('q.pdf'));
    expect(e.durable).toBe(false);
    await vi.waitFor(() => expect(client.upload).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(ob.list()).toHaveLength(0));
  });

  it('reports durable:false when the store itself is memory-only', async () => {
    const kv = await openTestKv('c'.repeat(32), false);
    const client = fakeClient();
    const lm = fakeLocks();
    lm.hold('shelf-sdk:outbox:' + kv.ns);
    const ob = make(kv, client, { locks: lm });
    expect((await ob.enqueue(upOp('m.pdf'))).durable).toBe(false);
  });

  it('keeps bytes as an ArrayBuffer in storage', async () => {
    const kv = await openTestKv();
    const lm = fakeLocks();
    lm.hold('shelf-sdk:outbox:' + kv.ns);
    const ob = make(kv, fakeClient(), { locks: lm });
    await ob.enqueue({ ...upOp('b.pdf'), bytes: bytes(4) });
    const rec = (await stored(kv))[0]!.value as { op: { bytes: unknown } };
    expect(Object.prototype.toString.call(rec.op.bytes)).toBe('[object ArrayBuffer]');
  });
});
