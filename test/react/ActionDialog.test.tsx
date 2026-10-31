// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ActionDialog, FolderDialog } from '../../src/react/ActionDialog';
import type { OverlayFolder } from '../../src/internal/contracts';
import { item } from './helpers';

afterEach(cleanup);

// The delete confirmation is Shelf's trash wording, word for word: it says where the document goes and that it comes back.
// sdk-react-native's README tells hosts to use the same sentences.
describe('delete confirmation wording', () => {
  it('a document: "Move <name> to the Shelf trash? You can restore it in Shelf."', () => {
    const onDelete = vi.fn();
    const doc = item({ filename: 'plan.pdf' });
    render(<ActionDialog pending={{ kind: 'delete', item: doc }} folders={[]} busy={false} onRename={vi.fn()} onMove={vi.fn()} onDelete={onDelete} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm delete' });
    expect(dialog.querySelector('span')!.textContent).toBe('Move plan.pdf to the Shelf trash? You can restore it in Shelf.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalledWith(doc);
  });

  it('a folder: "Move “<name>” and everything in it to the Shelf trash? You can restore it in Shelf."', () => {
    const folder: OverlayFolder = { id: 'a', name: 'Contracts', parent_id: 'root', sync: 'synced' };
    const onDelete = vi.fn();
    render(<FolderDialog pending={{ kind: 'delete', folder }} folders={[folder]} busy={false} error={null} onMove={vi.fn()} onDelete={onDelete} onCancel={vi.fn()} />);
    const dialog = screen.getByRole('alertdialog', { name: 'Confirm delete folder' });
    expect(dialog.querySelector('span')!.textContent).toBe('Move “Contracts” and everything in it to the Shelf trash? You can restore it in Shelf.');
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }));
    expect(onDelete).toHaveBeenCalledWith(folder);
  });

  it('busy disables Confirm delete', () => {
    render(<ActionDialog pending={{ kind: 'delete', item: item() }} folders={[]} busy onRename={vi.fn()} onMove={vi.fn()} onDelete={vi.fn()} onCancel={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Confirm delete' }) as HTMLButtonElement).disabled).toBe(true);
  });
});
