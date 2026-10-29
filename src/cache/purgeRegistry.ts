/** Live in-page caches (one per mounted scope) register here so clearCache() can empty them too. */
export const livePurges = new Set<() => Promise<void>>();

/** Registers a purge function for a live cache; returns the unregister. */
export function registerPurge(purge: () => Promise<void>): () => void {
  livePurges.add(purge);
  return () => void livePurges.delete(purge);
}
