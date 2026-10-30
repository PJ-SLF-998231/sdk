// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { DocumentList } from '../../src/entries/document-list';
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
const docs = [item({ preview_sizes: ['small', 'medium', 'large'] }), item({ id: 'f2', filename: 'notes.docx', content_type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', preview_sizes: [] })];
const folders = [{ id: 'sub', name: 'Contracts', parent_id: 'root', sync: null }] as never;
const caption = () => '1 item';

beforeEach(freshDb);
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

describe('DocumentList', () => {
  for (const [label, key, extra] of [
    ['read key', 'read key: list layout', {}],
    ['read_write key', 'read_write key: list layout', { canWrite: true, onAction: noop, folderActions: () => [{ label: 'Rename', onSelect: noop }] }],
  ] as const) {
    it(`draws the 0.3 list fragment byte for byte (${label})`, async () => {
      const { container } = render(<DocumentList client={mock()} items={docs} folders={folders} folderCaption={caption} onOpenFolder={noop} onOpen={noop} {...extra} />);
      await waitFor(() => expect(container.querySelector('img')).toBeTruthy());
      const table = container.querySelector('.shelf-sdk__item-list-scroll')!;
      expect(table).toBeTruthy();
      const block = baselineBlock(key);
      expect(block).toContain(normalise(table.outerHTML));
      // the sentinel above the table is part of the fragment too
      expect(block).toContain(normalise((table.previousElementSibling as HTMLElement).outerHTML));
    });
  }

  it('opens a folder row and adds a menu only when folderActions are given', () => {
    const onOpenFolder = vi.fn();
    const { getByText, container, rerender } = render(<DocumentList items={docs} folders={folders} onOpenFolder={onOpenFolder} onOpen={noop} />);
    getByText('Contracts').click();
    expect(onOpenFolder).toHaveBeenCalledWith('sub');
    expect(container.querySelectorAll('tr.shelf-sdk__item-row--folder button[aria-haspopup]').length).toBe(0);
    rerender(<DocumentList items={docs} folders={folders} onOpenFolder={onOpenFolder} folderActions={() => [{ label: 'Rename', onSelect: noop }]} onOpen={noop} />);
    expect(container.querySelectorAll('tr.shelf-sdk__item-row--folder .shelf-sdk__item-list-actions button').length).toBe(1);
  });

  it('onNearEnd prefetches page 2 and lists the subfolders of the folder', async () => {
    const listFiles = vi.fn(async (p?: { cursor?: string }) => (p?.cursor ? { items: [item({ id: 'p2', filename: 'second-page.pdf' })], next_cursor: null } : { items: [item()], next_cursor: 'c2' }));
    const client = mock({ listFiles });
    const { findByText } = render(<DocumentList client={client} folderId="root" onOpen={noop} />);
    await findByText('plan.pdf');
    await findByText('Contracts');
    await findByText('second-page.pdf');
    expect(listFiles.mock.calls.some(([p]) => (p as { cursor?: string } | undefined)?.cursor === 'c2')).toBe(true);
  });
});
