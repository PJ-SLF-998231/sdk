import type { ShelfFolder } from '../types';

/** Document counts from listing everything (the fallback for an API that sends none with /folders). */
export interface Census {
  /** Documents at any depth under each folder. */
  totals: Map<string, number>;
  total: number;
}

/**
 * Documents at any depth under each folder, from the counts /folders sends (`total_item_count`, else
 * `item_count` summed up the tree). Null when any folder lacks them: the caller then falls back to the census.
 * (Copied from ShelfFolder.tsx, which keeps its own until 0.4 U7.)
 */
export function totalsFromFolders(folders: readonly ShelfFolder[]): Map<string, number> | null {
  if (folders.length === 0) return null;
  const kids = new Map<string, ShelfFolder[]>();
  for (const f of folders) if (f.parent_id) kids.set(f.parent_id, [...(kids.get(f.parent_id) ?? []), f]);
  const out = new Map<string, number>();
  const visiting = new Set<string>();
  const total = (f: ShelfFolder): number | null => {
    const hit = out.get(f.id);
    if (hit !== undefined) return hit;
    let n: number;
    if (typeof f.total_item_count === 'number') n = f.total_item_count;
    else {
      if (typeof f.item_count !== 'number' || visiting.has(f.id)) return null;
      visiting.add(f.id);
      n = f.item_count;
      for (const c of kids.get(f.id) ?? []) {
        const t = total(c);
        if (t === null) {
          visiting.delete(f.id);
          return null;
        }
        n += t;
      }
      visiting.delete(f.id);
    }
    out.set(f.id, n);
    return n;
  };
  for (const f of folders) if (total(f) === null) return null;
  return out;
}

export interface FolderModel<F extends ShelfFolder> {
  byId: Map<string, F>;
  rootId: string | null;
  childrenOf(id: string | null): F[];
  pathTo(id: string | null): F[];
  totals: Map<string, number> | null;
  totalItems: number | null;
}

/**
 * The tree the folders form: the key's root (the single top folder, else none), children sorted by name, the path
 * from the root, and document totals (the API's counts, else the census). `folders` are what to show (the server's
 * with queued changes applied); the root and the totals come from `server`, so a queued change cannot move them.
 */
export function buildFolderModel<F extends ShelfFolder>(folders: readonly F[], server: readonly ShelfFolder[], census: Census | null): FolderModel<F> {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const top = <T extends ShelfFolder>(list: readonly T[]): T[] => {
    const ids = new Set(list.map((f) => f.id));
    return list.filter((f) => !f.parent_id || !ids.has(f.parent_id));
  };
  const tops = top(folders);
  const serverTops = top(server);
  const rootId = serverTops.length === 1 ? serverTops[0]!.id : null;
  const childrenOf = (parent: string | null): F[] => {
    const p = parent ?? rootId;
    return (p ? folders.filter((f) => f.parent_id === p) : tops).slice().sort((a, b) => a.name.localeCompare(b.name));
  };
  const pathTo = (id: string | null): F[] => {
    const out: F[] = [];
    for (let cur = id ?? rootId; cur; ) {
      const f = byId.get(cur);
      if (!f) break;
      out.unshift(f);
      cur = cur === rootId ? null : (f.parent_id ?? null);
    }
    return out;
  };
  const fromApi = totalsFromFolders(server);
  const totals = fromApi ?? census?.totals ?? null;
  const totalItems = fromApi ? serverTops.reduce((n, f) => n + (fromApi.get(f.id) ?? 0), 0) : (census?.total ?? null);
  return { byId, rootId, childrenOf, pathTo, totals, totalItems };
}
