// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useDocument } from '../../src/react/hooks/useDocument';
import { useDocumentActions } from '../../src/react/hooks/useDocumentActions';
import { useDocumentSite } from '../../src/react/hooks/useDocumentSite';
import { useDocumentText } from '../../src/react/hooks/useDocumentText';
import { useFolder } from '../../src/react/hooks/useFolder';
import { useFolders } from '../../src/react/hooks/useFolders';
import { useOnlineStatus } from '../../src/react/hooks/useOnlineStatus';
import { useOutbox } from '../../src/react/hooks/useOutbox';
import { useShelf } from '../../src/react/hooks/useShelf';
import { useUpload } from '../../src/react/hooks/useUpload';
import { disposeAllSessions } from '../../src/react/session';
import { FOLDERS, file, freshDb, item, mock, modes } from './helpers';

beforeEach(() => freshDb());
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each(modes)('hooks, %s', (_name, setup) => {
  it('useShelf: connecting then ready with the access level', async () => {
    const { source, wrapper } = setup(mock({ info: vi.fn(async () => ({ access: 'read_write' })) }));
    const { result } = renderHook(() => useShelf(source), { wrapper });
    expect(result.current.status).toBe('connecting');
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.access).toBe('read_write');
    expect(result.current.client).not.toBeNull();
  });

  it('useFolders: folders, tree helpers and totals', async () => {
    const { source, wrapper } = setup(mock());
    const { result } = renderHook(() => useFolders(source), { wrapper });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.folders).toHaveLength(2));
    expect(result.current.loading).toBe(false);
    expect(result.current.rootId).toBe('root');
    expect(result.current.childrenOf(null).map((f) => f.id)).toEqual(['sub']);
    expect(result.current.pathTo('sub').map((f) => f.name)).toEqual(['Aisle CMS', 'Contracts']);
    expect(result.current.totals?.get('root')).toBe(3);
    expect(result.current.totalItems).toBe(3);
    expect(result.current.byId.get('sub')?.sync).toBe('synced');
  });

  it('useFolders: counts by census when /folders sends no counts', async () => {
    const client = mock({
      folders: vi.fn(async () => [{ id: 'root', name: 'R', parent_id: null }, { id: 'sub', name: 'S', parent_id: 'root' }]),
      listFiles: vi.fn(async () => ({ items: [item({ id: 'a', folder_id: 'sub' }), item({ id: 'b', folder_id: 'root' })], next_cursor: null })),
    });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useFolders(source), { wrapper });
    await waitFor(() => expect(result.current.totalItems).toBe(2));
    expect(result.current.totals?.get('sub')).toBe(1);
  });

  it('useFolder: the folder, subfolders, path and its documents', async () => {
    const { source, wrapper } = setup(mock());
    const { result } = renderHook(() => useFolder('root', source), { wrapper });
    await waitFor(() => expect(result.current.items).toHaveLength(2));
    expect(result.current.folder?.name).toBe('Aisle CMS');
    expect(result.current.subfolders.map((f) => f.id)).toEqual(['sub']);
    expect(result.current.path.map((f) => f.id)).toEqual(['root']);
    expect(result.current.complete).toBe(true);
    expect(result.current.nextCursor).toBeNull();
  });

  it('useDocument and useDocumentText share one request (file:<id>)', async () => {
    const client = mock();
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ doc: useDocument('f9', source), text: useDocumentText('f9', source) }), { wrapper });
    await waitFor(() => expect(result.current.text.text).toBe('the text'));
    expect(result.current.doc.document?.id).toBe('f9');
    expect(client.getFile).toHaveBeenCalledTimes(1);
  });

  it('useDocument(null) fetches nothing', async () => {
    const client = mock();
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useDocument(null, source), { wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(result.current.loading).toBe(false);
    expect(client.getFile).not.toHaveBeenCalled();
  });

  it('useDocumentSite never requests /site for a document without one', async () => {
    const client = mock();
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useDocumentSite('f1', source), { wrapper });
    await waitFor(() => expect(client.getFile).toHaveBeenCalled());
    await waitFor(() => expect(result.current.view.kind).toBe('hidden'));
    expect(client.getSite).not.toHaveBeenCalled();
  });

  it('useDocumentSite reads the site of a document that has one', async () => {
    const client = mock({ getFile: vi.fn(async (id: string) => ({ ...item({ id }), has_site: true })) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useDocumentSite('f1', source), { wrapper });
    await waitFor(() => expect(result.current.view.kind).toBe('site'));
    expect(client.getSite).toHaveBeenCalledTimes(1);
  });

  it('useDocumentSite with enabled given skips the document read; enabled false fetches nothing', async () => {
    const client = mock();
    const on = setup(client);
    const { result } = renderHook(() => useDocumentSite('f1', { ...on.source, enabled: true }), { wrapper: on.wrapper });
    await waitFor(() => expect(result.current.view.kind).toBe('site'));
    expect(client.getFile).not.toHaveBeenCalled();
    cleanup();
    disposeAllSessions();
    const off = mock();
    const o = setup(off);
    const r2 = renderHook(() => useDocumentSite('f1', { ...o.source, enabled: false }), { wrapper: o.wrapper });
    await new Promise((r) => setTimeout(r, 30));
    expect(r2.result.current.view.kind).toBe('hidden');
    expect(off.getSite).not.toHaveBeenCalled();
  });

  it('useDocumentSite polls every 2.5 s while building', async () => {
    let n = 0;
    const client = mock({ getSite: vi.fn(async (id: string) => ({ file_id: id, status: ++n < 3 ? 'building' : 'ready', spec: n < 3 ? undefined : { blocks: [] } })) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useDocumentSite('f1', { ...source, enabled: true }), { wrapper });
    await waitFor(() => expect(result.current.view.kind).toBe('building'));
    expect(client.getSite).toHaveBeenCalledTimes(1);
    // The poll is a 2.5 s timeout armed after each answer: not before it, and again after the next answer.
    await new Promise((r) => setTimeout(r, 2000));
    expect(client.getSite).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(client.getSite).toHaveBeenCalledTimes(2), { timeout: 1500 });
    await waitFor(() => expect(client.getSite).toHaveBeenCalledTimes(3), { timeout: 4000 });
    await waitFor(() => expect(result.current.view.kind).toBe('site'));
  }, 12000);

  it('read key: no outbox, cannot upload or write', async () => {
    const { source, wrapper } = setup(mock());
    const { result } = renderHook(() => ({ up: useUpload('root', source), ob: useOutbox(source), act: useDocumentActions(source) }), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.up.canUpload).toBe(false);
    expect(result.current.ob.ready).toBe(false);
    expect(result.current.act.canWrite).toBe(false);
    await expect(result.current.act.remove(item())).rejects.toThrow();
  });

  it('useUpload enqueues an upload with the right folderId', async () => {
    const client = mock({ info: vi.fn(async () => ({ access: 'read_write' })), upload: vi.fn(() => new Promise(() => undefined)) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ up: useUpload('sub', source), ob: useOutbox(source) }), { wrapper });
    await waitFor(() => expect(result.current.up.canUpload).toBe(true));
    expect(result.current.ob.ready).toBe(true);
    await act(async () => {
      await result.current.up.upload([file('a.pdf')]);
    });
    await waitFor(() => expect(result.current.ob.entries).toHaveLength(1));
    const op = result.current.ob.entries[0]!.op;
    expect(op).toMatchObject({ kind: 'upload', folderId: 'sub', filename: 'a.pdf' });
    await waitFor(() => expect(result.current.up.adding).toBe(true));
  });

  it('useUpload refuses a local folder', async () => {
    const client = mock({ info: vi.fn(async () => ({ access: 'read_write' })) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => useUpload('local-folder:abc', source), { wrapper });
    await new Promise((r) => setTimeout(r, 50));
    expect(result.current.canUpload).toBe(false);
  });

  it('useDocumentActions enqueue rename / move / delete', async () => {
    const client = mock({ info: vi.fn(async () => ({ access: 'read_write' })), updateFile: vi.fn(() => new Promise(() => undefined)), deleteFile: vi.fn(() => new Promise(() => undefined)) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ a: useDocumentActions(source), ob: useOutbox(source) }), { wrapper });
    await waitFor(() => expect(result.current.a.canWrite).toBe(true));
    await act(async () => {
      await result.current.a.rename(item(), 'new.pdf');
      await result.current.a.move(item({ id: 'f2' }), 'sub');
      await result.current.a.remove(item({ id: 'f3' }));
    });
    const ops = result.current.ob.entries.map((e) => e.op.kind).sort();
    expect(ops).toEqual(['delete', 'move', 'rename']);
  });

  it('useOutbox: discard removes an entry', async () => {
    const client = mock({ info: vi.fn(async () => ({ access: 'read_write' })), deleteFile: vi.fn(() => new Promise(() => undefined)) });
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ a: useDocumentActions(source), ob: useOutbox(source) }), { wrapper });
    await waitFor(() => expect(result.current.a.canWrite).toBe(true));
    await act(async () => {
      await result.current.a.remove(item());
    });
    await waitFor(() => expect(result.current.ob.entries).toHaveLength(1));
    await act(async () => {
      await result.current.ob.discard(result.current.ob.entries[0]!.id);
    });
    await waitFor(() => expect(result.current.ob.entries).toHaveLength(0));
  });

  it('useOnlineStatus follows the browser', () => {
    const { source: _s, wrapper } = setup(mock());
    const { result } = renderHook(() => useOnlineStatus(), { wrapper });
    expect(result.current).toBe(true);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    act(() => void window.dispatchEvent(new Event('offline')));
    expect(result.current).toBe(false);
  });
});

describe('useShelf with no source', () => {
  it('is disconnected', () => {
    const { result } = renderHook(() => useShelf());
    expect(result.current).toMatchObject({ status: 'disconnected', client: null, access: null });
  });
  it('resolution: props.client wins over the provider', async () => {
    const own = mock();
    const provided = mock();
    const { ShelfProvider } = await import('../../src/react/ShelfProvider');
    const { result } = renderHook(() => useFolders({ client: own }), { wrapper: ({ children }) => <ShelfProvider client={provided}>{children}</ShelfProvider> });
    await waitFor(() => expect(result.current.folders).toHaveLength(FOLDERS.length));
    expect(own.folders).toHaveBeenCalled();
    expect(provided.folders).not.toHaveBeenCalled();
  });
});
