import type { ShelfFolder as FolderRecord, ShelfItem } from '../../types';
import { count, folderCaption } from './caption';

/** Names, breadcrumbs and captions for the folder showing; `rootId` is where the breadcrumb starts. */
interface Model<F> {
  byId: ReadonlyMap<string, F>;
  totals: ReadonlyMap<string, number> | null;
  childrenOf(id: string | null): F[];
}

export function placesOf<F extends FolderRecord>(model: Model<F>, currentId: string | null, rootId: string | null | undefined) {
  const { byId, totals } = model;
  const pathFrom = (from: string | null): F[] => {
    const out: F[] = [];
    for (let id = from; id; ) {
      const f = byId.get(id);
      if (!f) break;
      out.unshift(f);
      id = id === rootId ? null : (f.parent_id ?? null);
    }
    return out;
  };
  const rootName = (rootId ? byId.get(rootId)?.name : undefined) ?? 'Files';
  return {
    crumbs: pathFrom(currentId),
    currentName: (currentId ? byId.get(currentId)?.name : undefined) ?? (rootId ? byId.get(rootId)?.name : undefined) ?? 'this folder',
    rootName,
    /** Where a document sits: folder names from the top. */
    locationOf: (item: ShelfItem): string => pathFrom(item.folder_id ?? null).map((f) => f.name).join(' / ') || rootName,
    /** Folders and documents inside; document counts unknown: say nothing rather than guess. */
    captionOf: (f: FolderRecord): string | null => {
      const kids = model.childrenOf(f.id).length;
      return totals ? folderCaption(kids, totals.get(f.id) ?? 0) : kids > 0 ? count(kids, 'folder') : null;
    },
  };
}
