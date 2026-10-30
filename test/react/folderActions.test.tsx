// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { useFolderActions } from '../../src/react/hooks/useFolderActions';
import { useFolders } from '../../src/react/hooks/useFolders';
import { disposeAllSessions } from '../../src/react/session';
import { FOLDERS, freshDb, mock, modes } from './helpers';

beforeEach(() => freshDb());
afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

const writable = () =>
  mock({
    info: vi.fn(async () => ({ access: 'read_write', root_folder_id: 'root' })),
    createFolder: vi.fn(async (i: { name: string }) => ({ id: 'n1', name: i.name, parent_id: 'root' })),
    updateFolder: vi.fn(async (id: string, p: object) => ({ ...FOLDERS.find((f) => f.id === id)!, ...p })),
    deleteFolder: vi.fn(async () => undefined),
  });

describe.each(modes)('useFolderActions, %s', (_name, setup) => {
  it('a read key cannot write: canWrite false and every action rejects', async () => {
    const { source, wrapper } = setup(mock());
    const { result } = renderHook(() => useFolderActions(source), { wrapper });
    await waitFor(() => expect(result.current).toBeTruthy());
    expect(result.current.canWrite).toBe(false);
    await expect(result.current.create('x', 'root')).rejects.toThrow(/cannot change folders/);
  });

  it('create, rename, move and remove go through the outbox, one request each; the folders overlay shows them', async () => {
    const client = writable();
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ a: useFolderActions(source), f: useFolders(source) }), { wrapper });
    await waitFor(() => expect(result.current.a.canWrite).toBe(true));
    await waitFor(() => expect(result.current.f.folders).toHaveLength(2));
    const sub = result.current.f.byId.get('sub')!;
    await result.current.a.create('  New ', 'root');
    await waitFor(() => expect(client.createFolder).toHaveBeenCalledTimes(1));
    expect(client.createFolder).toHaveBeenCalledWith({ name: 'New', parent_id: 'root' }, expect.anything());
    await result.current.a.rename(sub, 'Deals');
    await waitFor(() => expect(client.updateFolder).toHaveBeenCalledWith('sub', { name: 'Deals' }, expect.anything()));
    await result.current.a.remove(sub);
    await waitFor(() => expect(client.deleteFolder).toHaveBeenCalledTimes(1));
  });

  it('refuses the key’s own folder', async () => {
    const client = writable();
    const { source, wrapper } = setup(client);
    const { result } = renderHook(() => ({ a: useFolderActions(source), f: useFolders(source) }), { wrapper });
    await waitFor(() => expect(result.current.a.canWrite).toBe(true));
    await waitFor(() => expect(result.current.f.folders).toHaveLength(2));
    const root = result.current.f.byId.get('root')!;
    await expect(result.current.a.remove(root)).rejects.toThrow(/own folder/);
    await expect(result.current.a.rename(root, 'x')).rejects.toThrow(/own folder/);
    await expect(result.current.a.move(root, 'sub')).rejects.toThrow(/own folder/);
    expect(client.deleteFolder).not.toHaveBeenCalled();
  });
});
