/**
 * Removes what the SDK keeps on this device: cached listings, details and thumbnails, in memory and in
 * IndexedDB. With no argument everything of every scope goes (call it on sign-out); with `baseUrl` and
 * `cacheScope` only that scope's cache goes. Queued offline changes are not touched. Never rejects.
 *
 * The storage code is loaded on demand, so importing this from the client entry stays tiny.
 */
export async function clearCache(scope?: { baseUrl: string; cacheScope: string }): Promise<void> {
  try {
    const { clearCacheNow } = await import('./clearImpl');
    await clearCacheNow(scope);
  } catch {
    /* clearing is best effort */
  }
}
