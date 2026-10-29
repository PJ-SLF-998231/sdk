import { memo, useMemo } from 'react';
import { cx } from './cx';
import { documentKind, formatDate, formatSize, orderedSizes, statusPill, typeLabel } from './format';
import { ActionMenu } from './ActionMenu';
import { SyncActions, SyncPill, itemMenu } from './syncUi';
import type { DocumentItemProps } from './syncUi';
import { Thumb } from './Thumb';

export type DocumentRowProps = DocumentItemProps;

/** A list-view table row. Markup matches 0.2.0's ShelfFolder row exactly when the item has no sync state. */
function DocumentRowImpl({ item: f, loader, selected, onOpen, onRetry, onDiscard, onDragStart, canWrite, onAction }: DocumentRowProps) {
  const hasPreview = orderedSizes(f.preview_sizes).length > 0;
  const pill = statusPill(f.parse_status);
  const actions = useMemo(() => itemMenu(f, canWrite, onAction), [f, canWrite, onAction]);
  const kind = documentKind(f.content_type);
  return (
    <tr
      className={cx('item-row', selected && 'is-selected')}
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart ? (e) => onDragStart(f.id, e) : undefined}
    >
      <td>
        <button type="button" className={cx('link-btn', 'item-name')} onClick={() => onOpen(f.id)}>
          <span className={cx('item-thumb', !hasPreview && `item-thumb--${kind}`)}>
            <Thumb
              loader={loader}
              id={f.id}
              available={f.preview_sizes ?? []}
              version={f.edited_at}
              alt=""
              width={40}
              height={40}
              fallback={hasPreview ? null : typeLabel(f.content_type)}
            />
          </span>
          <span>
            <span className={cx('item-name-text')}>{f.filename}</span>
          </span>
        </button>
      </td>
      <td>
        {pill && <span className={cx('pill', pill.tone && `pill--${pill.tone}`)}>{pill.label}</span>}
        <SyncPill sync={f.sync} />
        <SyncActions item={f} onRetry={onRetry} onDiscard={onDiscard} />
      </td>
      <td className={cx('item-list-num', 'item-list-muted')}>{formatSize(f.size_bytes)}</td>
      <td className={cx('item-list-muted')}>{formatDate(f.created_at)}</td>
      <td className={cx('item-list-actions')}>
        <ActionMenu label={f.filename} actions={actions} />
      </td>
    </tr>
  );
}

export const DocumentRow = memo(DocumentRowImpl);
