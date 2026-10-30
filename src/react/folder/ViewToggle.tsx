import type { ViewToggleProps } from '../contracts';
import { cx } from '../cx';
import { GridIcon, ListIcon } from '../icons';
import { LeafRoot } from './LeafRoot';

/** Gallery / List switch (Shelf web's LayoutToggle). */
export function ViewToggle({ theme, className, ...props }: ViewToggleProps) {
  return (
    <LeafRoot theme={theme} className={className}>
      <ViewToggleBody {...props} />
    </LeafRoot>
  );
}

/** The switch without a root, for components that already draw one. */
export function ViewToggleBody({ value, onChange }: Omit<ViewToggleProps, 'theme' | 'className'>) {
  return (
    <div className={cx('layout-toggle')} role="group" aria-label="Layout">
      <button type="button" className={cx('layout-toggle-btn')} aria-pressed={value === 'grid'} onClick={() => onChange('grid')}>
        <GridIcon />
        Gallery
      </button>
      <button type="button" className={cx('layout-toggle-btn')} aria-pressed={value === 'list'} onClick={() => onChange('list')}>
        <ListIcon />
        List
      </button>
    </div>
  );
}
