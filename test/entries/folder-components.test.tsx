// @vitest-environment jsdom
import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { ActionMenu } from '../../src/entries/action-menu';
import { FolderCard, FolderNameForm } from '../../src/entries/folder-card';
import { FolderGrid } from '../../src/entries/folder-grid';
import { FolderHeader } from '../../src/entries/folder-header';
import { FolderToolbar } from '../../src/entries/folder-toolbar';
import { FolderTree } from '../../src/entries/folder-tree';
import { OfflineBanner } from '../../src/entries/offline-banner';
import { UploadDropzone } from '../../src/entries/upload-dropzone';
import { ViewToggle } from '../../src/entries/view-toggle';
import { cx } from '../../src/react/cx';
import { describeContents, UPLOAD_LIMITS } from '../../src/react/format';
import { folderCaption } from '../../src/react/folder/caption';
import { ShelfRoot } from '../../src/react/ShelfRoot';
import type { OverlayFolder } from '../../src/internal/contracts';
import { disposeAllSessions } from '../../src/react/session';
import { BASE, FOLDERS, item, mock } from '../react/helpers';
import { ShelfProvider } from '../../src/react/ShelfProvider';

// Each component, rendered nested in a .shelf-sdk root, must produce markup that is a contiguous run of the 0.3 ShelfFolder
// baseline snapshot (BASELINE_SHA a92752b): the extraction changed nothing. The snapshots are the oracle; they are never rewritten.
const snap = readFileSync(resolve(process.cwd(), 'test/snapshots/__snapshots__/shelfFolder.baseline.test.tsx.snap'), 'utf8');
const snapshot = (name: string): string => {
  const hit = snap.split('exports[`').find((s) => s.startsWith(`ShelfFolder 0.3 baseline markup > ${name} 1`));
  if (!hit) throw new Error(`no snapshot ${name}`);
  return hit;
};
const html = (el: Element) => el.innerHTML.replace(/(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*:r[0-9a-z]+:[^"]*"/g, '$1="<id>"').replace(/></g, '>\n<');
const nested = (ui: ReactNode) => {
  const { container } = render(<ShelfRoot>{ui}</ShelfRoot>);
  return html(container.firstElementChild!);
};
const READ = 'read key: root gallery';
const RW = 'read_write key: root gallery';

const sub = { ...FOLDERS[1]!, item_count: 1, total_item_count: 1, sync: 'synced' } as OverlayFolder;
const root = { ...FOLDERS[0]!, sync: 'synced' } as OverlayFolder;
const noop = () => undefined;

afterEach(() => {
  cleanup();
  disposeAllSessions();
  vi.restoreAllMocks();
});

describe.each([READ, RW])('fragment equality with the 0.3 baseline (%s)', (name) => {
  const base = () => snapshot(name);
  it('FolderCard', () => expect(base()).toContain(nested(<FolderCard folder={sub} itemCount={1} folderCount={0} />)));
  it('FolderCard with no actions is the same DOM as an empty list of actions', () => {
    expect(nested(<FolderCard folder={sub} caption="1 item" actions={[]} />)).toBe(nested(<FolderCard folder={sub} caption="1 item" />));
    expect(base()).toContain(nested(<FolderCard folder={sub} caption="1 item" actions={[]} />));
  });
  it('FolderGrid (records)', () => expect(base()).toContain(nested(<FolderGrid folders={[sub]} onOpenFolder={noop} />)));
  it('FolderHeader (crumbs)', () =>
    expect(base()).toContain(nested(<FolderHeader crumbs={[{ id: 'root', name: 'Aisle CMS' }]} onNavigate={noop} meta="3 items · 2 folders" />)));
  it('FolderToolbar', () => {
    const canWrite = name === RW;
    expect(base()).toContain(nested(<FolderToolbar canWrite={canWrite} onAddFiles={noop} adding={false} layout="grid" onLayoutChange={noop} />));
  });
  it('ViewToggle', () => expect(base()).toContain(nested(<ViewToggle value="grid" onChange={noop} />)));
});

describe('fragment equality, other snapshots', () => {
  it('ViewToggle, list selected', () => expect(snapshot('read key: list layout')).toContain(nested(<ViewToggle value="list" onChange={noop} />)));
  it('FolderHeader (data-bound) in a subfolder: crumbs from the session', async () => {
    const { container } = render(
      <ShelfProvider client={mock()}>
        <FolderHeader folderId="sub" onNavigate={noop} documentOpen={false} />
      </ShelfProvider>,
    );
    await screen.findByText('Contracts');
    expect(container.querySelectorAll('.shelf-sdk__breadcrumb')).toHaveLength(2);
    expect(container.querySelector('[aria-current="page"]')?.textContent).toBe('Contracts');
    expect(container.querySelector('.shelf-sdk__file-count')?.textContent).toBe('3 items · 2 folders');
  });
  it('ActionMenu', () => expect(snapshot(RW)).toContain(nested(<ActionMenu label="plan.pdf" actions={[{ label: 'Rename', onSelect: noop }]} />)));
  it('OfflineBanner', () => expect(snapshot('read_write key: offline banner with 2 pending changes')).toContain(nested(<OfflineBanner online={false} waiting={2} />)));
  it('UploadDropzone around the folders and the hint', () => {
    const fragment = nested(
      <UploadDropzone
        onFiles={noop}
        hint={<p className={cx('dropzone-limits', 'shelf-dropzone-hint')}>Drop documents here to add them to Aisle CMS · {UPLOAD_LIMITS}</p>}
      >
        <h2 className={cx('kicker', 'shelf-section-label')}>Folders</h2>
        <FolderGrid folders={[sub]} onOpenFolder={noop} />
      </UploadDropzone>,
    );
    expect(snapshot('read_write key: empty folder')).toContain(fragment);
  });
});

describe('folderCaption', () => {
  it.each([[0, 0], [0, 1], [1, 0], [2, 5], [1, 1]])('matches describeContents (%i folders, %i items)', (folders, items) => {
    expect(folderCaption(folders, items)).toBe(describeContents({ folders, items }));
  });
});

describe('FolderCard', () => {
  it('with actions shows Rename / Move to… / Delete in its menu', () => {
    const calls: string[] = [];
    render(
      <FolderCard
        folder={sub}
        caption="1 item"
        actions={[
          { label: 'Rename', onSelect: () => calls.push('rename') },
          { label: 'Move to…', onSelect: () => calls.push('move') },
          { label: 'Delete', onSelect: () => calls.push('delete'), danger: true },
        ]}
      />,
    );
    fireEvent.click(screen.getByLabelText('Actions for folder Contracts'));
    expect(screen.getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['Rename', 'Move to…', 'Delete']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(calls).toEqual(['delete']);
  });
  it('without actions renders no menu and the tile is unchanged', () => {
    const { container } = render(<FolderCard folder={sub} caption="1 item" />);
    expect(container.querySelector('.shelf-sdk__action-menu')).toBeNull();
  });
  it('shows a sync pill for queued folders', () => {
    const { container } = render(<FolderCard folder={sub} sync="pending" />);
    expect(container.querySelector('.shelf-sdk__sync-pill')?.textContent).toBe('Pending');
  });
  it('opens on click, shows a rename form while renaming', () => {
    const onOpen = vi.fn();
    const onSubmit = vi.fn();
    const { rerender } = render(<FolderCard folder={sub} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Contracts/ }));
    expect(onOpen).toHaveBeenCalledWith('sub');
    rerender(<FolderCard folder={sub} actions={[{ label: 'Rename', onSelect: noop }]} renaming={{ error: 'Taken', onSubmit, onCancel: noop, onEdit: noop }} />);
    expect(screen.getByRole('alert').textContent).toBe('Taken');
    fireEvent.change(screen.getByLabelText('Rename Contracts'), { target: { value: 'Deals' } });
    fireEvent.click(screen.getByText('Save'));
    expect(onSubmit).toHaveBeenCalledWith('Deals');
    expect(screen.queryByLabelText('Actions for folder Contracts')).toBeNull();
  });
});

describe('FolderNameForm', () => {
  it('Enter submits the typed name, Escape cancels', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    const onEdit = vi.fn();
    render(<FolderNameForm label="New folder name" submitLabel="Create" onSubmit={onSubmit} onCancel={onCancel} onEdit={onEdit} />);
    const input = screen.getByLabelText('New folder name');
    fireEvent.change(input, { target: { value: 'Invoices' } });
    expect(onEdit).toHaveBeenCalled();
    fireEvent.submit(input.closest('form')!); // what Enter does in a form with a submit button
    expect(onSubmit).toHaveBeenCalledWith('Invoices');
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Create')).toBeTruthy();
  });
});

