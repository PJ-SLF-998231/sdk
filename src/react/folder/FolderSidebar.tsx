import type { ComponentProps } from 'react';
import { cx } from '../cx';
import { FolderIcon } from '../icons';
import { FolderTreePart, treeFallback } from './lazyParts';

type TreeProps = Omit<ComponentProps<typeof FolderTreePart.Part>, 'fallback'>;

/** The folder tree behind an icon button at the start of the breadcrumb row; the tree itself is a lazy chunk fetched when it opens. */
export function FolderSidebar({ open, onToggle, ...tree }: { open: boolean; onToggle(): void } & TreeProps) {
  return (
    <aside className={cx('shelf-sidebar', open && 'is-open')} aria-label="Folders">
      <button
        type="button"
        className={cx('btn', 'btn--ghost', 'btn--sm', 'shelf-sidebar-toggle')}
        aria-expanded={open}
        aria-controls="shelf-sdk-folder-tree"
        title={open ? 'Hide folders' : 'Show folders'}
        onClick={onToggle}
      >
        <FolderIcon open={open} />
        <span className={cx('shelf-sidebar-toggle-label')}>{open ? 'Hide folders' : 'Show folders'}</span>
      </button>
      <div id="shelf-sdk-folder-tree" className={cx('shelf-sidebar-tree')} hidden={!open}>
        {open && <FolderTreePart.Part fallback={treeFallback} {...tree} />}
      </div>
    </aside>
  );
}
