import { useContext, useEffect, useMemo } from 'react';
import type { DragEvent } from 'react';
import type { ThumbLoader } from '../internal/contracts';
import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import { ShelfContext } from './context';
import type { DocumentCardProps } from './contracts';
import { cx } from './cx';
import { createDirectThumbLoader, noThumbs } from './directThumbs';

export type ItemAction = 'rename' | 'move' | 'delete';

/** Props shared by DocumentCard and DocumentRow: the contract's, plus how write actions are offered. */
export interface DocumentItemProps extends DocumentCardProps {
  /** Accepted for the 0.3 contract's sake; the component itself decides the markup (card vs row). */
  view?: 'gallery' | 'list';
  /** Drag support for ShelfFolder's move-by-drop. */
  onDragStart?: (id: string, e: DragEvent) => void;
}

/**
 * The loader a card or row draws its thumbnail with: the one it was given (ShelfFolder and the collections pass the
 * session's cached loader), else a direct uncached one over `client` (or the nearest provider's client). Nothing to load
 * with means no thumbnail, only the placeholder. Knows nothing of sessions, so the display-only entries stay light.
 */
export function useThumbLoader(loader: ThumbLoader | undefined, client: DocumentCardProps['client']): ThumbLoader {
  const ctxClient = useContext(ShelfContext)?.source.client;
  const c = loader ? undefined : (client ?? ctxClient);
  const direct = useMemo(() => (c ? createDirectThumbLoader(c) : null), [c]);
  useEffect(() => () => direct?.dispose(), [direct]);
  return loader ?? direct ?? noThumbs;
}

type Sync = DocumentItemProps['item']['sync'];

export const syncLabel = (sync: Sync): string | null =>
  sync === 'pending' ? 'Pending' : sync === 'failed' ? 'Failed' : sync === 'conflict' ? 'Conflict' : null;

export function SyncPill({ sync }: { sync: Sync }) {
  const label = syncLabel(sync);
  if (!label) return null;
  const tone = sync === 'pending' ? 'busy' : sync === 'failed' ? 'danger' : 'warn';
  return <span className={cx('pill', `pill--${tone}`, 'sync-pill')}>{label}</span>;
}

/** Retry / Discard for a failed entry; "Keep mine" (overwrite the server) / Discard for a conflict. Nothing for synced or merely pending items. */
export function SyncActions({ item, onRetry, onDiscard }: Pick<DocumentItemProps, 'item' | 'onRetry' | 'onDiscard'>) {
  if ((item.sync !== 'failed' && item.sync !== 'conflict') || !item.outboxId) return null;
  const outboxId = item.outboxId;
  return (
    <span className={cx('sync-actions')}>
      {item.syncError && <span className={cx('card-meta')}>{item.syncError}</span>}
      {onRetry && (
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'sync-btn')} onClick={() => onRetry(outboxId)}>
          {item.sync === 'conflict' ? 'Keep mine' : 'Retry'}
        </button>
      )}
      {onDiscard && (
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'sync-btn')} onClick={() => onDiscard(outboxId)}>
          Discard
        </button>
      )}
    </span>
  );
}

export function itemMenu(item: DocumentItemProps['item'], canWrite: boolean | undefined, onAction: DocumentItemProps['onAction']): MenuAction[] {
  if (!canWrite || !onAction || item.localOnly) return [];
  return [
    { label: 'Rename', onSelect: () => onAction('rename', item.id) },
    { label: 'Move to…', onSelect: () => onAction('move', item.id) },
    { label: 'Delete', onSelect: () => onAction('delete', item.id), danger: true },
  ];
}

export { ActionMenu };
