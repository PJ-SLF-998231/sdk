import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { ShelfFolder } from '../../types';
import { useVirtualRows } from '../../virtual';
import { ActionMenu } from '../ActionMenu';
import type { MenuAction } from '../contracts';
import { cx } from '../cx';
import { DocumentRow } from '../DocumentRow';
import { FolderIcon } from '../icons';
import type { VirtualGalleryProps } from './VirtualGallery';

/** List view: a 40px thumbnail plus the 8px cell padding either side and the 1px rule. */
const TABLE_ROW_HEIGHT = 57;
const TABLE_HEAD_HEIGHT = 40;

function TableHead() {
  return (
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
  );
}

/** The table of a folder with no documents: the header and the folder rows, nothing virtual. */
export function FolderRowsTable({ folderRows }: { folderRows: ReactNode }) {
  return (
    <div className={cx('item-list-scroll')}>
      <table className={cx('item-list', 'item-list-fixed')} aria-label="Folder contents">
        <TableHead />
        <tbody>{folderRows}</tbody>
      </table>
    </div>
  );
}

export type VirtualTableProps = VirtualGalleryProps & { folderRows: ReactNode; folderCount: number };

/** The virtualised table: draws only the rows near the viewport; `folderRows` come first, outside the virtual range. Markup is the 0.3 ShelfFolder list's. */
export function VirtualTable({ items, folderRows, folderCount, loader, selectedId, canWrite, onOpen, onRetry, onDiscard, onAction, onNearEnd }: VirtualTableProps) {
  // The scroll sentinel sits just above the table (not inside its overflow wrapper, which would be mistaken
  // for the scroller) and is nudged down past the header and folder rows, so row offsets count from the first document.
  const anchor = useRef<HTMLDivElement>(null);
  const tbody = useRef<HTMLTableSectionElement>(null);
  // Where the documents start below the anchor: header plus folder rows. Names wrap, so folder rows differ in height;
  // the estimate holds until the first layout reads the real offset.
  const [docsTop, setDocsTop] = useState(TABLE_HEAD_HEIGHT + folderCount * TABLE_ROW_HEIGHT);
  const { rows, totalSize, measureElement } = useVirtualRows({ count: items.length, rowHeight: TABLE_ROW_HEIGHT, scrollRef: anchor, onNearEnd, overscan: 6, remeasureKey: docsTop });
  // Document rows have varying heights (a long name wraps), so each drawn row is measured, and the table is watched
  // for changes in the height above the documents (the header and the folder rows).
  useLayoutEffect(() => {
    const body = tbody.current;
    if (!body) return;
    const docRows = Array.from(body.children).filter((tr) => tr.getAttribute('aria-hidden') !== 'true').slice(folderCount);
    docRows.forEach((tr, i) => {
      const r = rows[i];
      // Once per row: after that its ResizeObserver reports changes (measuring again on every render would loop).
      if (!r || tr.getAttribute('data-index') === String(r.index)) return;
      if (!(tr as HTMLElement).offsetHeight) return; // a row with no layout box (jsdom, display: none) keeps the estimate
      tr.setAttribute('data-index', String(r.index));
      measureElement?.(tr);
    });
    const first = body.children[folderCount] as HTMLElement | undefined;
    if (first?.offsetHeight) setDocsTop((cur) => (Math.abs(cur - first.offsetTop) >= 1 ? first.offsetTop : cur));
  });
  useEffect(() => {
    const table = tbody.current?.closest('table');
    if (!table || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const first = tbody.current?.children[folderCount] as HTMLElement | undefined;
      if (first?.offsetHeight) setDocsTop((cur) => (Math.abs(cur - first.offsetTop) >= 1 ? first.offsetTop : cur));
    });
    ro.observe(table);
    return () => ro.disconnect();
  }, [folderCount]);
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
      <div ref={anchor} aria-hidden="true" style={{ height: 0, position: 'relative', top: docsTop }} />
      <div className={cx('item-list-scroll')}>
        <table className={cx('item-list', 'item-list-fixed')} aria-label="Folder contents">
          <TableHead />
          <tbody ref={tbody}>
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
