import { useCallback, useEffect, useRef, useState } from 'react';
import type { ThumbLoader } from '../../internal/contracts';
import type { ShelfItem } from '../../types';
import { gridColumns, useElementWidth, useVirtualRows } from '../../virtual';
import type { OverlayItem } from '../contracts';
import { cx } from '../cx';
import { DocumentCard } from '../DocumentCard';
import type { DocumentItemProps } from '../syncUi';

/** Gallery geometry: matches the 0.2.0 grid (`minmax(230px, 1fr)`, 16px gap). */
const MIN_CARD = 230;
const GAP = 16;
/** Row estimate before the first card is measured: 4:3 thumbnail + 1px rule + padded body. */
const CARD_BODY_ESTIMATE = 84;

type Row = ShelfItem & Partial<Pick<OverlayItem, 'sync' | 'outboxId' | 'localOnly' | 'syncError'>>;

export interface VirtualGalleryProps {
  items: readonly Row[];
  loader: ThumbLoader;
  selectedId?: string | null;
  canWrite?: boolean;
  onOpen: DocumentItemProps['onOpen'];
  onRetry?: DocumentItemProps['onRetry'];
  onDiscard?: DocumentItemProps['onDiscard'];
  onAction?: DocumentItemProps['onAction'];
  onNearEnd?: () => void;
}

/** The virtualised card grid: draws only the rows near the viewport. Markup is the 0.3 ShelfFolder gallery's. */
export function VirtualGallery({ items, loader, selectedId, canWrite, onOpen, onRetry, onDiscard, onAction, onNearEnd }: VirtualGalleryProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const width = useElementWidth(listRef);
  const cols = gridColumns(width, MIN_CARD, GAP);
  const cardW = width > 0 ? Math.max(0, (width - GAP * (cols - 1)) / cols) : MIN_CARD;
  const cardKey = Math.round(cardW);
  // Cards are as tall as the tallest one drawn so far at this width (what 0.2.0's grid row did for uniform content).
  const [measured, setMeasured] = useState<{ w: number; h: number } | null>(null);
  const height = measured && measured.w === cardKey ? measured.h : Math.round((cardW * 3) / 4) + 1 + CARD_BODY_ESTIMATE;
  const rowCount = Math.ceil(items.length / cols);
  const { rows, totalSize } = useVirtualRows({ count: rowCount, rowHeight: height + GAP, scrollRef: listRef, onNearEnd });

  // One observer for every row drawn; created on first use because ref callbacks run before effects.
  const keyRef = useRef(cardKey);
  keyRef.current = cardKey;
  const observer = useRef<ResizeObserver | null>(null);
  const measure = useCallback((el: HTMLDivElement | null) => {
    if (!el || typeof ResizeObserver === 'undefined') return;
    if (!observer.current) {
      observer.current = new ResizeObserver((entries) => {
        let max = 0;
        for (const e of entries) max = Math.max(max, Math.ceil((e.target as HTMLElement).offsetHeight));
        if (max <= 0) return;
        const w = keyRef.current;
        setMeasured((cur) => (cur && cur.w === w ? (cur.h >= max ? cur : { w, h: max }) : { w, h: max }));
      });
    }
    observer.current.observe(el);
  }, []);
  // A new width means new card sizes: observe the rows again so the first report counts for it.
  useEffect(() => {
    const ro = observer.current;
    const list = listRef.current;
    if (!ro || !list) return;
    ro.disconnect();
    for (const el of Array.from(list.children)) ro.observe(el);
  }, [cardKey]);
  useEffect(
    () => () => {
      observer.current?.disconnect();
      observer.current = null;
    },
    [],
  );

  return (
    <div ref={listRef} className={cx('file-grid')} aria-label="Folder contents" style={{ display: 'block', position: 'relative', height: Math.max(0, totalSize - GAP) }}>
      {rows.map((r) => (
        <div
          key={r.key}
          ref={measure}
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            transform: `translateY(${r.start}px)`,
            display: 'grid',
            gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
            gap: GAP,
          }}
        >
          {items.slice(r.index * cols, r.index * cols + cols).map((f) => (
            <DocumentCard key={f.id} item={f} loader={loader} selected={f.id === selectedId} canWrite={canWrite} onOpen={onOpen} onRetry={onRetry} onDiscard={onDiscard} onAction={onAction} />
          ))}
        </div>
      ))}
    </div>
  );
}
