import { lazy, Suspense, useRef } from 'react';
import type { ReactNode } from 'react';
import type { ThumbLoader } from '../../internal/contracts';
import type { ShelfFolder } from '../../types';
import { useVirtualRows } from '../../virtual';
import { ActionMenu } from '../ActionMenu';
import type { DocumentListProps, MenuAction, OverlayFolder } from '../contracts';
import { cx } from '../cx';
import { DocumentRow } from '../DocumentRow';
import { FolderIcon } from '../icons';
import { NotConnectedRoot, ShelfRoot } from '../ShelfRoot';
import { useCollectionLoader, useNearEnd } from './useCollection';
import type { VirtualGalleryProps } from './DocumentGallery';

/** List view: a 40px thumbnail plus the 8px cell padding either side and the 1px rule. */
const TABLE_ROW_HEIGHT = 57;
const TABLE_HEAD_HEIGHT = 40;

export type VirtualTableProps = VirtualGalleryProps & { folderRows: ReactNode; folderCount: number };

/** The virtualised table: draws only the rows near the viewport; `folderRows` come first, outside the virtual range. Markup is the 0.3 ShelfFolder list's. */
export function VirtualTable({ items, folderRows, folderCount, loader, selectedId, canWrite, onOpen, onRetry, onDiscard, onAction, onNearEnd }: VirtualTableProps) {
  // The scroll sentinel sits just above the table (not inside its overflow wrapper, which would be mistaken
  // for the scroller) and is nudged down past the header and folder rows, so row offsets count from the first document.
  const anchor = useRef<HTMLDivElement>(null);
  const { rows, totalSize } = useVirtualRows({ count: items.length, rowHeight: TABLE_ROW_HEIGHT, scrollRef: anchor, onNearEnd, overscan: 6 });
  const top = rows.length ? rows[0]!.start : 0;
  const bottom = rows.length ? Math.max(0, totalSize - (rows[rows.length - 1]!.start + rows[rows.length - 1]!.size)) : totalSize;
  const spacer = (h: number, key: string) =>
    h > 0 ? (
      <tr key={key} aria-hidden="true" style={{ height: h }}>
        <td colSpan={5} style={{ padding: 0, border: 0 }} />
      </tr>
    ) : null;
  return (
    <>
      <div ref={anchor} aria-hidden="true" style={{ height: 0, position: 'relative', top: TABLE_HEAD_HEIGHT + folderCount * TABLE_ROW_HEIGHT }} />
      <div className={cx('item-list-scroll')}>
        <table className={cx('item-list', 'item-list-fixed')} aria-label="Folder contents">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th className={cx('item-list-num')}>Size</th>
              <th>Added</th>
              <th>
                <span className={cx('visually-hidden')}>Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {folderRows}
            {spacer(top, 'top')}
            {rows.map((r) => {
              const f = items[r.index];
              return f ? <DocumentRow key={f.id} item={f} loader={loader} selected={f.id === selectedId} canWrite={canWrite} onOpen={onOpen} onRetry={onRetry} onDiscard={onDiscard} onAction={onAction} /> : null;
            })}
            {spacer(bottom, 'bottom')}
          </tbody>
        </table>
      </div>
    </>
  );
}

/** A subfolder as a table row (no menu unless `actions` are given, which is the 0.3 markup). */
export function FolderRow({ folder, caption, onOpen, actions }: { folder: ShelfFolder; caption?: string | null; onOpen?: (id: string) => void; actions?: MenuAction[] }) {
  return (
    <tr className={cx('item-row', 'item-row--folder')}>
      <td>
        <button type="button" className={cx('link-btn', 'item-name')} onClick={() => onOpen?.(folder.id)}>
          <span className={cx('item-thumb', 'item-thumb--folder')}>
            <FolderIcon />
          </span>
          <span className={cx('item-name-text')}>{folder.name}</span>
        </button>
      </td>
      <td className={cx('item-list-muted')}>{caption ?? ''}</td>
      <td className={cx('item-list-num', 'item-list-muted')}>—</td>
      <td className={cx('item-list-muted')}></td>
      <td className={cx('item-list-actions')}>{actions && actions.length > 0 ? <ActionMenu label={folder.name} actions={actions} /> : null}</td>
    </tr>
  );
}

export type InnerListProps = DocumentListProps & { loader: ThumbLoader };

export function ListView({ props, items, subfolders, onNearEnd }: { props: InnerListProps; items: VirtualGalleryProps['items']; subfolders: readonly OverlayFolder[]; onNearEnd: () => void }) {
  const folderRows = subfolders.map((f) => (
    <FolderRow key={`d-${f.id}`} folder={f} caption={props.folderCaption?.(f)} onOpen={props.onOpenFolder} actions={props.folderActions?.(f)} />
  ));
  return <VirtualTable {...props} items={items} folderRows={folderRows} folderCount={subfolders.length} onNearEnd={onNearEnd} />;
}

// Loading a folder (useFolder) is a lazy chunk: a list handed `items` never pays for it.
const BoundList = lazy(() => import('./BoundList'));

function PureList(props: InnerListProps) {
  const onNearEnd = useNearEnd(props.onNearEnd);
  return <ListView props={props} items={props.items ?? []} subfolders={props.folders ?? []} onNearEnd={onNearEnd} />;
}

/**
 * The documents of a folder as a virtualised table, with `folders` as rows above them. Give it `items`, or a `folderId`
 * to load them (a page is fetched ahead as the end comes into view; the folder's subfolders are the rows unless `folders` is given).
 */
export function DocumentList(props: DocumentListProps) {
  const { loader, connected } = useCollectionLoader(props);
  const bound = !props.items && props.folderId !== undefined;
  if (bound && !connected) return <NotConnectedRoot theme={props.theme} className={props.className} />;
  return <ShelfRoot theme={props.theme} className={props.className}>{bound ? (
        <Suspense fallback={null}>
          <BoundList {...props} loader={loader} />
        </Suspense>
      ) : <PureList {...props} loader={loader} />}</ShelfRoot>;
}
