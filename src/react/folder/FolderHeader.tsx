import type { Crumb, FolderHeaderProps, ShelfSource } from '../contracts';
import { cx } from '../cx';
import { plural } from '../format';
import { useFolders } from '../hooks/useFolders';
import { useShelf } from '../hooks/useShelf';
import { NotConnected, ShelfRoot } from '../ShelfRoot';

type View = Pick<FolderHeaderProps, 'onNavigate' | 'meta' | 'actions' | 'documentOpen' | 'theme' | 'className'>;

function Header({ crumbs, onNavigate, meta, actions, documentOpen, theme, className }: View & { crumbs: readonly Crumb[] }) {
  return (
    <ShelfRoot theme={theme} className={className}>
      <div className={cx('shelf-crumbs-row')}>
        <nav className={cx('breadcrumbs')} aria-label="Folder path">
          <ol>
            {crumbs.length === 0 && (
              <li>
                <span className={cx('breadcrumb')} aria-current="page">
                  Files
                </span>
              </li>
            )}
            {crumbs.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={cx('link-btn', 'breadcrumb')}
                  aria-current={i === crumbs.length - 1 && !documentOpen ? 'page' : undefined}
                  onClick={() => onNavigate(c.id)}
                >
                  {c.name}
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <div className={cx('shelf-crumbs-aside')}>
          {meta ? <span className={cx('file-count')}>{meta}</span> : null}
          {actions}
        </div>
      </div>
    </ShelfRoot>
  );
}

function BoundHeader({ folderId, source, meta, ...rest }: View & { folderId: string | null; source: ShelfSource }) {
  const { status } = useShelf(source);
  const model = useFolders(source);
  if (status === 'disconnected' || status === 'auth-lost')
    return (
      <ShelfRoot theme={rest.theme} className={rest.className}>
        <NotConnected />
      </ShelfRoot>
    );
  const total = model.totalItems;
  const auto =
    total !== null
      ? `${plural(total, 'item')} · ${plural(model.folders.length, 'folder')}`
      : model.folders.length
        ? plural(model.folders.length, 'folder')
        : '';
  return <Header crumbs={model.pathTo(folderId)} meta={meta ?? auto} {...rest} />;
}

/**
 * The breadcrumb row of a folder view: the path, with a count on the right. Give it `crumbs`, or a `folderId` (null = the
 * key's root) to read the path through the session (props.client > props.baseUrl > nearest ShelfProvider).
 */
export function FolderHeader({ folderId = null, crumbs, client, baseUrl, cacheScope, onAuthLost, ...rest }: FolderHeaderProps) {
  if (crumbs) return <Header crumbs={crumbs} {...rest} />;
  return <BoundHeader folderId={folderId} source={{ client, baseUrl, cacheScope, onAuthLost }} {...rest} />;
}
