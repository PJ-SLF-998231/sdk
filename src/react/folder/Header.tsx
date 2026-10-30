import type { Crumb, FolderHeaderProps } from '../contracts';
import { cx } from '../cx';
import { ShelfRoot } from '../ShelfRoot';

export type View = Pick<FolderHeaderProps, 'onNavigate' | 'meta' | 'actions' | 'documentOpen' | 'theme' | 'className'>;

/** The breadcrumb row: the path, with a count and actions on the right. */
export function Header({ crumbs, onNavigate, meta, actions, documentOpen, theme, className }: View & { crumbs: readonly Crumb[] }) {
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
