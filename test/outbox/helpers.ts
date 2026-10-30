import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { ShelfError } from '../../src/client';
import type { ShelfClient } from '../../src/client';
import { openKv } from '../../src/storage/db';
import type { KvStore } from '../../src/storage/db';
import type { ShelfFolder, ShelfItem } from '../../src/types';
import type { LockManagerLike } from '../../src/outbox/outbox';

export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function freshDb(): void {
  (globalThis as { indexedDB?: unknown }).indexedDB = new IDBFactory();
}

export const openTestKv = (id = 'a'.repeat(32), persistent = true): Promise<KvStore> => openKv({ id, persistent });

export const item = (o: Partial<ShelfItem> = {}): ShelfItem => ({
  id: 'f1',
  filename: 'plan.pdf',
  content_type: 'application/pdf',
  size_bytes: 3,
  folder_id: null,
  parse_status: 'parsed',
  created_at: '2026-01-02T00:00:00Z',
  edited_at: null,
  parsed_at: null,
  preview_sizes: [],
  ...o,
});

export const bytes = (n = 3): ArrayBuffer => new Uint8Array(n).fill(7).buffer;

export function upOp(name: string, extra: { folderId?: string | null; size?: number } = {}) {
  return {
    kind: 'upload' as const,
    folderId: extra.folderId ?? null,
    filename: name,
    contentType: 'application/pdf',
    size: extra.size ?? 3,
    bytes: bytes(extra.size ?? 3),
    clientRef: '',
  };
}

export type FakeClient = ShelfClient & {
  upload: ReturnType<typeof vi.fn>;
  getFile: ReturnType<typeof vi.fn>;
  updateFile: ReturnType<typeof vi.fn>;
  deleteFile: ReturnType<typeof vi.fn>;
  folders: ReturnType<typeof vi.fn>;
  createFolder: ReturnType<typeof vi.fn>;
  updateFolder: ReturnType<typeof vi.fn>;
  deleteFolder: ReturnType<typeof vi.fn>;
};

export const folder = (o: Partial<ShelfFolder> = {}): ShelfFolder => ({ id: 'fo1', name: 'Plans', parent_id: 'root', ...o });

/** A client whose methods succeed. Override per test with mockImplementation. */
export function fakeClient(over: Partial<Record<'upload' | 'getFile' | 'updateFile' | 'deleteFile' | 'folders' | 'createFolder' | 'updateFolder' | 'deleteFolder', (...a: any[]) => any>> = {}): FakeClient {
  let n = 0;
  return {
    baseUrl: 'https://x.test',
    upload: vi.fn(over.upload ?? (async (_f: Blob, o: { filename?: string; client_ref?: string }) => item({ id: 'srv-' + ++n, filename: o.filename ?? 'x' }))),
    getFile: vi.fn(over.getFile ?? (async (id: string) => item({ id }))),
    updateFile: vi.fn(over.updateFile ?? (async (id: string, p: object) => item({ id, ...p }))),
    deleteFile: vi.fn(over.deleteFile ?? (async () => undefined)),
    folders: vi.fn(over.folders ?? (async () => [folder({ id: 'root', name: 'Key', parent_id: null }), folder()])),
    createFolder: vi.fn(over.createFolder ?? (async (i: { name: string; parent_id?: string }) => folder({ id: 'srv-folder-' + ++n, name: i.name, parent_id: i.parent_id ?? 'root' }))),
    updateFolder: vi.fn(over.updateFolder ?? (async (id: string, p: object) => folder({ id, ...p }))),
    deleteFolder: vi.fn(over.deleteFolder ?? (async () => undefined)),
  } as unknown as FakeClient;
}

export const err = (status: number, code = 'e') => new ShelfError(status, code, `HTTP ${status}`);

/** navigator.locks stand-in: one holder per name; ifAvailable gives null when held. */
export function fakeLocks(): LockManagerLike & { requests: Array<{ name: string; ifAvailable?: boolean; granted: boolean }>; hold(name: string): void } {
  const held = new Set<string>();
  const requests: Array<{ name: string; ifAvailable?: boolean; granted: boolean }> = [];
  return {
    requests,
    hold: (name: string) => void held.add(name),
    async request(name, options, cb) {
      if (held.has(name)) {
        requests.push({ name, ifAvailable: options.ifAvailable, granted: false });
        return cb(null);
      }
      held.add(name);
      requests.push({ name, ifAvailable: options.ifAvailable, granted: true });
      try {
        return await cb({ name });
      } finally {
        held.delete(name);
      }
    },
  };
}

export const tick = (ms = 0) => new Promise<void>((r) => setTimeout(r, ms));
