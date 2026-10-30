import { useRef } from 'react';
import type { FolderToolbarProps } from '../contracts';
import { cx } from '../cx';
import { plural, UPLOAD_ACCEPT } from '../format';
import { LeafRoot } from './LeafRoot';
import { ViewToggleBody } from './ViewToggle';

/** Add documents / New folder, the "Adding N documents…" status and the layout switch. Display only: the host does the work. */
export function FolderToolbar({ canWrite, onAddFiles, onNewFolder, adding, layout, onLayoutChange, theme, className }: FolderToolbarProps) {
  const picker = useRef<HTMLInputElement>(null);
  const count = typeof adding === 'number' ? adding : adding ? 1 : 0;
  return (
    <LeafRoot theme={theme} className={className}>
      <div className={cx('shelf-toolbar')}>
        {canWrite && (
          <>
            <button type="button" className={cx('btn', 'btn--accent', 'btn--sm')} onClick={() => picker.current?.click()}>
              Add documents
            </button>
            <input
              ref={picker}
              type="file"
              accept={UPLOAD_ACCEPT}
              multiple
              hidden
              aria-label="Upload files"
              onChange={(e) => {
                if (e.target.files?.length) onAddFiles(Array.from(e.target.files));
                e.target.value = '';
              }}
            />
            {onNewFolder && (
              <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onNewFolder}>
                New folder
              </button>
            )}
          </>
        )}
        <p className={cx('drag-status')} aria-live="polite">
          {count > 0 ? (typeof adding === 'number' ? `Adding ${plural(count, 'document')}…` : 'Adding documents…') : ''}
        </p>
        <ViewToggleBody value={layout} onChange={onLayoutChange} />
      </div>
    </LeafRoot>
  );
}
