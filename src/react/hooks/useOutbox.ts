import type { UseOutboxFn } from '../contracts';

/** STUB (0.4 U1): an empty outbox that is never ready. U2 replaces it. */
export const useOutbox: UseOutboxFn = () => ({
  entries: [],
  pending: 0,
  failed: 0,
  conflicts: 0,
  offline: false,
  ready: false,
  retry: async () => undefined,
  discard: async () => undefined,
});
