import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  observeElementOffset,
  observeElementRect,
  observeWindowOffset,
  observeWindowRect,
  elementScroll,
  windowScroll,
  useVirtualizer,
} from '@tanstack/react-virtual';
import type { VirtualRows, VirtualRowsOptions } from '../internal/contracts';

type Scroller = { el: HTMLElement | null; margin: number };

const isScrollable = (el: HTMLElement): boolean => {
  const { overflowY, overflow } = getComputedStyle(el);
  return /(auto|scroll)/.test(`${overflowY} ${overflow}`);
};

/** The scroll container for `list` (itself, or its nearest overflow auto/scroll ancestor), else null for the window. */
function findScroller(list: HTMLElement): HTMLElement | null {
  for (let el: HTMLElement | null = list; el && el !== document.body && el !== document.documentElement; el = el.parentElement) {
    if (isScrollable(el)) return el;
  }
  return null;
}

/** Distance in px from the top of the scroll content to the top of `list`. */
function listOffset(list: HTMLElement, scroller: HTMLElement | null): number {
  if (scroller === list) return 0;
  const top = list.getBoundingClientRect().top;
  if (!scroller) return Math.round(top + (typeof window !== 'undefined' ? window.scrollY : 0));
  return Math.round(top - scroller.getBoundingClientRect().top + scroller.scrollTop);
}

/**
 * Windowed rows for a long list. `scrollRef` is the list container (or the scroller itself); the scroller is
 * its nearest overflow auto/scroll ancestor, else the window. `start` is relative to the list container.
 */
export function useVirtualRows(opts: VirtualRowsOptions): VirtualRows {
  const { count, rowHeight, scrollRef, overscan = 3, onNearEnd, prefetchRows, remeasureKey } = opts;
  const [scroller, setScroller] = useState<Scroller | null>(null);

  useLayoutEffect(() => {
    const list = scrollRef.current;
    if (!list) return;
    const el = findScroller(list);
    const margin = listOffset(list, el);
    setScroller((cur) => (cur && cur.el === el && cur.margin === margin ? cur : { el, margin }));
    // Re-measured when the list changes shape, not on every scroll-driven render.
  }, [scrollRef, count, rowHeight, remeasureKey]);

  const useWindow = scroller !== null && scroller.el === null;
  const margin = scroller?.margin ?? 0;
  const virt = useVirtualizer<any, Element>({
    count: scroller ? count : 0,
    estimateSize: () => rowHeight,
    // A row with no layout box (jsdom, display: none) keeps the estimate instead of collapsing to 0 and drawing everything.
    measureElement: (el: Element, entry: ResizeObserverEntry | undefined) => {
      const h = entry?.borderBoxSize?.[0]?.blockSize ?? (el as HTMLElement).getBoundingClientRect().height;
      return h > 0 ? Math.round(h) : rowHeight;
    },
    overscan,
    scrollMargin: margin,
    getScrollElement: () => (useWindow ? (typeof window !== 'undefined' ? window : null) : (scroller?.el ?? null)),
    observeElementRect: useWindow ? (observeWindowRect as never) : (observeElementRect as never),
    observeElementOffset: useWindow ? (observeWindowOffset as never) : (observeElementOffset as never),
    scrollToFn: useWindow ? (windowScroll as never) : (elementScroll as never),
  });

  // A new row height must drop the sizes the virtualizer cached from the old estimate.
  const measuredFor = useRef(rowHeight);
  if (measuredFor.current !== rowHeight) {
    measuredFor.current = rowHeight;
    virt.measure();
  }

  const items = virt.getVirtualItems();
  const rows = items.map((it) => ({ index: it.index, key: it.key as string | number, start: it.start - margin, size: it.size }));
  const totalSize = scroller ? Math.max(0, virt.getTotalSize()) : count * rowHeight; // virtual-core's total already excludes scrollMargin

  // onNearEnd: once per `count`, when the viewport is within two viewport heights (or `prefetchRows` rows) of the end.
  const firedFor = useRef<number>(-1);
  const near = useRef(onNearEnd);
  near.current = onNearEnd;
  const viewport = virt.scrollRect?.height ?? 0;
  const offset = virt.scrollOffset ?? 0;
  const last = items.length ? items[items.length - 1]!.index : -1;
  useEffect(() => {
    if (!scroller || count <= 0 || viewport <= 0 || firedFor.current === count) return;
    const close =
      prefetchRows !== undefined
        ? last >= count - 1 - prefetchRows
        : margin + count * rowHeight - (offset + viewport) <= 2 * viewport;
    if (!close) return;
    firedFor.current = count;
    near.current?.();
  }, [scroller, count, viewport, offset, last, margin, rowHeight, prefetchRows]);

  return {
    rows,
    totalSize,
    measureElement: virt.measureElement,
    scrollToIndex: (index, o) => virt.scrollToIndex(index, { align: o?.align ?? 'start' }),
  };
}
