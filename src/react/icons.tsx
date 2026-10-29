// Icons ported from Shelf web (src/components/shelf/icons.tsx, ShelfItemList.tsx, ActionMenu.tsx).
import { cx } from './cx';

export function FolderIcon({ open = false }: { open?: boolean }) {
  return (
    <svg className={cx('folder-icon')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      {open ? (
        <path d="M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 8.2V9M3.3 10.5h17.6l-1.8 8.1a1.5 1.5 0 0 1-1.5 1.2H5.4a1.5 1.5 0 0 1-1.5-1.3Z" />
      ) : (
        <path d="M3 6a1.5 1.5 0 0 1 1.5-1.5h4.4l2 2.2h8.6A1.5 1.5 0 0 1 21 8.2v10.1a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.3Z" />
      )}
    </svg>
  );
}

export function ChevronIcon() {
  return (
    <svg className={cx('chevron-icon')} viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m6 4 4 4-4 4" />
    </svg>
  );
}

export function PanelIcon({ open = false }: { open?: boolean }) {
  return (
    <svg className={cx('panel-icon')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="15" rx="1.5" />
      <path d={open ? 'M15 4.5v15M17.2 8h1.6M17.2 11h1.6M17.2 14h1.6' : 'M15 4.5v15'} strokeLinecap="round" />
    </svg>
  );
}

/** A file in the folder tree: a picture for scans and photos, a grid for spreadsheets, braces for JSON, lines for the rest. */
export function FileIcon({ kind }: { kind: string }) {
  const page = 'M6.5 3h7.5l4.5 4.5V20a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z';
  const fold = 'M14 3v4.5h4.5';
  let inside: string;
  switch (kind) {
    case 'image':
      return (
        <svg className={cx('file-icon', 'file-icon--image')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
          <circle cx="9" cy="9.5" r="1.5" />
          <path d="m4 18 5-5 3.5 3.5L15 14l5 4.5" />
        </svg>
      );
    case 'excel':
      inside = 'M8 11h8M8 14.5h8M8 18h8M12 11v7';
      break;
    case 'json':
      inside = 'M10 11c-1.2 0-1.5.6-1.5 1.5v.5c0 .7-.3 1-1 1 .7 0 1 .3 1 1v.5c0 .9.3 1.5 1.5 1.5M14 11c1.2 0 1.5.6 1.5 1.5v.5c0 .7.3 1 1 1-.7 0-1 .3-1 1v.5c0 .9-.3 1.5-1.5 1.5';
      break;
    default:
      inside = 'M8.5 12h7M8.5 15h7M8.5 18h4.5';
  }
  return (
    <svg className={cx('file-icon', `file-icon--${kind}`)} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
      <path d={page} />
      <path d={fold} />
      <path d={inside} strokeWidth="1.4" />
    </svg>
  );
}

export function GridIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="1.5" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="1.5" width="5.5" height="5.5" rx="1" />
      <rect x="1.5" y="9" width="5.5" height="5.5" rx="1" />
      <rect x="9" y="9" width="5.5" height="5.5" rx="1" />
    </svg>
  );
}

export function ListIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
      <rect x="1.5" y="2.5" width="13" height="2" rx="1" />
      <rect x="1.5" y="7" width="13" height="2" rx="1" />
      <rect x="1.5" y="11.5" width="13" height="2" rx="1" />
    </svg>
  );
}

export function CopyIcon() {
  return (
    <svg className={cx('copy-icon')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <rect x="8.5" y="8.5" width="11" height="11" rx="1.5" />
      <path d="M15.5 8.5V5.5a1.5 1.5 0 0 0-1.5-1.5H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg className={cx('check-icon')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

export function PencilIcon() {
  return (
    <svg className={cx('pencil-icon')} viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4z" />
      <path d="m13.5 6.5 4 4" />
    </svg>
  );
}
