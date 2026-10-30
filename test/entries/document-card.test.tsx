// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, waitFor } from '@testing-library/react';
import { DocumentCard } from '../../src/entries/document-card';
import { item, mock } from '../react/helpers';

const noop = () => undefined;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('DocumentCard standalone', () => {
  it('with only {client} loads its thumbnail through client.thumbnail', async () => {
    const thumbnail = vi.fn(async (_id: string, _size: string | number, _opts?: unknown) => ({ status: 200 as const, bytes: new Uint8Array([1, 2, 3]).buffer, type: 'image/png', etag: null }));
    const client = mock({ thumbnail });
    URL.createObjectURL = vi.fn(() => 'blob:direct');
    const { container } = render(<DocumentCard client={client} item={item({ preview_sizes: ['small', 'medium', 'large'] })} onOpen={noop} />);
    await waitFor(() => expect(container.querySelector('img')?.getAttribute('src')).toBe('blob:direct'));
    expect(thumbnail).toHaveBeenCalledTimes(1);
    expect(thumbnail.mock.calls[0]![0]).toBe('f1');
  });

  it('draws its own themed root and shows the placeholder when there is nothing to load with', () => {
    const { container } = render(<DocumentCard item={item({ preview_sizes: ['small'] })} onOpen={noop} theme="dark" className="mine" />);
    const root = container.firstElementChild!;
    expect(root.className).toBe('shelf-sdk mine');
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('.shelf-sdk__file-card-type')?.textContent).toBe('PDF');
  });

  it('opens the document and offers write actions only with canWrite', () => {
    const onOpen = vi.fn();
    const { getByText, queryByLabelText, rerender } = render(<DocumentCard item={item()} onOpen={onOpen} />);
    getByText('plan.pdf').click();
    expect(onOpen).toHaveBeenCalledWith('f1');
    expect(queryByLabelText('Actions for plan.pdf')).toBeNull();
    rerender(<DocumentCard item={item()} onOpen={onOpen} canWrite onAction={noop} />);
    expect(queryByLabelText('Actions for plan.pdf')).toBeTruthy();
  });
});
