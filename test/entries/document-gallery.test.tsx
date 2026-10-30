// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { DocumentGallery } from '../../src/entries/document-gallery';
import { disposeAllSessions } from '../../src/react/session';
import { freshDb, item, mock } from '../react/helpers';
import { baselineBlock, normalise } from './baselineFragments';

const pinned = vi.hoisted(() => {
  const fmt = (o: Intl.DateTimeFormatOptions) => (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: 'short', day: 'numeric', ...o }).format(new Date(iso)) : '';
  return { date: fmt({}), dateTime: fmt({ hour: '2-digit', minute: '2-digit' }) };
});
vi.mock('../../src/react/format', async (orig) => {
  const real = await orig<typeof import('../../src/react/format')>();
  return { ...real, formatDate: vi.fn(pinned.date), formatDateTime: vi.fn(pinned.dateTime) };
});

const noop = () => undefined;
beforeEach(freshDb);
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

describe('DocumentGallery', () => {
  const docs = [item({ preview_sizes: ['small', 'medium', 'large'] }), item({ id: 'f2', filename: 'notes.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', preview_sizes: [] })];

  it('draws the 0.3 gallery fragment byte for byte (read key)', async () => {
    const { container } = render(<DocumentGallery client={mock()} items={docs} onOpen={noop} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const grid = container.querySelector('.shelf-sdk__file-grid')!;
    expect(grid).toBeTruthy();
    expect(baselineBlock('read key: root gallery')).toContain(normalise(grid.outerHTML));
  });

  it('draws the 0.3 gallery fragment byte for byte (read_write key)', async () => {
    const { container } = render(<DocumentGallery client={mock()} items={docs} canWrite onAction={noop} onOpen={noop} />);
    await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
    const grid = container.querySelector('.shelf-sdk__file-grid')!;
    expect(baselineBlock('read_write key: root gallery')).toContain(normalise(grid.outerHTML));
  });

  it('renders its own themed root', () => {
    const { container } = render(<DocumentGallery items={docs} onOpen={noop} theme="dark" className="mine" />);
    const root = container.firstElementChild!;
    expect(root.className).toBe('shelf-sdk mine');
    expect(root.getAttribute('data-theme')).toBe('dark');
  });

  describe('virtual', () => {
    beforeEach(() => {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 800 });
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 1000 });
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 1000 });
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 0, left: 0, right: 1000, bottom: 800, width: 1000, height: 800, x: 0, y: 0, toJSON: () => ({}) });
    });
    afterEach(() => {
      for (const k of ['clientHeight', 'clientWidth', 'offsetWidth']) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[k];
    });

    it('5000 items draw at most 150 cards', () => {
      const many = Array.from({ length: 5000 }, (_, i) => item({ id: `d${i}`, filename: `doc-${i}.pdf` }));
      const { container } = render(<DocumentGallery items={many} onOpen={noop} />);
      const cards = container.querySelectorAll('article').length;
      expect(cards).toBeGreaterThan(0);
      expect(cards).toBeLessThanOrEqual(150);
    });
  });

  describe('connected', () => {
    it('onNearEnd prefetches page 2', async () => {
      const listFiles = vi.fn(async (p?: { cursor?: string }) =>
          p?.cursor ? { items: [item({ id: 'p2', filename: 'second-page.pdf' })], next_cursor: null } : { items: [item(), item({ id: 'f2', filename: 'notes.pdf' })], next_cursor: 'c2' },
        );
      const client = mock({ listFiles });
      const onNearEnd = vi.fn();
      const { findByText } = render(<DocumentGallery client={client} folderId="root" onOpen={noop} onNearEnd={onNearEnd} />);
      await findByText('plan.pdf');
      await waitFor(() => expect(listFiles.mock.calls.some(([p]) => (p as { cursor?: string } | undefined)?.cursor === 'c2')).toBe(true));
      await findByText('second-page.pdf');
      expect(onNearEnd).toHaveBeenCalled();
    });

    it('says Shelf is not connected without a client', async () => {
      const { findByRole } = render(<DocumentGallery folderId="root" onOpen={noop} />);
      expect((await findByRole('alert')).textContent).toMatch(/isn.t connected/);
      await act(async () => undefined);
    });
  });
});
