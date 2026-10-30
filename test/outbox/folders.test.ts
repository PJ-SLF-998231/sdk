// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createOutbox } from '../../src/outbox/outbox';
import type { OutboxHandle, OutboxOptions } from '../../src/outbox/outbox';
import { applyFolderOutbox } from '../../src/outbox/overlay';
import type { FolderOutboxEntry, FolderOutboxOp } from '../../src/internal/contracts';
import { err, fakeClient, fakeLocks, folder, freshDb, openTestKv, upOp } from './helpers';
import type { FakeClient } from './helpers';
import type { KvStore } from '../../src/storage/db';

const live: OutboxHandle[] = [];
function make(kv: KvStore, client: FakeClient, o: Partial<OutboxOptions> = {}): OutboxHandle {
  const ob = createOutbox({ kv, client, locks: null, random: () => 0.5, ...o }) as OutboxHandle;
  live.push(ob);
  return ob;
}
const stored = async (kv: KvStore) => (await kv.list('outbox')).filter((r) => !r.key.startsWith('~'));

beforeEach(() => freshDb());
afterEach(() => {
  for (const o of live.splice(0)) o.destroy();
});

const create = (name = 'Invoices', parentId: string | null = null): FolderOutboxOp => ({ kind: 'createFolder', name, parentId, clientRef: 'ref-' + name });

/** A drain lock held by someone else: the outbox persists but never sends. */
function fakeLocksHeld() {
  const lm = fakeLocks();
  lm.hold('shelf-sdk:outbox:' + 'a'.repeat(32));
  return lm;
}

