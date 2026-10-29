import { ActionMenu } from './ActionMenu';
import type { MenuAction } from './ActionMenu';
import { cx } from './cx';
import type { DocumentCardProps } from '../internal/contracts';

export type ItemAction = 'rename' | 'move' | 'delete';

/** Props shared by DocumentCard and DocumentRow: the contract's, plus how write actions are offered. */
export interface DocumentItemProps extends Omit<DocumentCardProps, 'view'> {
  /** Accepted for the contract's sake; the component itself decides the markup (card vs row). */
  view?: DocumentCardProps['view'];
  /** Offer Rename / Move / Delete in the menu. */
  canWrite?: boolean;
  /** A menu action was picked. Must be referentially stable. */
  onAction?: (action: ItemAction, id: string) => void;
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

/** Retry / Discard for an entry that needs a decision. Nothing for synced or merely pending items. */
export function SyncActions({ item, onRetry, onDiscard }: Pick<DocumentItemProps, 'item' | 'onRetry' | 'onDiscard'>) {
  if ((item.sync !== 'failed' && item.sync !== 'conflict') || !item.outboxId) return null;
  const outboxId = item.outboxId;
  return (
    <span className={cx('sync-actions')}>
      {item.syncError && <span className={cx('card-meta')}>{item.syncError}</span>}
      {onRetry && (
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm', 'sync-btn')} onClick={() => onRetry(outboxId)}>
          Retry
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
