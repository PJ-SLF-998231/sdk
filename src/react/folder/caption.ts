/**
 * A folder's caption: folders directly inside, and documents at any depth. The same text as `describeContents` in ../format,
 * kept here so the smallest entries (FolderCard) do not pull in format.ts, whose upload tables cannot be tree-shaken. A test
 * pins the two together.
 */
export const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function folderCaption(folders: number, items: number): string {
  if (!folders && !items) return 'Empty';
  return [folders && count(folders, 'folder'), items && count(items, 'item')].filter(Boolean).join(' · ');
}
