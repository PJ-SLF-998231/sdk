import { useState } from 'react';
import type { FormEvent } from 'react';
import type { FolderNameFormProps } from '../contracts';
import { cx } from '../cx';
import { LeafRoot } from './LeafRoot';

/**
 * Inline name field used both for a new folder and for renaming one (ported from Shelf web's FolderNameForm).
 * Enter saves, Escape cancels.
 */
export function FolderNameForm({ theme, className, ...props }: FolderNameFormProps) {
  return (
    <LeafRoot theme={theme} className={className}>
      <FolderNameFormBody {...props} />
    </LeafRoot>
  );
}

/** The form without a root, for the components that already draw one (a FolderCard that is being renamed). */
export function FolderNameFormBody({
  initialName = '',
  label = 'Folder name',
  submitLabel = 'Save',
  error = null,
  onSubmit,
  onCancel,
  onEdit,
}: Omit<FolderNameFormProps, 'theme' | 'className'>) {
  const [name, setName] = useState(initialName);
  const errorId = `${label.replace(/\W+/g, '-').toLowerCase()}-error`;

  return (
    <form
      className={cx('folder-name-form')}
      noValidate
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        onSubmit(name);
      }}
    >
      <input
        className={cx('text-input', 'text-input--sm')}
        aria-label={label}
        value={name}
        autoFocus
        onFocus={(e) => e.currentTarget.select()}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        onChange={(e) => {
          setName(e.target.value);
          onEdit?.();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onCancel();
          }
        }}
      />
      {error && (
        <p id={errorId} className={cx('field-error')} role="alert">
          {error}
        </p>
      )}
      <div className={cx('folder-name-form-actions')}>
        <button type="submit" className={cx('btn', 'btn--accent', 'btn--sm')}>
          {submitLabel}
        </button>
        <button type="button" className={cx('btn', 'btn--ghost', 'btn--sm')} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
