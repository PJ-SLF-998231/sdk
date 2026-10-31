import { describe, expect, it } from 'vitest';
import { placesOf } from '../../src/react/folder/places';
import type { ShelfFolder, ShelfItem } from '../../src/types';

const FOLDERS: ShelfFolder[] = [
  { id: 'root', name: 'Aisle CMS', parent_id: null },
  { id: 'a', name: 'Contracts', parent_id: 'root' },
  { id: 'a1', name: '2026', parent_id: 'a' },
  { id: 'b', name: 'Quotes', parent_id: 'root' },
];
const model = (totals: Map<string, number> | null = null) => ({
  byId: new Map(FOLDERS.map((f) => [f.id, f])),
  totals,
  childrenOf: (id: string | null) => FOLDERS.filter((f) => (f.parent_id ?? null) === id),
});
const doc = (folder_id: string | null) => ({ id: 'd', filename: 'x.pdf', folder_id }) as ShelfItem;

describe('placesOf', () => {
  it('breadcrumbs run from the root down to the open folder', () => {
    const p = placesOf(model(), 'a1', 'root');
    expect(p.crumbs.map((f) => f.id)).toEqual(['root', 'a', 'a1']);
    expect(p.currentName).toBe('2026');
    expect(p.rootName).toBe('Aisle CMS');
  });

  it('stops at rootId even when the root has a parent of its own', () => {
    expect(placesOf(model(), 'a1', 'a').crumbs.map((f) => f.id)).toEqual(['a', 'a1']);
  });

  it('with nothing open the current name is the root, and without a known root "this folder" / "Files"', () => {
    expect(placesOf(model(), null, 'root').currentName).toBe('Aisle CMS');
    const bare = placesOf(model(), null, null);
    expect(bare.currentName).toBe('this folder');
    expect(bare.rootName).toBe('Files');
    expect(bare.crumbs).toEqual([]);
    expect(placesOf(model(), 'gone', 'root').crumbs).toEqual([]);
  });

  it('locationOf names the folders from the top, the root name when it has none', () => {
    const p = placesOf(model(), null, 'root');
    expect(p.locationOf(doc('a1'))).toBe('Aisle CMS / Contracts / 2026');
    expect(p.locationOf(doc(null))).toBe('Aisle CMS');
    expect(p.locationOf(doc('unknown'))).toBe('Aisle CMS');
  });

  it('captionOf counts subfolders, and documents only when the totals are known', () => {
    const unknown = placesOf(model(), null, 'root');
    expect(unknown.captionOf(FOLDERS[1]!)).toBe('1 folder');
    expect(unknown.captionOf(FOLDERS[3]!)).toBeNull();
    const known = placesOf(model(new Map([['a', 3], ['b', 1]])), null, 'root');
    expect(known.captionOf(FOLDERS[1]!)).toBe('1 folder · 3 items');
    expect(known.captionOf(FOLDERS[3]!)).toBe('1 item');
    expect(known.captionOf(FOLDERS[2]!)).toBe('Empty');
  });
});