describe('folder operations in the outbox', () => {
  it('create: POSTs once and emits applied with the folder', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client);
    const applied: unknown[] = [];
    ob.on('applied', (p) => applied.push(p));
    await ob.enqueue(create('Invoices', 'root'));
    await ob.idle();
    expect(client.createFolder).toHaveBeenCalledTimes(1);
    expect(client.createFolder.mock.calls[0]![0]).toEqual({ name: 'Invoices', parent_id: 'root' });
    expect(ob.list()).toHaveLength(0);
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({ folder: { name: 'Invoices' } });
  });

  it('create with a null parent sends no parent_id (the key folder)', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client);
    await ob.enqueue(create('Top'));
    await ob.idle();
    expect(client.createFolder.mock.calls[0]![0]).toEqual({ name: 'Top' });
  });

  it('retry after an unknown outcome: 409 resolves to applied with no second folder', async () => {
    const kv = await openTestKv();
    let calls = 0;
    const client = fakeClient({
      createFolder: async () => {
        calls++;
        if (calls === 1) throw new TypeError('network lost after the server created it');
        throw err(409, 'conflict');
      },
      folders: async () => [folder({ id: 'root', name: 'Key', parent_id: null }), folder({ id: 'made', name: 'Invoices', parent_id: 'root' })],
    });
    const ob = make(kv, client);
    const applied: Array<{ folder?: { id: string } }> = [];
    ob.on('applied', (p) => applied.push(p));
    await ob.enqueue(create('Invoices'));
    await ob.idle();
    expect(ob.list()[0]!.status).toBe('pending');
    window.dispatchEvent(new Event('online')); // back online: retry without waiting out the backoff
    await ob.idle();
    expect(calls).toBe(2);
    expect(ob.list()).toHaveLength(0);
    expect(applied).toHaveLength(1);
    expect(applied[0]!.folder!.id).toBe('made');
  });

  it('create 409 with no sibling of that name fails (too deep etc.)', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      createFolder: async () => {
        throw err(409);
      },
    });
    const ob = make(kv, client);
    await ob.enqueue(create('Nope'));
    await ob.idle();
    expect(ob.list()[0]).toMatchObject({ status: 'failed' });
    expect(client.createFolder).toHaveBeenCalledTimes(1);
  });

  it('rename conflict: the server name differs from what the user saw', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ folders: async () => [folder({ id: 'fo1', name: 'Someone else' })] });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'renameFolder', folderId: 'fo1', name: 'Mine', baseName: 'Plans' });
    await ob.idle();
    expect(ob.list()[0]).toMatchObject({ status: 'conflict', error: { message: 'Renamed on the server to "Someone else"' } });
    expect(client.updateFolder).not.toHaveBeenCalled();
    await ob.retry(ob.list()[0]!.id, { force: true });
    await ob.idle();
    expect(client.updateFolder).toHaveBeenCalledWith('fo1', { name: 'Mine' }, expect.anything());
    expect(ob.list()).toHaveLength(0);
  });

  it('rename that already matches the server is applied without a write', async () => {
    const kv = await openTestKv();
    const client = fakeClient({ folders: async () => [folder({ id: 'fo1', name: 'Mine' })] });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'renameFolder', folderId: 'fo1', name: 'Mine', baseName: 'Plans' });
    await ob.idle();
    expect(client.updateFolder).not.toHaveBeenCalled();
    expect(ob.list()).toHaveLength(0);
  });

  it('move-cycle 409 fails permanently (no retries)', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      updateFolder: async () => {
        throw err(409, 'conflict');
      },
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'moveFolder', folderId: 'fo1', parentId: 'child', baseParentId: 'root' });
    await ob.idle();
    expect(ob.list()[0]).toMatchObject({ status: 'failed', error: { status: 409 } });
    expect(client.updateFolder).toHaveBeenCalledTimes(1);
  });

  it('root 403 fails permanently', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      deleteFolder: async () => {
        throw err(403, 'forbidden');
      },
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'deleteFolder', folderId: 'root' });
    await ob.idle();
    expect(ob.list()[0]).toMatchObject({ status: 'failed', error: { status: 403 } });
    expect(client.deleteFolder).toHaveBeenCalledTimes(1);
  });

  it('delete 404 is applied', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      deleteFolder: async () => {
        throw err(404, 'not_found');
      },
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'deleteFolder', folderId: 'gone' });
    await ob.idle();
    expect(ob.list()).toHaveLength(0);
    expect(await stored(kv)).toHaveLength(0);
  });

  it('rename/move 404 is a conflict', async () => {
    const kv = await openTestKv();
    const client = fakeClient({
      folders: async () => [folder({ id: 'fo1', name: 'Plans' })],
      updateFolder: async () => {
        throw err(404, 'not_found');
      },
    });
    const ob = make(kv, client);
    await ob.enqueue({ kind: 'renameFolder', folderId: 'fo1', name: 'B', baseName: 'Plans' });
    await ob.idle();
    expect(ob.list()[0]!.status).toBe('conflict');
  });

  it('rename of an unsynced local folder collapses into its create', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client, { locks: fakeLocksHeld() });
    const e = await ob.enqueue(create('Draft'));
    await ob.enqueue({ kind: 'renameFolder', folderId: 'local-folder:ref-Draft', name: 'Final', baseName: 'Draft' });
    await ob.enqueue({ kind: 'moveFolder', folderId: 'local-folder:ref-Draft', parentId: 'other', baseParentId: null });
    expect(ob.list()).toHaveLength(1);
    expect(ob.list()[0]!.op).toMatchObject({ kind: 'createFolder', name: 'Final', parentId: 'other' });
    expect(ob.list()[0]!.id).toBe(e.id);
    ob.destroy();
    const ob2 = make(kv, client);
    ob2.start();
    await ob2.idle();
    expect(client.createFolder).toHaveBeenCalledTimes(1);
    expect(client.createFolder.mock.calls[0]![0]).toEqual({ name: 'Final', parent_id: 'other' });
    expect(client.updateFolder).not.toHaveBeenCalled();
  });

  it('delete of an unsynced local folder removes its create; nothing is sent', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client, { locks: fakeLocksHeld() });
    await ob.enqueue(create('Draft'));
    await ob.enqueue({ kind: 'deleteFolder', folderId: 'local-folder:ref-Draft' });
    expect(ob.list()).toHaveLength(0);
    expect(await stored(kv)).toHaveLength(0);
    expect(client.createFolder).not.toHaveBeenCalled();
  });

  it('upload into a local folder is rejected; so are moves and creates into it', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client, { locks: fakeLocksHeld() });
    await ob.enqueue(create('Draft'));
    const lf = 'local-folder:ref-Draft';
    await expect(ob.enqueue(upOp('a.pdf', { folderId: lf }))).rejects.toThrow(/not created/);
    await expect(ob.enqueue({ kind: 'move', fileId: 'f', folderId: lf, baseFolderId: null })).rejects.toThrow();
    await expect(ob.enqueue({ kind: 'moveFolder', folderId: 'fo1', parentId: lf, baseParentId: null })).rejects.toThrow();
    await expect(ob.enqueue(create('Sub', lf))).rejects.toThrow();
    expect(ob.list()).toHaveLength(1);
  });

  it('offline create survives reload and drains exactly one POST', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const a = make(kv, client, { locks: fakeLocksHeld() }); // another tab holds the drain lock: a only persists
    const queued = await a.enqueue(create('Offline'));
    expect(await stored(kv)).toHaveLength(1);
    a.destroy();
    expect(client.createFolder).not.toHaveBeenCalled();

    const kv2 = await openTestKv(); // a reload: new instance, same IndexedDB
    const b = make(kv2, client);
    b.start();
    await b.idle();
    expect(client.createFolder).toHaveBeenCalledTimes(1);
    expect(client.createFolder.mock.calls[0]![0]).toEqual({ name: 'Offline' });
    expect(queued.op).toMatchObject({ kind: 'createFolder', clientRef: 'ref-Offline' });
    expect(await stored(kv2)).toHaveLength(0);
    // a second reload finds nothing left to send
    const c = make(await openTestKv(), client);
    c.start();
    await c.idle();
    expect(client.createFolder).toHaveBeenCalledTimes(1);
  });

  it('operations queued against a folder whose create is in flight run after it, on the server id', async () => {
    const kv = await openTestKv();
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const inFlight = new Promise<void>((r) => (started = r));
    const client = fakeClient({
      createFolder: async (i: { name: string }) => {
        started();
        await gate;
        return folder({ id: 'srv-1', name: i.name, parent_id: 'root' });
      },
    });
    const ob = make(kv, client);
    await ob.enqueue(create('Draft'));
    await inFlight;
    expect(ob.list()[0]!.status).toBe('running');
    await ob.enqueue({ kind: 'deleteFolder', folderId: 'local-folder:ref-Draft' });
    release();
    await ob.idle();
    expect(client.deleteFolder).toHaveBeenCalledWith('srv-1', expect.anything());
    expect(ob.list()).toHaveLength(0);
  });

  it('coalesces repeated renames of one folder, keeping the first base', async () => {
    const kv = await openTestKv();
    const client = fakeClient();
    const ob = make(kv, client, { locks: fakeLocksHeld() });
    await ob.enqueue({ kind: 'renameFolder', folderId: 'fo1', name: 'B', baseName: 'Plans' });
    await ob.enqueue({ kind: 'renameFolder', folderId: 'fo1', name: 'C', baseName: 'B' });
    expect(ob.list()).toHaveLength(1);
    expect(ob.list()[0]!.op).toMatchObject({ name: 'C', baseName: 'Plans' });
    await ob.enqueue({ kind: 'deleteFolder', folderId: 'fo1' });
    expect(ob.list().map((e) => e.op.kind)).toEqual(['deleteFolder']);
  });
});