describe('FolderToolbar and UploadDropzone', () => {
  it('Add documents hands the picked files over; New folder shows only when offered', () => {
    const onAddFiles = vi.fn();
    const onNew = vi.fn();
    const { container, rerender } = render(<FolderToolbar canWrite onAddFiles={onAddFiles} onNewFolder={onNew} adding={2} layout="grid" onLayoutChange={noop} />);
    expect(container.querySelector('.shelf-sdk__drag-status')?.textContent).toBe('Adding 2 documents…');
    fireEvent.click(screen.getByText('New folder'));
    expect(onNew).toHaveBeenCalled();
    const file = new File(['x'], 'a.txt', { type: 'text/plain' });
    fireEvent.change(screen.getByLabelText('Upload files'), { target: { files: [file] } });
    expect(onAddFiles).toHaveBeenCalledWith([file]);
    rerender(<FolderToolbar canWrite={false} onAddFiles={onAddFiles} adding={false} layout="list" onLayoutChange={noop} />);
    expect(screen.queryByText('New folder')).toBeNull();
    expect(screen.queryByText('Add documents')).toBeNull();
  });
  it('dropzone passes dropped files to onFiles and marks itself while dragging', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles}>x</UploadDropzone>);
    const zone = screen.getByTestId('shelf-dropzone');
    const file = new File(['x'], 'a.txt');
    fireEvent.dragOver(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(zone.getAttribute('data-drop')).toBe('valid');
    fireEvent.drop(zone, { dataTransfer: { types: ['Files'], files: [file] } });
    expect(onFiles).toHaveBeenCalledWith([file]);
    expect(zone.getAttribute('data-drop')).toBeNull();
  });
  it('disabled dropzone ignores drops', () => {
    const onFiles = vi.fn();
    render(<UploadDropzone onFiles={onFiles} disabled>x</UploadDropzone>);
    fireEvent.drop(screen.getByTestId('shelf-dropzone'), { dataTransfer: { types: ['Files'], files: [new File(['x'], 'a')] } });
    expect(onFiles).not.toHaveBeenCalled();
  });
});

