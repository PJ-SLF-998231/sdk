import { clearAllShelfData, namespaceFor, openKv } from '../storage/db';
import { livePurges } from './purgeRegistry';

export async function clearCacheNow(scope?: { baseUrl: string; cacheScope: string }): Promise<void> {
  try {
    await Promise.all([...livePurges].map((p) => p().catch(() => undefined)));
    if (!scope) {
      await clearAllShelfData();
      return;
    }
    const ns = await namespaceFor(scope);
    if (!ns.persistent) return;
    const kv = await openKv(ns);
    await kv.clear(['entries', 'blobs']);
  } catch {
    /* clearing is best effort */
  }
}
