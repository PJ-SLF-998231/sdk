// @vitest-environment jsdom
// Regressions for two useVirtualRows bugs fixed in 0.3 U5.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { useVirtualRows } from '../../src/virtual';
import type { VirtualRows } from '../../src/internal/contracts';

const HEADER = 150; // the list sits 150 px below the top of the scroll content

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 600 });
});
afterEach(() => {
  cleanup();
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
});

function setup(count: number, rowHeight: number) {
  let latest!: VirtualRows;
  const scroller: { el: HTMLElement | null } = { el: null };
  function List({ rowHeight }: { rowHeight: number }) {
    const list = useRef<HTMLDivElement | null>(null);
    latest = useVirtualRows({ count, rowHeight, scrollRef: list, overscan: 2 });
    return (
      <div style={{ overflow: 'auto', height: 800 }} ref={(e) => { scroller.el = e; }}>
        <div
          ref={(e) => {
            list.current = e;
            if (e) e.getBoundingClientRect = () => ({ top: HEADER - (scroller.el?.scrollTop ?? 0) }) as DOMRect;
          }}
          style={{ height: latest.totalSize, position: 'relative' }}
        />
      </div>
    );
  }
  const view = render(<List rowHeight={rowHeight} />);
  return { get rows() { return latest; }, setRowHeight: (h: number) => act(() => view.rerender(<List rowHeight={h} />)) };
}

describe('useVirtualRows regressions', () => {
  it('totalSize is count * rowHeight when the list is not at the top of the page (scrollMargin not subtracted twice)', () => {
    const h = setup(1000, 100);
    expect(h.rows.totalSize).toBe(1000 * 100);
    expect(h.rows.rows[0]!.start).toBe(0); // starts are relative to the list, not the scroll content
  });

  it('a changed rowHeight re-measures: totalSize and row starts follow the new height', () => {
    const h = setup(1000, 100);
    expect(h.rows.totalSize).toBe(100000);
    h.setRowHeight(250);
    expect(h.rows.totalSize).toBe(250000);
    expect(h.rows.rows.every((r) => r.size === 250)).toBe(true);
    const second = h.rows.rows.find((r) => r.index === 1);
    if (second) expect(second.start).toBe(250);
  });
});
