import { deepEqual } from '../../cache/reconcile';

/** Keeps the previous reference when nothing changed, so React sees no new data. */
export const mergeSame = <T,>(prev: T | undefined, next: T): T => (prev !== undefined && deepEqual(prev, next) ? prev : next);
