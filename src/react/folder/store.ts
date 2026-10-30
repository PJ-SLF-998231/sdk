/** Remembered per browser, like Shelf web's `shelf.layout`: a convenience, not something to sync. */
export const LAYOUT_KEY = 'shelf-sdk.layout';
export const TREE_KEY = 'shelf-sdk.folderTree';

export function readStore(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStore(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows and locked-down hosts can refuse storage; it still works, it just isn't remembered.
  }
}
