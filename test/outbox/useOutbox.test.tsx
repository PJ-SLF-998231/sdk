// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useOutbox } from '../../src/hooks/useOutbox';
import { createOutbox } from '../../src/outbox/outbox';
import type { OutboxOptions } from '../../src/outbox/outbox';
import { err, fakeClient, freshDb, openTestKv, upOp } from './helpers';

beforeEach(() => freshDb());
afterEach(cleanup);

describe('useOutbox', () => {
  it('is empty for null', () => {
    const { result } = renderHook(() => useOutbox(null));
    expect(result.current).toMatchObject({ pending: 0, failed: 0, conflicts: 0, offline: false });
  });

  it('follows the outbox: pending, then failed', async () => {
    const kv = await openTestKv();
    const ob = createOutbox({ kv, client: fakeClient({ upload: async () => { throw err(415); } }), locks: null } as OutboxOptions);
    const { result } = renderHook(() => useOutbox(ob));
    await act(async () => {
      await ob.enqueue(upOp('a.xyz'));
      await ob.idle();
    });
    await waitFor(() => expect(result.current.failed).toBe(1));
    expect(result.current.entries).toHaveLength(1);
    ob.destroy();
  });
});
