import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import type { ReactNode } from 'react';
import type { ShelfClient } from '../../src/client';
import { ShelfProvider } from '../../src/react/ShelfProvider';
import type { ShelfProviderProps } from '../../src/react/contracts';
import type { ShelfItem } from '../../src/types';

export const BASE = 'https://shelf.test/api';

export const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1', filename: 'plan.pdf', content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root',
  parse_status: 'parsed', created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: [], ...o,
});
export const FOLDERS = [
  { id: 'root', name: 'Aisle CMS', parent_id: null, item_count: 1, total_item_count: 3 },
  { id: 'sub', name: 'Contracts', parent_id: 'root', item_count: 2, total_item_count: 2 },
];

export function mock(over: Partial<Record<keyof ShelfClient, unknown>> = {}) {
  const c = {
    baseUrl: BASE,
    info: vi.fn(async () => ({ access: 'read' })),
    folders: vi.fn(async () => FOLDERS),
    listFiles: vi.fn(async () => ({ items: [item(), item({ id: 'f2', filename: 'notes.pdf' })], next_cursor: null })),
    getFile: vi.fn(async (id: string) => ({ ...item({ id }), parsed_text: 'the text', has_site: false })),
    getSite: vi.fn(async (id: string) => ({ file_id: id, status: 'ready', spec: { blocks: [] } })),
    upload: vi.fn(async (_f: Blob, o: { filename?: string }) => item({ id: 'srv', filename: o.filename ?? 'x' })),
    updateFile: vi.fn(),
    deleteFile: vi.fn(),
    thumbnailUrl: (id: string, size?: string | number) => `/t/${id}?size=${size}`,
    originalUrl: (id: string, name: string) => `/o/${id}/${name}`,
    ...over,
  };
  return c as unknown as ShelfClient & typeof c;
}

export function freshDb(): void {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
}

/** The two ways a hook is given its Shelf: straight in its options, or from a provider. */
export const modes = [
  ['standalone {client}', (client: ShelfClient) => ({ source: { client }, wrapper: ({ children }: { children?: ReactNode }) => <>{children}</> })],
  [
    'inside a provider',
    (client: ShelfClient, extra: Partial<ShelfProviderProps> = {}) => ({
      source: undefined,
      wrapper: ({ children }: { children?: ReactNode }) => <ShelfProvider client={client} {...extra}>{children}</ShelfProvider>,
    }),
  ],
] as const;

export const file = (name = 'a.pdf'): File => new File([new Uint8Array([1, 2, 3])], name, { type: 'application/pdf' });
