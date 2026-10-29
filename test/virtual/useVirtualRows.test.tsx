// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { useRef } from 'react';
import { useVirtualRows } from '../../src/virtual';
import type { VirtualRows } from '../../src/internal/contracts';
import { gridColumns } from '../../src/virtual';

const COUNT = 1250;
const ROW = 300;
const OVERSCAN = 2;

let scrollHeight = COUNT * ROW;
beforeEach(() => {
  scrollHeight = COUNT * ROW;
  Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

function setup(props: { count?: number; onNearEnd?: () => void } = {}) {
  let latest!: VirtualRows;
  const scrollerRef: { el: HTMLElement | null } = { el: null };
  function List({ count, onNearEnd }: { count: number; onNearEnd?: () => void }) {
    const list = useRef<HTMLDivElement | null>(null);
    latest = useVirtualRows({ count, rowHeight: ROW, scrollRef: list, overscan: OVERSCAN, onNearEnd });
    return (
      <div data-testid="scroller" style={{ overflow: 'auto', height: 800 }} ref={(e) => { scrollerRef.el = e; }}>
        <div
          ref={(e) => {
            list.current = e;
            // jsdom has no layout: the list's top moves up as the scroller scrolls, like a browser.
            if (e) e.getBoundingClientRect = () => ({ top: -(scrollerRef.el?.scrollTop ?? 0) }) as DOMRect;
          }}
          style={{ height: latest.totalSize, position: 'relative' }}>
          {latest.rows.map((r) => (
            <div key={r.key} data-row={r.index} style={{ position: 'absolute', top: r.start, height: r.size }} />
          ))}
        </div>
      </div>
    );
  }
  const view = render(<List count={props.count ?? COUNT} onNearEnd={props.onNearEnd} />);
  const rerender = (count: number) => view.rerender(<List count={count} onNearEnd={props.onNearEnd} />);
  const scrollTo = (top: number) => {
    act(() => {
      scrollerRef.el!.scrollTop = top;
      fireEvent.scroll(scrollerRef.el!);
    });
  };
  return { get rows() { return latest; }, scrollTo, rerender };
}

describe('useVirtualRows', () => {
  it('renders only the visible rows plus overscan', () => {
    const h = setup();
    expect(h.rows.rows.length).toBeGreaterThan(0);
    expect(h.rows.rows.length).toBeLessThanOrEqual(3 + 2 * OVERSCAN);
    expect(h.rows.totalSize).toBe(COUNT * ROW);
  });

  it('renders rows around the index after a far scroll', () => {
    const h = setup();
    h.scrollTo(300000);
    const idx = h.rows.rows.map((r) => r.index);
    expect(idx.length).toBeLessThanOrEqual(3 + 2 * OVERSCAN);
    expect(idx).toContain(1000);
    expect(Math.min(...idx)).toBeGreaterThanOrEqual(1000 - 1 - OVERSCAN);
    expect(Math.max(...idx)).toBeLessThanOrEqual(1000 + 3 + OVERSCAN);
  });

  it('padTop + rendered heights + padBottom equals totalSize', () => {
    const h = setup();
    for (const top of [0, 300000, 374000]) {
      h.scrollTo(top);
      const { rows, totalSize } = h.rows;
      const padTop = rows[0]!.start;
      const padBottom = totalSize - (rows[rows.length - 1]!.start + rows[rows.length - 1]!.size);
      expect(padTop + rows.reduce((a, r) => a + r.size, 0) + padBottom).toBe(totalSize);
      expect(padTop).toBeGreaterThanOrEqual(0);
      expect(padBottom).toBeGreaterThanOrEqual(0);
    }
  });

  it('fires onNearEnd once per count', () => {
    const onNearEnd = vi.fn();
    const h = setup({ onNearEnd });
    h.scrollTo(100000);
    expect(onNearEnd).not.toHaveBeenCalled();
    h.scrollTo(COUNT * ROW - 800 - 1000);
    expect(onNearEnd).toHaveBeenCalledTimes(1);
    h.scrollTo(COUNT * ROW - 800);
    h.scrollTo(COUNT * ROW - 900);
    expect(onNearEnd).toHaveBeenCalledTimes(1);
    scrollHeight = (COUNT + 200) * ROW;
    act(() => h.rerender(COUNT + 200)); // the next page arrived: not near the new end yet
    expect(onNearEnd).toHaveBeenCalledTimes(1);
    h.scrollTo((COUNT + 200) * ROW - 1000);
    expect(onNearEnd).toHaveBeenCalledTimes(2);
  });
});

describe('gridColumns', () => {
  it('fits columns and never returns less than 1', () => {
    expect(gridColumns(1000, 240, 16)).toBe(3);
    expect(gridColumns(100, 240, 16)).toBe(1);
    expect(gridColumns(0, 240, 16)).toBe(1);
    expect(gridColumns(496, 240, 16)).toBe(2);
  });
});
