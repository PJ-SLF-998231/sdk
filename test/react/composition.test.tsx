// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocumentPage } from '../../src/entries/document-page';
import { ShelfFolder } from '../../src/entries/folder-view';
import { ShelfFolder as FromBarrel } from '../../src/react';
import { applyFolderOutbox, isFolderOp } from '../../src/outbox';
import type { FolderOutboxEntry } from '../../src/internal/contracts';
import { useFolders } from '../../src/react/hooks/useFolders';
import { ShelfProvider } from '../../src/react/ShelfProvider';
import { disposeAllSessions, getSession } from '../../src/react/session';
import receipt from '../fixtures/site-receipt.json';
import { BASE, freshDb, item, mock } from './helpers';
import { namespaceFor, openKv } from '../../src/storage/db';

beforeEach(() => {
  freshDb();
  window.localStorage.clear();
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = () => 'blob:x';
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => undefined;
});
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

const detail = (o: object = {}) => ({ ...item({ id: 'd1', filename: 'rules.pdf', preview_sizes: ['small', 'medium', 'large'] }), parsed_text: 'the text', has_site: false, ...o });
const readySite = { file_id: 'd1', status: 'ready', stale: false, error_code: null, error: null, spec: receipt };
const IMG = { filename: 'scan.png', content_type: 'image/png' };
const tabNames = () => screen.getAllByRole('tab').map((t) => t.textContent);
const selected = () => screen.getAllByRole('tab').filter((t) => t.getAttribute('aria-selected') === 'true').map((t) => t.textContent);

describe('ShelfFolder exports', () => {
  it('is the same component from ./react and ./react/folder-view', () => {
    expect(FromBarrel).toBe(ShelfFolder);
  });
});

