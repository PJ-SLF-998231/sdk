import { describe, expect, it } from 'vitest';
import { applyOutbox } from '../../src/outbox/overlay';
import type { OutboxEntry, OutboxOp, OutboxStatus } from '../../src/internal/contracts';
import { bytes, item } from './helpers';

let seq = 0;
const entry = (op: OutboxOp, status: OutboxStatus = 'pending', extra: Partial<OutboxEntry> = {}): OutboxEntry => ({
  id: 'e' + ++seq, seq, op, status, attempts: 0, nextAttemptAt: 0, createdAt: 1_700_000_000_000 + seq, updatedAt: 1, ...extra,
});
const upload = (ref: string, folderId: string | null = null): OutboxOp => ({ kind: 'upload', folderId, filename: ref + '.pdf', contentType: 'application/pdf', size: 3, bytes: bytes(), clientRef: ref });

describe('applyOutbox', () => {
  const a = item({ id: 'a', filename: 'a.pdf' });
  const b = item({ id: 'b', filename: 'b.pdf' });
  const c = item({ id: 'c', filename: 'c.pdf' });

  it('returns untouched items as the same objects', () => {
    const out = applyOutbox([a, b], [entry({ kind: 'delete', fileId: 'zzz' })], null);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(b);
  });

  it('puts queued uploads first as local:<clientRef> items', () => {
    const out = applyOutbox([a], [entry(upload('r1')), entry(upload('r2', 'other')), entry(upload('r3'), 'failed', { error: { message: 'too big' } })], null);
    expect(out.map((i) => i.id)).toEqual(['local:r1', 'local:r3', 'a']);
    expect(out[0]).toMatchObject({ localOnly: true, sync: 'pending', filename: 'r1.pdf', folder_id: null, preview_sizes: [] });
    expect(out[1]).toMatchObject({ sync: 'failed', syncError: 'too big', outboxId: expect.any(String) });
  });

  it('shows a pending rename and marks it pending; stable across calls', () => {
    const e = entry({ kind: 'rename', fileId: 'a', filename: 'new.pdf', baseFilename: 'a.pdf' });
    const o1 = applyOutbox([a, b], [e], null);
    expect(o1[0]).toMatchObject({ id: 'a', filename: 'new.pdf', sync: 'pending', outboxId: e.id });
    expect(o1[1]).toBe(b);
    expect(applyOutbox([a, b], [e], null)[0]).toBe(o1[0]);
  });

  it('hides pending deletes but keeps a failed delete visible', () => {
    expect(applyOutbox([a, b, c], [entry({ kind: 'delete', fileId: 'b' })], null).map((i) => i.id)).toEqual(['a', 'c']);
    const failed = applyOutbox([a, b], [entry({ kind: 'delete', fileId: 'b' }, 'failed')], null);
    expect(failed.map((i) => i.id)).toEqual(['a', 'b']);
    expect(failed[1]).toMatchObject({ sync: 'failed' });
  });

  it('removes a moved item from the listing it left', () => {
    const e = entry({ kind: 'move', fileId: 'a', folderId: 'dest', baseFolderId: null });
    expect(applyOutbox([a, b], [e], null).map((i) => i.id)).toEqual(['b']);
    expect(applyOutbox([a], [e], 'dest').map((i) => i.folder_id)).toEqual(['dest']);
  });

  it('shows the server version for a conflict and flags it', () => {
    const e = entry({ kind: 'rename', fileId: 'a', filename: 'mine.pdf', baseFilename: 'a.pdf' }, 'conflict');
    expect(applyOutbox([a], [e], null)[0]).toMatchObject({ filename: 'a.pdf', sync: 'conflict', outboxId: e.id });
  });

  it('applies rename then move in seq order and takes the most urgent state', () => {
    const r = entry({ kind: 'rename', fileId: 'a', filename: 'x.pdf', baseFilename: 'a.pdf' });
    const m = entry({ kind: 'move', fileId: 'a', folderId: 'f', baseFolderId: null }, 'failed', { error: { message: 'nope' } });
    const out = applyOutbox([a], [m, r], 'f');
    expect(out[0]).toMatchObject({ filename: 'x.pdf', folder_id: 'f', sync: 'failed', syncError: 'nope' });
  });
});
