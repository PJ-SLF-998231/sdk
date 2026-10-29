// @vitest-environment jsdom
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as format from '../../src/react/format';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { DocumentCard } from '../../src/react/DocumentCard';
import { DocumentRow } from '../../src/react/DocumentRow';
import type { ThumbLoader } from '../../src/internal/contracts';
import type { ShelfItem } from '../../src/types';
import fixture from './fixtures/0.2.0-markup.json';

// fixtures/0.2.0-markup.json was captured by rendering the 0.2.0 ShelfFolder (a thumbnail-less DOCX and a
// parsing text file) in grid and list layout, with a read key (no menu) and a read_write key (menu).
// The fixture was captured in en-ZA; pin the locale and zone so the parity test does not depend on the machine's.
const pinnedDate = vi.hoisted(() => (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: 'short', day: 'numeric' }).format(new Date(iso)) : '');

vi.mock('../../src/react/format', async (orig) => {
  const real = await orig<typeof import('../../src/react/format')>();
  return { ...real, formatSize: vi.fn(real.formatSize), formatDate: vi.fn(pinnedDate) };
});

const items = fixture.items as ShelfItem[];
const markup = fixture.markup as Record<string, string[]>;
const loader: ThumbLoader = { load: async () => null, peek: () => null, dispose: () => {} };
const noop = () => {};
afterEach(cleanup);

const cardHtml = (item: ShelfItem, extra: object = {}) => {
  const { container } = render(<DocumentCard item={item} view="gallery" loader={loader} onOpen={noop} {...extra} />);
  return container.innerHTML;
};
const rowHtml = (item: ShelfItem, extra: object = {}) => {
  const { container } = render(
    <table>
      <tbody>
        <DocumentRow item={item} view="list" loader={loader} onOpen={noop} {...extra} />
      </tbody>
    </table>,
  );
  return container.querySelector('tr')!.outerHTML;
};

describe('markup parity with 0.2.0 when sync is null', () => {
  for (const [i, it_] of items.entries()) {
    for (const sync of [null, undefined, 'synced'] as const) {
      it(`card ${it_.filename} sync=${String(sync)} (read)`, () => {
        expect(cardHtml({ ...it_, sync } as ShelfItem)).toBe(markup['grid:read']![i]);
      });
    }
    it(`card ${it_.filename} (read_write)`, () => {
      expect(cardHtml(it_, { canWrite: true, onAction: noop })).toBe(markup['grid:read_write']![i]);
    });
    it(`row ${it_.filename} (read)`, () => {
      expect(rowHtml({ ...it_, sync: null } as ShelfItem)).toBe(markup['list:read']![i]);
    });
    it(`row ${it_.filename} (read_write)`, () => {
      expect(rowHtml(it_, { canWrite: true, onAction: noop })).toBe(markup['list:read_write']![i]);
    });
  }
});

describe('sync state', () => {
  const base = items[0]!;
  it('shows a pending pill and no retry controls', () => {
    const html = cardHtml({ ...base, sync: 'pending', outboxId: 'o1' } as ShelfItem);
    expect(html).toContain('Pending');
    expect(html).not.toContain('Retry');
  });
  it('failed shows Retry, conflict shows Keep mine, both Discard, wired to the outbox id', () => {
    for (const sync of ['failed', 'conflict'] as const) {
      const onRetry = vi.fn();
      const onDiscard = vi.fn();
      const { getByText, unmount } = render(
        <DocumentCard item={{ ...base, sync, outboxId: 'o9' } as ShelfItem} view="gallery" loader={loader} onOpen={noop} onRetry={onRetry} onDiscard={onDiscard} />,
      );
      // a conflict is a choice between keeping the local change (forced) and the server's value
      fireEvent.click(getByText(sync === 'conflict' ? 'Keep mine' : 'Retry'));
      fireEvent.click(getByText('Discard'));
      expect(onRetry).toHaveBeenCalledWith('o9');
      expect(onDiscard).toHaveBeenCalledWith('o9');
      unmount();
    }
  });
  it('row offers the same controls and a menu built from canWrite/onAction', () => {
    const onAction = vi.fn();
    const { getByText, getByLabelText } = render(
      <table>
        <tbody>
          <DocumentRow item={{ ...base, sync: 'failed', outboxId: 'o2' } as ShelfItem} view="list" loader={loader} onOpen={noop} onRetry={noop} canWrite onAction={onAction} />
        </tbody>
      </table>,
    );
    expect(getByText('Retry')).toBeTruthy();
    fireEvent.click(getByLabelText(`Actions for ${base.filename}`));
    fireEvent.click(getByText('Delete'));
    expect(onAction).toHaveBeenCalledWith('delete', base.id);
  });
  it('opens by id', () => {
    const onOpen = vi.fn();
    const { getByText } = render(<DocumentCard item={base} view="gallery" loader={loader} onOpen={onOpen} />);
    fireEvent.click(getByText(base.filename));
    expect(onOpen).toHaveBeenCalledWith(base.id);
  });
});

describe('memoisation', () => {
  it('does not re-render a card or row whose props are unchanged', () => {
    const item = items[0]!;
    vi.mocked(format.formatSize).mockClear();
    const cardRenders = vi.fn();
    const rowRenders = vi.fn();
    const onOpen = vi.fn();
    const tree = (tick: number) => (
      <div data-tick={tick}>
        <Profiler id="card" onRender={cardRenders}>
          <DocumentCard item={item} view="gallery" loader={loader} onOpen={onOpen} />
        </Profiler>
        <table>
          <tbody>
            <Profiler id="row" onRender={rowRenders}>
              <DocumentRow item={item} view="list" loader={loader} onOpen={onOpen} />
            </Profiler>
          </tbody>
        </table>
      </div>
    );
    const { rerender } = render(tree(0));
    expect(cardRenders).toHaveBeenCalledTimes(1);
    expect(rowRenders).toHaveBeenCalledTimes(1);
    // A Profiler re-renders with its parent, so also count the work the memoised components do:
    // every card / row render calls formatSize.
    const sizeCalls = vi.mocked(format.formatSize).mock.calls.length;
    const phases = () => [...cardRenders.mock.calls, ...rowRenders.mock.calls].map((c) => c[1]);
    expect(phases()).toEqual(['mount', 'mount']);
    rerender(tree(1));
    rerender(tree(2));
    expect(vi.mocked(format.formatSize).mock.calls.length).toBe(sizeCalls);
    // a changed item does re-render
    rerender(
      <Profiler id="card" onRender={cardRenders}>
        <DocumentCard item={{ ...item }} view="gallery" loader={loader} onOpen={onOpen} />
      </Profiler>,
    );
    expect(vi.mocked(format.formatSize).mock.calls.length).toBeGreaterThan(sizeCalls);
  });
});
