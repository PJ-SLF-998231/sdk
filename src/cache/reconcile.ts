import type { ReconcileFn } from '../internal/contracts';

/** Structural equality for JSON-ish values (plain objects, arrays, primitives). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    if (a.length !== bb.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], bb[i])) return false;
    return true;
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  for (const k of ak) {
    if (!Object.prototype.hasOwnProperty.call(bo, k) || !deepEqual(ao[k], bo[k])) return false;
  }
  return true;
}

/**
 * Keeps the previous object for every item that is JSON-equal to its new version, so memoised rows
 * do not re-render. Order follows `next`. When nothing changed at all the previous array itself is returned.
 */
export const reconcile: ReconcileFn = <T extends { id: string }>(prev: readonly T[] | undefined, next: readonly T[]): T[] => {
  if (!prev || prev.length === 0) return next.slice();
  const byId = new Map<string, T>();
  for (const p of prev) byId.set(p.id, p);
  let allSame = prev.length === next.length;
  const out = next.map((n, i) => {
    const p = byId.get(n.id);
    const kept = p !== undefined && deepEqual(p, n) ? p : n;
    if (kept !== prev[i]) allSame = false;
    return kept;
  });
  return allSame ? (prev as T[]) : out;
};