describe('isolation: every entry renders alone with its own .shelf-sdk root', () => {
  const rootOf = (c: HTMLElement) => c.querySelector('.shelf-sdk');
  const cases: Array<[string, () => ReactNode]> = [
    ['FolderCard', () => <FolderCard folder={sub} caption="1 item" theme="dark" className="mine" />],
    ['FolderNameForm', () => <FolderNameForm onSubmit={noop} onCancel={noop} theme="dark" className="mine" />],
    ['FolderGrid', () => <FolderGrid folders={[sub]} onOpenFolder={noop} theme="dark" className="mine" />],
    ['FolderHeader', () => <FolderHeader crumbs={[{ id: root.id, name: root.name }]} onNavigate={noop} theme="dark" className="mine" />],
    ['FolderToolbar', () => <FolderToolbar canWrite={false} onAddFiles={noop} adding={false} layout="grid" onLayoutChange={noop} theme="dark" className="mine" />],
    ['ViewToggle', () => <ViewToggle value="grid" onChange={noop} theme="dark" className="mine" />],
    ['UploadDropzone', () => <UploadDropzone onFiles={noop} theme="dark" className="mine">x</UploadDropzone>],
    ['ActionMenu', () => <ActionMenu label="x" actions={[{ label: 'A', onSelect: noop }]} theme="dark" className="mine" />],
    ['OfflineBanner', () => <OfflineBanner online={false} waiting={0} theme="dark" className="mine" />],
    [
      'FolderTree',
      () => (
        <FolderTree rootId="root" rootName="Aisle CMS" folders={[root, sub]} files={[item()]} totals={null} currentFolderId="root" currentFileId={null} onOpenFolder={noop} onOpenFile={noop} theme="dark" className="mine" />
      ),
    ],
  ];
  it.each(cases)('%s', (_n, ui) => {
    const { container } = render(<>{ui()}</>);
    const el = rootOf(container);
    expect(el?.getAttribute('data-theme')).toBe('dark');
    expect(el?.classList.contains('mine')).toBe(true);
    expect(container.querySelectorAll('.shelf-sdk')).toHaveLength(1);
  });
  it('defaults to the light theme', () => {
    const { container } = render(<ViewToggle value="grid" onChange={noop} />);
    expect(rootOf(container)?.getAttribute('data-theme')).toBe('light');
  });
  it('a data-bound FolderGrid reads its subfolders from the provider; without a client it says it is not connected', async () => {
    const client = mock();
    const { container, unmount } = render(
      <ShelfProvider client={client}>
        <FolderGrid folderId={null} onOpenFolder={noop} />
      </ShelfProvider>,
    );
    await screen.findByText('Contracts');
    expect(container.querySelectorAll('.shelf-sdk')).toHaveLength(1);
    unmount();
    render(<FolderGrid onOpenFolder={noop} />);
    expect(screen.getByText("Shelf isn't connected")).toBeTruthy();
    void BASE;
  });
});
