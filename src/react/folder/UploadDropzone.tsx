import type { ReactNode } from 'react';
import type { ShelfSource, UploadDropzoneProps } from '../contracts';
import { useUpload } from '../hooks/useUpload';
import { ShelfRoot } from '../ShelfRoot';
import { Zone } from './Zone';

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
