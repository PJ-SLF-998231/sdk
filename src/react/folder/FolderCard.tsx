import type { FolderCardProps } from '../contracts';
import { ActionMenu } from '../ActionMenu';
import { cx } from '../cx';
import { FolderIcon } from '../icons';
import { folderCaption } from './caption';
import { FolderNameFormBody } from './FolderNameForm';
import { LeafRoot } from './LeafRoot';

/**
 * One folder as a card (the tile of the folder grid): opens on click, optionally with a "⋯" menu and an inline rename form.
 * Without `actions` the markup is exactly the 0.3 tile. Display only: no session, cache or storage.
 */
export function FolderCard({ theme, className, ...props }: FolderCardProps) {
  return (
    <LeafRoot theme={theme} className={className}>
      <FolderCardBody {...props} />
    </LeafRoot>
  );
}

/** The card without a root, for the components that already draw one (FolderGrid). */
export function FolderCardBody({
  folder,
  folderCount,
  itemCount,
  caption,
  onOpen,
  actions,
  renaming,
  sync,
  meta,
}: Omit<FolderCardProps, 'theme' | 'className'>) {
  const text = caption ?? (folderCount === undefined && itemCount === undefined ? null : folderCaption(folderCount ?? 0, itemCount ?? 0));
  const pill = sync && sync !== 'synced' ? sync : null;
  return (
    <>
      <article className={cx('card', 'folder-tile')} aria-label={`Folder ${folder.name}`}>
        {renaming ? (
          <div className={cx('folder-tile-main')}>
            <FolderIcon />
            <FolderNameFormBody
              label={`Rename ${folder.name}`}
              initialName={folder.name}
              submitLabel="Save"
              error={renaming.error}
              onSubmit={renaming.onSubmit}
              onCancel={renaming.onCancel}
              onEdit={renaming.onEdit}
            />
          </div>
        ) : (
          <button type="button" className={cx('link-btn', 'folder-tile-main')} onClick={() => onOpen?.(folder.id)}>
            <FolderIcon />
            <span className={cx('folder-tile-text')}>
              <span className={cx('folder-tile-name')}>{folder.name}</span>
              {(text || pill) && (
                <span className={cx('card-meta')}>
                  {text}
                  {pill && (
                    <>
                      {text ? ' ' : null}
                      <span
                        className={cx('pill', pill === 'pending' ? 'pill--busy' : pill === 'failed' ? 'pill--danger' : 'pill--warn', 'sync-pill')}
                      >
                        {pill[0]!.toUpperCase() + pill.slice(1)}
                      </span>
                    </>
                  )}
                </span>
              )}
            </span>
          </button>
        )}
        {!renaming && meta}
        {!renaming && actions && actions.length > 0 && <ActionMenu label={`folder ${folder.name}`} actions={actions} />}
      </article>
    </>
  );
}