describe('ShelfFolder document page options', () => {
  it('showPreviewSizes={false} hides the size bar, the default keeps it', async () => {
    const client = mock({ getFile: vi.fn(async () => detail(IMG)) });
    const a = render(<ShelfFolder client={client} initialDocumentId="d1" />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(a.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.getByRole('group', { name: 'Image size' })).toBeTruthy();
    a.unmount();
    const b = render(<ShelfFolder client={client} initialDocumentId="d1" showPreviewSizes={false} />);
    fireEvent.click(await screen.findByRole('tab', { name: 'Preview' }));
    await waitFor(() => expect(b.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Image size' })).toBeNull();
  });

  it("documentTabs={['content','preview','text']} sets the order and opens on the first available tab", async () => {
    const withSite = mock({ getFile: vi.fn(async () => detail({ has_site: true })), getSite: vi.fn(async () => readySite) });
    render(<ShelfFolder client={withSite} initialDocumentId="d1" documentTabs={['content', 'preview', 'text']} />);
    await screen.findByText('Corner Cafe receipt');
    expect(tabNames()).toEqual(['Content', 'Preview', 'Text']);
    expect(selected()).toEqual(['Content']);
    cleanup();
    render(<ShelfFolder client={mock({ getFile: vi.fn(async () => detail()) })} initialDocumentId="d1" documentTabs={['content', 'preview', 'text']} />);
    expect(await screen.findByTitle('rules.pdf')).toBeTruthy();
    expect(tabNames()).toEqual(['Preview', 'Text']);
    expect(selected()).toEqual(['Preview']);
  });

  it("the provider's showPreviewSizes and documentTabs are the defaults of a standalone DocumentPage, and the page's own props win", async () => {
    const client = mock({ getFile: vi.fn(async () => detail({ ...IMG, has_site: true })), getSite: vi.fn(async () => readySite) });
    const a = render(
      <ShelfProvider client={client} showPreviewSizes={false} documentTabs={['preview', 'text']}>
        <DocumentPage documentId="d1" />
      </ShelfProvider>,
    );
    await screen.findByRole('tab', { name: 'Preview' });
    expect(tabNames()).toEqual(['Preview', 'Text']);
    await waitFor(() => expect(a.container.querySelector('img.shelf-sdk__doc-image')).toBeTruthy());
    expect(screen.queryByRole('group', { name: 'Image size' })).toBeNull();
    a.unmount();
    render(
      <ShelfProvider client={client} showPreviewSizes={false} documentTabs={['preview', 'text']}>
        <DocumentPage documentId="d1" showPreviewSizes documentTabs={['text', 'content']} />
      </ShelfProvider>,
    );
    await screen.findByRole('tab', { name: 'Content' });
    expect(tabNames()).toEqual(['Text', 'Content']);
  });

  it("the provider's defaults reach the document page inside ShelfFolder", async () => {
    const client = mock({ getFile: vi.fn(async () => detail()) });
    render(
      <ShelfProvider client={client} documentTabs={['text']}>
        <ShelfFolder initialDocumentId="d1" />
      </ShelfProvider>,
    );
    await screen.findByText('the text');
    expect(tabNames()).toEqual(['Text']);
  });
});

describe('ShelfFolder inside a ShelfProvider', () => {
  it('needs no client or baseUrl of its own', async () => {
    render(
      <ShelfProvider client={mock()}>
        <ShelfFolder />
      </ShelfProvider>,
    );
    expect(await screen.findByText('plan.pdf')).toBeTruthy();
    expect(screen.queryByText(/isn't connected/)).toBeNull();
  });

  it('with a cacheScope it opens from the cache with the network gone', async () => {
    const wait = async (c: ReturnType<typeof mock>) => {
      const view = render(
        <ShelfProvider client={c} cacheScope="user-1">
          <ShelfFolder />
        </ShelfProvider>,
      );
      await screen.findByText('plan.pdf');
      return view;
    };
    const warm = await wait(mock());
    await waitFor(async () => { // let the entries reach IndexedDB
      const kv = await openKv(await namespaceFor({ baseUrl: BASE, cacheScope: 'user-1' }));
      expect((await kv.list('entries')).length).toBeGreaterThanOrEqual(3); // info, folders, listing
    });
    warm.unmount();
    disposeAllSessions(); // a page reload: only the stored copy is left
    const down = () => Promise.reject(new TypeError('Failed to fetch'));
    const offline = mock({ info: vi.fn(down), folders: vi.fn(down), listFiles: vi.fn(down), getFile: vi.fn(down) });
    await wait(offline);
    expect(screen.getByText('notes.pdf')).toBeTruthy();
    await screen.findByTestId('shelf-offline');
  });
});

describe('the folder overlay', () => {
  const folders = [
    { id: 'root', name: 'Aisle CMS', parent_id: null },
    { id: 'sub', name: 'Contracts', parent_id: 'root' },
  ];
  const created = (name: string): FolderOutboxEntry => ({
    id: 'e1', status: 'pending', op: { kind: 'createFolder', name, parentId: 'root', clientRef: 'r1' }, createdAt: 0, attempts: 0,
  } as unknown as FolderOutboxEntry);

  it('applyFolderOutbox shows a locally created folder as pending, and isFolderOp picks the entries it takes', () => {
    const entries = [created('Invoices'), { id: 'e2', status: 'pending', op: { kind: 'delete', fileId: 'f1' }, createdAt: 0, attempts: 0 }] as unknown as FolderOutboxEntry[];
    const only = entries.filter((e) => isFolderOp(e.op));
    expect(only).toHaveLength(1);
    const shown = applyFolderOutbox(folders, only);
    const local = shown.find((f) => f.name === 'Invoices');
    expect(local).toMatchObject({ parent_id: 'root', sync: 'pending' });
    expect(shown.find((f) => f.id === 'sub')?.sync ?? 'synced').toBe('synced');
  });

  it('useFolders lists a folder queued for creation as pending (a read_write key, offline)', async () => {
    const client = mock({
      info: vi.fn(async () => ({ access: 'read_write' })),
      createFolder: vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    });
    function Names() {
      const f = useFolders();
      return <p data-testid="names">{f.folders.map((x) => `${x.name}:${x.sync ?? ''}`).join(',')}</p>;
    }
    render(
      <ShelfProvider client={client}>
        <Names />
      </ShelfProvider>,
    );
    await waitFor(() => expect(getSession(client, undefined).outbox).toBeTruthy());
    await getSession(client, undefined).outbox!.enqueue({ kind: 'createFolder', name: 'Invoices', parentId: 'root', clientRef: 'r1' });
    await waitFor(() => expect(screen.getByTestId('names').textContent).toContain('Invoices:pending'));
  });
});
