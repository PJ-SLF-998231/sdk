import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { cx } from '../cx';

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes('Files');

/** The drop area: accepts dropped files (when `accept` is given) and marks itself while a file is over it. */
export function Zone({ accept, children }: { accept: ((files: File[]) => void) | null; children: ReactNode }) {
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
