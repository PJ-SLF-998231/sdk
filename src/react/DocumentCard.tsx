import { memo, useMemo } from 'react';
import { cx } from './cx';
import { describeMeta, documentKind, formatSize, orderedSizes, statusPill, typeLabel } from './format';
import type { ParsedMeta } from './format';
import { ActionMenu } from './ActionMenu';
import { SyncActions, SyncPill, itemMenu } from './syncUi';
import type { DocumentItemProps } from './syncUi';
import { Thumb } from './Thumb';

export type DocumentCardProps = DocumentItemProps;

/** A gallery card. Markup matches 0.2.0's ShelfFolder card exactly when the item has no sync state. */
function DocumentCardImpl({ item: f, loader, selected, onOpen, onRetry, onDiscard, onDragStart, canWrite, onAction }: DocumentCardProps) {
  const type = typeLabel(f.content_type);
  const kind = documentKind(f.content_type);
  const hasPreview = orderedSizes(f.preview_sizes).length > 0;
  const busy = f.parse_status === 'pending' || f.parse_status === 'parsing';
  const meta = describeMeta(f.parsed_meta as ParsedMeta | null | undefined);
  const pill = statusPill(f.parse_status);
  const actions = useMemo(() => itemMenu(f, canWrite, onAction), [f, canWrite, onAction]);
  const typeBadge = (
    <span className={cx('file-card-type')} aria-hidden="true">
      {type}
    </span>
  );
  return (
    <article
      className={cx('card', 'file-card', 'shelf-item', selected && 'is-selected')}
      aria-busy={busy || undefined}
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart ? (e) => onDragStart(f.id, e) : undefined}
    >
      <div className={cx('file-card-thumb', hasPreview ? `file-card-thumb--${kind}` : `file-card-thumb--doc file-card-thumb--${kind}`)}>
        <Thumb
          loader={loader}
          id={f.id}
          available={f.preview_sizes ?? []}
          version={f.edited_at}
          alt=""
          width={400}
          height={300}
          fallback={typeBadge}
        />
        {pill && <span className={cx('pill', pill.tone && `pill--${pill.tone}`)}>{pill.label}</span>}
        <SyncPill sync={f.sync} />
        {busy && <span className={cx('upload-bar', 'upload-bar--parsing')} aria-hidden="true" />}
      </div>
      <div className={cx('file-card-body')}>
        <p className={cx('card-meta')}>
          {formatSize(f.size_bytes)} · {type}
          {meta && <> · {meta}</>}
        </p>
        <h3 className={cx('file-card-name')}>
          {/* Stretched over the whole card, so a click anywhere opens it. */}
          <button type="button" className={cx('link-btn', 'file-card-link')} onClick={() => onOpen(f.id)}>
            {f.filename}
          </button>
        </h3>
        <SyncActions item={f} onRetry={onRetry} onDiscard={onDiscard} />
      </div>
      <ActionMenu label={f.filename} actions={actions} />
    </article>
  );
}

export const DocumentCard = memo(DocumentCardImpl);
