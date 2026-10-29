import { describe, expect, it } from 'vitest';
import { reconcile } from '../../src/cache/reconcile';

describe('reconcile', () => {
  const a = { id: 'a', n: 1, tags: ['x'] };
  const b = { id: 'b', n: 2, tags: [] as string[] };

  it('keeps the previous object for equal items and replaces changed ones', () => {
    const out = reconcile([a, b], [{ ...a, tags: ['x'] }, { ...b, n: 3 }]);
    expect(out[0]).toBe(a);
    expect(out[1]).not.toBe(b);
    expect(out[1]).toEqual({ id: 'b', n: 3, tags: [] });
  });

  it('returns the previous array when nothing changed', () => {
    const prev = [a, b];
    expect(reconcile(prev, [{ ...a }, { ...b }])).toBe(prev);
  });

  it('follows the new order and handles additions and removals', () => {
    const c = { id: 'c' };
    const out = reconcile([a, b], [{ ...b }, c]);
    expect(out.map((x) => x.id)).toEqual(['b', 'c']);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(c);
  });

  it('copes with no previous list', () => {
    const next = [a];
    const out = reconcile(undefined, next);
    expect(out).toEqual(next);
    expect(out[0]).toBe(a);
  });
});
