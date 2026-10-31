import { describe, expect, it, vi } from 'vitest';
import type { OutboxHandle } from '../../src/outbox';
import { folderNameError, folderOps } from '../../src/react/folder/folderOps';

const FOLDERS = [
  { id: 'root', name: 'Aisle CMS', parent_id: null },
  { id: 'a', name: 'Contracts', parent_id: 'root' },
  { id: 'b', name: 'Quotes', parent_id: 'root' },
  { id: 'c', name: 'Contracts', parent_id: 'b' },
];

describe('folderNameError', () => {
  it('needs a name of at most 60 characters', () => {
    expect(folderNameError(FOLDERS, '   ', 'root')).toBe('Give the folder a name.');
    expect(folderNameError(FOLDERS, 'x'.repeat(61), 'root')).toBe('Keep folder names to 60 characters or fewer.');
    expect(folderNameError(FOLDERS, 'x'.repeat(60), 'root')).toBeNull();
  });

  it('refuses a sibling with the same name, ignoring case and accents, but not elsewhere', () => {
    expect(folderNameError(FOLDERS, ' contracts ', 'root')).toBe('A folder named “contracts” is already there.');
    expect(folderNameError(FOLDERS, 'QUÓTES', 'root')).toBe('A folder named “QUÓTES” is already there.');
    expect(folderNameError(FOLDERS, 'Quotes', 'b')).toBeNull();
    // a top-level folder is matched against parent null
    expect(folderNameError(FOLDERS, 'Aisle CMS', null)).toBe('A folder named “Aisle CMS” is already there.');
  });

  it('a rename may keep its own name', () => {
    expect(folderNameError(FOLDERS, 'Contracts', 'root', 'a')).toBeNull();
    expect(folderNameError(FOLDERS, 'Contracts', 'b', 'a')).toBe('A folder named “Contracts” is already there.');
  });
});

describe('folderOps', () => {
  const outbox = () => ({ enqueue: vi.fn(async () => ({})) }) as unknown as OutboxHandle & { enqueue: ReturnType<typeof vi.fn> };
  const sub = FOLDERS[1]!;

  it('queues each write with the base the user saw, names trimmed', async () => {
    const o = outbox();
    const ops = folderOps(o, 'root');
    await ops.create('  New  ', 'root');
    await ops.rename(sub, ' Signed ');
    await ops.move(sub, 'b');
    await ops.remove(sub);
    expect(o.enqueue.mock.calls.map((c) => c[0])).toEqual([
      { kind: 'createFolder', name: 'New', parentId: 'root', clientRef: '' },
      { kind: 'renameFolder', folderId: 'a', name: 'Signed', baseName: 'Contracts' },
      { kind: 'moveFolder', folderId: 'a', parentId: 'b', baseParentId: 'root' },
      { kind: 'deleteFolder', folderId: 'a' },
    ]);
  });

  it("refuses the key's own folder, by id or by having no parent", async () => {
    const o = outbox();
    const ops = folderOps(o, 'root');
    await expect(ops.rename(FOLDERS[0]!, 'X')).rejects.toThrow("Shelf: the key's own folder cannot be changed");
    await expect(folderOps(o, null).remove({ id: 'top', name: 'Top', parent_id: null })).rejects.toThrow("the key's own folder");
    await expect(folderOps(o, 'a').move(sub, 'b')).rejects.toThrow("the key's own folder");
    expect(o.enqueue).not.toHaveBeenCalled();
  });

  it('without an outbox (a read key) every write fails', async () => {
    const ops = folderOps(null, 'root');
    await expect(ops.create('X', 'root')).rejects.toThrow('Shelf: this key cannot change folders');
    await expect(ops.remove(sub)).rejects.toThrow('Shelf: this key cannot change folders');
  });
});
