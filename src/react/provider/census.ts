import type { ShelfClient } from '../../client';
import type { ShelfFolder } from '../../types';
import type { Census } from '../folderModel';

/** The whole-integration census (document counts) is only the fallback for an API that sends no counts with /folders. */
const PAGE = 200;
const MAX_PAGES = 5;

/**
 * Counts documents by listing everything (capped) and sums them up the tree of `folders`. Null when there are too many,
 * a page fails or `isLive` says the answer is no longer wanted: no counts rather than wrong ones.
 */
export async function loadCensus(client: ShelfClient, folders: readonly ShelfFolder[], isLive: () => boolean): Promise<Census | null> {
  try {
    const direct = new Map<string, number>();
    let total = 0;
    let after: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await client.listFiles({ recursive: true, limit: PAGE, ...(after ? { cursor: after } : {}) });
      if (!isLive()) return null;
      for (const f of Array.isArray(res?.items) ? res.items : []) {
        total += 1;
        if (f.folder_id) direct.set(f.folder_id, (direct.get(f.folder_id) ?? 0) + 1);
      }
      if (!res?.next_cursor) {
        const totals = new Map<string, number>();
        const sum = (id: string): number => {
          const hit = totals.get(id);
          if (hit !== undefined) return hit;
          let n = direct.get(id) ?? 0;
          for (const c of folders) if (c.parent_id === id) n += sum(c.id);
          totals.set(id, n);
          return n;
        };
        for (const f of folders) sum(f.id);
        return { totals, total };
      }
      after = res.next_cursor;
    }
    return null;
  } catch {
    return null;
  }
}
