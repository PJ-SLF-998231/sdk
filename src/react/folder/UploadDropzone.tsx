import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import type { ShelfSource, UploadDropzoneProps } from '../contracts';
import { useUpload } from '../hooks/useUpload';
import { cx } from '../cx';
import { ShelfRoot } from '../ShelfRoot';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

function Zone({ accept, children }: { accept: ((files: File[]) => void) | null; children: ReactNode }) {
  const [over, setOver] = useState(false);
  const dropProps = accept
    ? {
        onDragOver: (e: DragEvent) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setOver(true);
        },
        onDragLeave: (e: DragEvent) => {
          if (!(e.currentTarget as Node).contains(e.relatedTarget as Node | null)) setOver(false);
        },
        onDrop: (e: DragEvent) => {
          e.preventDefault();
          setOver(false);
          if (e.dataTransfer?.files?.length) accept(Array.from(e.dataTransfer.files));
        },
      }
    : {};
  return (
    <div className={cx('shelf-dropzone')} data-drop={over ? 'valid' : undefined} data-testid="shelf-dropzone" {...dropProps}>
      {children}
    </div>
  );
}

/** Uploads through the session's outbox (a read_write key). */
function SessionZone({
  folderId,
  source,
  disabled,
  children,
}: {
  folderId: string | null;
  source: ShelfSource;
  disabled?: boolean;
  children: ReactNode;
}) {
  const { canUpload, upload } = useUpload(folderId, source);
  return <Zone accept={canUpload && !disabled ? (files) => void upload(files) : null}>{children}</Zone>;
}

/**
 * The area files can be dropped on. With `onFiles` the host receives them; otherwise they are queued into `folderId`
 * (`null` = the key's root folder) through the session, for a read_write key.
 */
export function UploadDropzone({
  folderId = null,
  onFiles,
  disabled,
  hint,
  children,
  theme,
  className,
  client,
  baseUrl,
  cacheScope,
  onAuthLost,
}: UploadDropzoneProps) {
  const body = (
    <>
      {children}
      {hint}
    </>
  );
  return (
    <ShelfRoot theme={theme} className={className}>
      {onFiles ? (
        <Zone accept={disabled ? null : onFiles}>{body}</Zone>
      ) : (
        <SessionZone folderId={folderId} source={{ client, baseUrl, cacheScope, onAuthLost }} disabled={disabled}>
          {body}
        </SessionZone>
      )}
    </ShelfRoot>
  );
}
