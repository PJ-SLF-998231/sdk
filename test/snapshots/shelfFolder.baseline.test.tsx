// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ShelfFolder } from '../../src/react';
import { ShelfError } from '../../src';
import type { ShelfClient, ShelfItem } from '../../src';
import { disposeAllSessions } from '../../src/react/session';
import { LAYOUT_KEY } from '../../src/react/ShelfFolder';

// BASELINE for 0.4.0: DOM snapshots of the 0.3 ShelfFolder (with the merged P1/P2 changes). The 0.4 refactor
// (U7 makes ShelfFolder a thin composition) must leave every one of these byte-identical.
// Dates are pinned to en-ZA / Africa/Johannesburg like the 0.2.0 markup fixture test.
const pinned = vi.hoisted(() => {
  const fmt = (o: Intl.DateTimeFormatOptions) => (iso: string | null | undefined) =>
    iso ? new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', year: 'numeric', month: 'short', day: 'numeric', ...o }).format(new Date(iso)) : '';
  return { date: fmt({}), dateTime: fmt({ hour: '2-digit', minute: '2-digit' }) };
});
vi.mock('../../src/react/format', async (orig) => {
  const real = await orig<typeof import('../../src/react/format')>();
  return { ...real, formatDate: vi.fn(pinned.date), formatDateTime: vi.fn(pinned.dateTime) };
});

const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: ['small', 'medium', 'large'], ...o,
});

const net = { offline: false };
const setOnline = (online: boolean) => {
  net.offline = !online;
  vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(online);
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
};

function mock(access: 'read' | 'read_write', opts: { counts?: boolean; emptyRoot?: boolean } = {}) {
  const { counts = true, emptyRoot = false } = opts;
  const gate = <A extends unknown[], R>(fn: (...a: A) => R | Promise<R>) =>
    vi.fn(async (...a: A): Promise<R> => {
      if (net.offline) throw new TypeError('Failed to fetch');
      return fn(...a);
    });
  const rootItems = emptyRoot ? [] : [item(), item({ id: 'f2', filename: 'notes.docx', content_type: DOCX, preview_sizes: [] })];
  const c = {
    baseUrl: 'https://shelf.test/api',
    info: vi.fn(async () => ({ access })),
    folders: vi.fn(async () => [
      { id: 'root', name: 'Aisle CMS', parent_id: null, ...(counts ? { item_count: rootItems.length, total_item_count: rootItems.length + 1 } : {}) },
      { id: 'sub', name: 'Contracts', parent_id: 'root', ...(counts ? { item_count: 1, total_item_count: 1 } : {}) },
    ]),
    listFiles: vi.fn(async (p?: { folder_id?: string; recursive?: boolean }) =>
      p?.recursive
        ? { items: [...rootItems, item({ id: 'f9', filename: 'deep.txt', preview_sizes: [], folder_id: 'sub' })], next_cursor: null }
        : p?.folder_id === 'sub'
          ? { items: [item({ id: 'f9', filename: 'deep.txt', preview_sizes: [], folder_id: 'sub' })], next_cursor: null }
          : { items: rootItems, next_cursor: null }),
    getFile: gate(async (id: string) => ({ ...item({ id }), parsed_text: 'hello parsed text' })),
    upload: vi.fn(async () => item()),
    updateFile: gate(async (id: string, patch: object) => ({ ...item({ id }), ...patch })),
    deleteFile: gate(async () => undefined),
    thumbnailUrl: (id: string, size?: string) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
  };
  return c as unknown as ShelfClient;
}

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  window.localStorage.clear();
  net.offline = false;
});
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

/** Markup of the rendered view with form-control ids normalised so the snapshot does not depend on useId counters. */
const html = (c: HTMLElement) => c.innerHTML.replace(/(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*:r[0-9a-z]+:[^"]*"/g, '$1="<id>"').replace(/></g, '>\n<');
const settle = async () => act(async () => { await new Promise((r) => setTimeout(r, 30)); });

describe('ShelfFolder 0.3 baseline markup', () => {
  it('read key: root gallery', async () => {
    const { container } = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toMatch(/items/));
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('read key: list layout', async () => {
    window.localStorage.setItem(LAYOUT_KEY, 'list');
    const { container } = render(<ShelfFolder client={mock('read')} />);
    await screen.findByText('plan.pdf');
    await settle();
    expect(container.querySelector('table')).toBeTruthy();
    expect(html(container)).toMatchSnapshot();
  });

  it('read key: subfolder', async () => {
    const { container } = render(<ShelfFolder client={mock('read')} />);
    fireEvent.click(await screen.findByText('Contracts'));
    await screen.findByText('deep.txt');
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('read key: document, Text tab', async () => {
    const { container } = render(<ShelfFolder client={mock('read')} />);
    fireEvent.click(await screen.findByText('plan.pdf'));
    await screen.findByText('hello parsed text');
    await settle();
    expect(within(screen.getByRole('region', { name: 'Document details' })).getByRole('tab', { name: 'Text' })).toBeTruthy();
    expect(html(container)).toMatchSnapshot();
  });

  it('read key: census-fallback counts (no item_count)', async () => {
    const { container } = render(<ShelfFolder client={mock('read', { counts: false })} />);
    await screen.findByText('plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toMatch(/items/));
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('read_write key: root gallery', async () => {
    const { container } = render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('plan.pdf');
    await screen.findByLabelText('Actions for plan.pdf');
    await waitFor(() => expect(container.querySelector('.shelf-sdk__dropzone-limits')).toBeTruthy());
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('read_write key: list layout', async () => {
    window.localStorage.setItem(LAYOUT_KEY, 'list');
    const { container } = render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('plan.pdf');
    await screen.findByLabelText('Actions for plan.pdf');
    await settle();
    expect(container.querySelector('table')).toBeTruthy();
    expect(html(container)).toMatchSnapshot();
  });

  it('read_write key: empty folder', async () => {
    const { container } = render(<ShelfFolder client={mock('read_write', { emptyRoot: true })} />);
    await screen.findByLabelText('Upload files');
    await settle();
    expect(screen.queryByText('plan.pdf')).toBeNull();
    expect(html(container)).toMatchSnapshot();
  });

  it('read_write key: offline banner with 2 pending changes', async () => {
    const { container } = render(<ShelfFolder client={mock('read_write')} />);
    await screen.findByText('plan.pdf');
    await screen.findByLabelText('Actions for plan.pdf');
    await act(async () => setOnline(false));
    for (const [from, to] of [['plan.pdf', 'renamed-one.pdf'], ['notes.docx', 'renamed-two.docx']] as const) {
      fireEvent.click(await screen.findByLabelText(`Actions for ${from}`));
      fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
      fireEvent.change(await screen.findByLabelText('New name'), { target: { value: to } });
      fireEvent.click(screen.getByText('Save name'));
      await screen.findByText(to);
    }
    await waitFor(() => expect(screen.getByTestId('shelf-outbox-banner').textContent).toMatch(/2 changes/i));
    await settle();
    expect(html(container)).toMatchSnapshot();
  });

  it('not connected', async () => {
    const client = mock('read');
    (client.info as unknown as ReturnType<typeof vi.fn>).mockRejectedValue(new ShelfError(401, 'nope', 'unauthorized'));
    const { container } = render(<ShelfFolder client={client} />);
    await screen.findByText("Shelf isn't connected");
    await settle();
    expect(html(container)).toMatchSnapshot();
  });
});
