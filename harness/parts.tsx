// Renders ONE standalone component (?part=Name) or a combination (?part=A,B) the way a consumer would: each from its own
// subpath entry, no ShelfProvider, no ShelfFolder around it. Which stylesheets are loaded is decided by the page
// harness/parts.mjs serves, not here. Data is static (props), except DocumentPage / ShelfFolder which read the fake API.
import { createRoot } from 'react-dom/client';
import type { ReactNode } from 'react';
import { ActionMenu } from '../dist/react/action-menu/index.js';
import { DocumentCard } from '../dist/react/document-card/index.js';
import { DocumentGallery } from '../dist/react/document-gallery/index.js';
import { DocumentList } from '../dist/react/document-list/index.js';
import { DocumentPage, DocumentPreviewTab, DocumentTextTab } from '../dist/react/document-page/index.js';
import { FolderCard, FolderNameForm } from '../dist/react/folder-card/index.js';
import { FolderGrid } from '../dist/react/folder-grid/index.js';
import { FolderHeader } from '../dist/react/folder-header/index.js';
import { FolderToolbar } from '../dist/react/folder-toolbar/index.js';
import { FolderTree } from '../dist/react/folder-tree/index.js';
import { ShelfFolder } from '../dist/react/folder-view/index.js';
import { OfflineBanner } from '../dist/react/offline-banner/index.js';
import { UploadDropzone } from '../dist/react/upload-dropzone/index.js';
import { ViewToggle } from '../dist/react/view-toggle/index.js';

const API = '/api/shelf';
const ROOT = '11111111-1111-4111-8111-111111111111';
const f = (name: string, n: number, extra: Record<string, unknown> = {}) => ({ id: `22222222-2222-4222-8222-22222222222${n}`, parent_id: ROOT, name, ...extra });
const folders = [f('Contracts', 1, { item_count: 3 }), f('Quotes', 2, { item_count: 0 }), f('Inspiration', 3), f('Planning for the Stellenbosch wedding venue shortlist', 4)];
const item = (id: string, filename: string, content_type: string, preview_sizes: string[], extra: Record<string, unknown> = {}) => ({
  id, filename, content_type, size_bytes: 88_000, folder_id: folders[0]!.id, parse_status: 'ready', created_at: '2026-10-27T09:12:00Z', edited_at: null, parsed_at: '2026-10-27T09:12:04Z', preview_sizes, word_count: 120, ...extra,
});
const items = [
  item('d1', 'moodboard.png', 'image/png', ['small', 'medium']),
  item('d2', 'contract-draft.txt', 'text/plain', []),
  item('d3', 'quote-final-version-with-a-rather-long-name-that-has-to-wrap-somewhere.pdf', 'application/pdf', []),
  item('d4', 'pending-upload.png', 'image/png', [], { sync: 'pending', outboxId: 'o1', localOnly: true }),
  item('d5', 'failed-upload.pdf', 'application/pdf', [], { sync: 'failed', outboxId: 'o2', localOnly: true, syncError: 'The server refused this file.' }),
  item('d6', 'notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', [], { parse_status: 'processing' }),
];
const PNG1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const loader = { load: async () => PNG1, peek: () => PNG1, dispose() {} };
const noop = () => {};
const menu = [{ label: 'Rename', onSelect: noop }, { label: 'Move to…', onSelect: noop }, { label: 'Delete', onSelect: noop, danger: true }];
const doc = { ...items[1]!, parsed_text: 'This is a short contract draft.\nSecond line.', download_url: `${API}/files/x/original/contract-draft.txt` };

export const PARTS: Record<string, () => ReactNode> = {
  FolderCard: () => (
    <div style={{ display: 'grid', gap: 12, maxWidth: 360 }}>
      <FolderCard folder={folders[0]!} folderCount={2} itemCount={3} onOpen={noop} />
      <FolderCard folder={folders[3]!} caption="Empty" onOpen={noop} actions={menu} />
      <FolderCard folder={folders[1]!} itemCount={0} sync="pending" renaming={{ error: 'A folder named “Quotes” already exists.', onSubmit: noop, onCancel: noop, onEdit: noop }} />
    </div>
  ),
  FolderNameForm: () => <FolderNameForm initialName="Quotes" submitLabel="Rename" error="That name is taken." onSubmit={noop} onCancel={noop} />,
  FolderGrid: () => <FolderGrid folders={folders as never} onOpenFolder={noop} folderActions={() => menu} />,
  FolderHeader: () => <FolderHeader crumbs={[{ id: 'a', name: 'Aisle CMS' }, { id: 'b', name: 'Contracts' }]} onNavigate={noop} meta="3 items · 2 folders" />,
  FolderToolbar: () => <FolderToolbar canWrite adding={2} layout="grid" onAddFiles={noop} onNewFolder={noop} onLayoutChange={noop} />,
  ViewToggle: () => <ViewToggle value="list" onChange={noop} />,
  UploadDropzone: () => <UploadDropzone folderId={folders[0]!.id} onFiles={noop} hint="PDF, images and Office files"><p>Documents go here</p></UploadDropzone>,
  DocumentCard: () => (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 220px)', gap: 12 }}>
      {items.slice(0, 5).map((i) => <DocumentCard key={i.id} item={i as never} loader={loader as never} canWrite onOpen={noop} onAction={noop} onRetry={noop} onDiscard={noop} selected={i.id === 'd2'} />)}
    </div>
  ),
  DocumentGallery: () => <DocumentGallery items={items as never} loader={undefined} canWrite onOpen={noop} onAction={noop} selectedId="d1" />,
  DocumentList: () => <DocumentList items={items as never} folders={folders as never} canWrite onOpen={noop} onAction={noop} onOpenFolder={noop} folderActions={() => menu} />,
  DocumentTextTab: () => <DocumentTextTab text={doc.parsed_text} />,
  DocumentPreviewTab: () => <DocumentPreviewTab document={doc as never} loader={loader as never} />,
  DocumentPage: () => <DocumentPage baseUrl={API} documentId="33333333-3333-4333-8333-333333333333" initial={items[1] as never} location="Aisle CMS / Contracts" folderName="Contracts" onClose={noop} actions={{ rename: noop, move: noop, delete: noop }} />,
  OfflineBanner: () => (
    <div style={{ display: 'grid', gap: 8 }}>
      <OfflineBanner online={false} waiting={2} />
      <OfflineBanner online waiting={3} />
    </div>
  ),
  ActionMenu: () => <ActionMenu label="Actions for contract-draft.txt" actions={menu} />,
  FolderTree: () => (
    <FolderTree rootId={ROOT} rootName="Aisle CMS" folders={folders as never} files={items.slice(0, 3) as never} totals={new Map([[folders[0]!.id, 3]])} currentFolderId={folders[0]!.id} currentFileId="d2" onOpenFolder={noop} onOpenFile={noop} />
  ),
  ShelfFolder: () => <ShelfFolder baseUrl={API} />,
};

const names = (new URLSearchParams(location.search).get('part') ?? '').split(',').filter(Boolean);
createRoot(document.getElementById('root')!).render(
  <>
    {names.map((n) => (
      <section key={n} data-part={n} style={{ margin: '0 0 24px' }}>
        {PARTS[n]?.() ?? <b>unknown part {n}</b>}
      </section>
    ))}
  </>,
);