describe('applyFolderOutbox', () => {
  let seq = 0;
  const entry = (op: FolderOutboxOp, status: FolderOutboxEntry['status'] = 'pending', extra: Partial<FolderOutboxEntry> = {}): FolderOutboxEntry => ({
    id: 'e' + ++seq,
    seq,
    op,
    status,
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1_700_000_000_000,
    updatedAt: 1,
    ...extra,
  });
  const root = folder({ id: 'root', name: 'Key', parent_id: null });
  const a = folder({ id: 'a', name: 'A', parent_id: 'root' });
  const b = folder({ id: 'b', name: 'B', parent_id: 'a' });
  const c = folder({ id: 'c', name: 'C', parent_id: 'root' });

  it('keeps the identity of untouched folders', () => {
    const out = applyFolderOutbox([root, a, c], [entry({ kind: 'renameFolder', folderId: 'zzz', name: 'x', baseName: 'y' })]);
    expect(out[0]).toBe(root);
    expect(out[1]).toBe(a);
    expect(out[2]).toBe(c);
  });

  it('shows renames and moves as applied with a pending state, stable across calls', () => {
    const es = [entry({ kind: 'renameFolder', folderId: 'a', name: 'A2', baseName: 'A' }), entry({ kind: 'moveFolder', folderId: 'c', parentId: 'a', baseParentId: 'root' })];
    const out = applyFolderOutbox([root, a, c], es);
    expect(out[1]).toMatchObject({ id: 'a', name: 'A2', sync: 'pending' });
    expect(out[2]).toMatchObject({ id: 'c', parent_id: 'a', sync: 'pending' });
    const again = applyFolderOutbox([root, a, c], es);
    expect(again[1]).toBe(out[1]);
    expect(out[0]).toBe(root);
  });

  it('hides a deleted folder and everything below it; a failed delete stays visible', () => {
    const out = applyFolderOutbox([root, a, b, c], [entry({ kind: 'deleteFolder', folderId: 'a' })]);
    expect(out.map((f) => f.id)).toEqual(['root', 'c']);
    const failed = applyFolderOutbox([root, a, b], [entry({ kind: 'deleteFolder', folderId: 'a' }, 'failed', { error: { message: 'no' } })]);
    expect(failed.map((f) => f.id)).toEqual(['root', 'a', 'b']);
    expect(failed[1]).toMatchObject({ sync: 'failed', syncError: 'no' });
  });

  it('does not apply a conflicting change', () => {
    const out = applyFolderOutbox([root, a], [entry({ kind: 'renameFolder', folderId: 'a', name: 'X', baseName: 'A' }, 'conflict')]);
    expect(out[1]).toMatchObject({ name: 'A', sync: 'conflict' });
  });

  it('appends queued creates as local folders with a pending state under the key folder', () => {
    const e = entry({ kind: 'createFolder', name: 'New', parentId: null, clientRef: 'r1' });
    const out = applyFolderOutbox([root, a], [e]);
    expect(out.map((f) => f.id)).toEqual(['root', 'a', 'local-folder:r1']);
    expect(out[2]).toMatchObject({ name: 'New', parent_id: 'root', localOnly: true, sync: 'pending', outboxId: e.id });
    expect(applyFolderOutbox([root, a], [e])[2]).toBe(out[2]);
  });
});
