/**
 * Public contracts of the 0.4.0 headless hooks and standalone components. FROZEN by 0.4 U1 (sdk 0.4 plan): U2..U9 implement
 * these shapes; change them only through a manager-approved revision. Types only: no runtime code, so it adds no bytes to any entry.
 *
 * Source resolution, for every hook and data-bound component:
 *   props.client > props.baseUrl (one client per baseUrl, memoised) > nearest ShelfProvider > none.
 * With none, a component shows the same "Shelf isn't connected" callout as ShelfFolder; a hook reports status 'disconnected'.
 *
 * Every standalone component renders its own `.shelf-sdk` root (theme, className) unless it already sits inside one
 * (internal RootContext), so inside ShelfFolder the DOM is unchanged.
 */
import type { ReactNode } from 'react';
import type { ShelfClient, ShelfError } from '../client';
import type { ApplyFolderOutboxFn, FolderOutboxEntry, FolderOutboxOp, ItemSyncState, OutboxView, OverlayFolder, OverlayItem, ThumbLoader } from '../internal/contracts';
import type { ShelfDocument, ShelfFolder as ShelfFolderRecord, ShelfItem, ShelfSite } from '../types';
import type { MenuAction } from './ActionMenu';
import type { SiteView } from './siteView';
import type { ItemAction } from './syncUi';

/** The record type of a folder from the API. Named `ShelfFolderRecord` here because `ShelfFolder` is the component; never re-exported from `./react`. */
export type { ShelfFolderRecord };
export type { ApplyFolderOutboxFn, FolderOutboxEntry, FolderOutboxOp, OverlayFolder, OverlayItem, OutboxView };
export type { MenuAction };

/* ===================================================================== provider and session */

export type ShelfTheme = 'light' | 'dark' | 'auto';

export interface ShelfSource {
  /** A ready client. Wins over `baseUrl` and over the provider. */
  client?: ShelfClient;
  /** Integration API base URL. One client is created and memoised per base URL. */
  baseUrl?: string;
  /** Identifies who is signed in; caches never mix between scopes. `false` (or absent): memory only, nothing stored. */
  cacheScope?: string | false;
  /** Called once when the session is no longer authorised (401, or the proxy's 503 `not_configured`). */
  onAuthLost?: (error: ShelfError) => void;
}

export interface ShelfOfflineOptions {
  /** Offer offline writes through the outbox; its code is loaded only for a read_write key. Default true. */
  outbox?: boolean;
  /** Parallel uploads. Default 3. */
  uploadConcurrency?: number;
  /** Network/5xx attempts before an outbox entry becomes `failed`. Default 8. */
  maxAttempts?: number;
}

export interface ShelfProviderProps extends ShelfSource {
  offline?: ShelfOfflineOptions;
  /** Default 'light'. 'auto' follows the OS colour scheme and is opt-in. */
  theme?: ShelfTheme;
  /** Default for every document page below (ShelfFolder and DocumentPage) that is not given `showPreviewSizes`. Default true. (additive, 0.4 U7) */
  showPreviewSizes?: boolean;
  /** Default for every document page below that is not given `documentTabs`. Default ['text', 'preview', 'content']. (additive, 0.4 U7) */
  documentTabs?: readonly DocumentTabId[];
  children?: ReactNode;
}

export type ShelfStatus = 'connecting' | 'ready' | 'disconnected' | 'auth-lost';

export interface UseShelfResult {
  status: ShelfStatus;
  client: ShelfClient | null;
  access: 'read' | 'read_write' | null;
  rootFolderId: string | null;
  /** Pending changes thrown away when auth was lost; 0 otherwise. */
  discarded: number;
}

/** Common to every standalone component. */
export interface ShelfComponentProps {
  /** Only used when the component renders its own root (not inside ShelfFolder or another root). */
  theme?: ShelfTheme;
  className?: string;
}

/* ===================================================================== headless hooks (./react/hooks) */

export type UseShelfFn = (source?: ShelfSource) => UseShelfResult;

export interface UseFoldersResult {
  /** Every folder the key can see, with queued folder operations applied. */
  folders: OverlayFolder[];
  byId: ReadonlyMap<string, OverlayFolder>;
  rootId: string | null;
  /** Direct children; `null` means the key's root folder. */
  childrenOf(id: string | null): OverlayFolder[];
  /** From the root down to `id` (inclusive); `null` means the root. */
  pathTo(id: string | null): OverlayFolder[];
  /** Documents at any depth under each folder: `total_item_count` when the API sends it, else the census fallback. null while unknown. */
  totals: ReadonlyMap<string, number> | null;
  totalItems: number | null;
  loading: boolean;
  error: unknown;
  offline: boolean;
  stale: boolean;
  refresh(): Promise<void>;
}
export type UseFoldersFn = (source?: ShelfSource) => UseFoldersResult;

export interface UseFolderOptions extends ShelfSource {
  /** Documents per request. Default 200. */
  pageSize?: number;
}

export interface UseFolderResult {
  folder: OverlayFolder | null;
  subfolders: OverlayFolder[];
  path: OverlayFolder[];
  /** The loaded documents, with queued outbox changes applied. */
  items: OverlayItem[];
  /** True when no more pages exist. */
  complete: boolean;
  nextCursor: string | null;
  loadMore(): Promise<void>;
  /** Starts fetching the next page quietly; no-op when complete or already fetching. */
  prefetchNext(): void;
  loading: boolean;
  error: unknown;
  offline: boolean;
  refresh(): Promise<void>;
}
export type UseFolderFn = (folderId: string | null, opts?: UseFolderOptions) => UseFolderResult;

export interface UseDocumentResult {
  document?: ShelfDocument;
  loading: boolean;
  error: unknown;
  offline: boolean;
  stale: boolean;
  refresh(): Promise<void>;
}
/** Cache key `file:<id>`, shared with useDocumentText. */
export type UseDocumentFn = (id: string | null, source?: ShelfSource) => UseDocumentResult;

export interface UseDocumentTextResult {
  text?: string;
  loading: boolean;
  error: unknown;
}
export type UseDocumentTextFn = (id: string | null, source?: ShelfSource) => UseDocumentTextResult;

export interface UseDocumentSiteOptions extends ShelfSource {
  /** Default true. While false nothing is fetched. */
  enabled?: boolean;
}
export interface UseDocumentSiteResult {
  view: SiteView;
  site?: ShelfSite;
  refresh(): Promise<void>;
}
/** Polls every 2.5 s while the site is building. */
export type UseDocumentSiteFn = (id: string | null, opts?: UseDocumentSiteOptions) => UseDocumentSiteResult;

export interface UseUploadResult {
  /** A read_write key, a ready session, and a real (not local-folder) target. */
  canUpload: boolean;
  upload(files: readonly File[]): Promise<void>;
  /** Uploads accepted and still queued or sending. */
  adding: boolean;
}
export type UseUploadFn = (folderId: string | null, source?: ShelfSource) => UseUploadResult;

export type UseOutboxResult = OutboxView & {
  /** The outbox has loaded (it is lazy and only exists for a read_write key). */
  ready: boolean;
  retry(id: string): Promise<void>;
  discard(id: string): Promise<void>;
};
export type UseOutboxFn = (source?: ShelfSource) => UseOutboxResult;

export type UseOnlineStatusFn = () => boolean;

export interface UseDocumentActionsResult {
  canWrite: boolean;
  rename(item: ShelfItem, name: string): Promise<void>;
  move(item: ShelfItem, folderId: string): Promise<void>;
  remove(item: ShelfItem): Promise<void>;
}
export type UseDocumentActionsFn = (source?: ShelfSource) => UseDocumentActionsResult;

export interface UseFolderActionsResult {
  canWrite: boolean;
  create(name: string, parentId: string | null): Promise<void>;
  rename(folder: ShelfFolderRecord, name: string): Promise<void>;
  move(folder: ShelfFolderRecord, parentId: string): Promise<void>;
  /** Refuses the key's root folder (the API answers 403). */
  remove(folder: ShelfFolderRecord): Promise<void>;
}
export type UseFolderActionsFn = (source?: ShelfSource) => UseFolderActionsResult;

/* ===================================================================== standalone components */

/** Display-only; takes data props and never imports the cache engine. */
export interface FolderCardProps extends ShelfComponentProps {
  folder: ShelfFolderRecord;
  /** Direct subfolders, for the caption. */
  folderCount?: number;
  /** Documents in the folder, for the caption. `caption` wins when both are given. */
  itemCount?: number;
  caption?: string;
  onOpen?(id: string): void;
  /** Without actions the DOM is identical to the 0.3 folder tile. */
  actions?: MenuAction[];
  /** The card is showing the inline rename form. */
  renaming?: { error: string | null; onSubmit(name: string): void; onCancel(): void; onEdit(): void } | null;
  sync?: ItemSyncState;
}

export interface FolderNameFormProps extends ShelfComponentProps {
  initialName?: string;
  label?: string;
  submitLabel?: string;
  error?: string | null;
  onSubmit(name: string): void;
  onCancel(): void;
  onEdit?(): void;
}

export interface FolderGridProps extends ShelfSource, ShelfComponentProps {
  /** Folder whose subfolders to show (data-bound), or pass `folders` directly. */
  folderId?: string | null;
  folders?: readonly OverlayFolder[];
  onOpenFolder(id: string): void;
  folderActions?(folder: ShelfFolderRecord): MenuAction[];
  adding?: boolean;
}

export interface Crumb {
  id: string;
  name: string;
}
export interface FolderHeaderProps extends ShelfSource, ShelfComponentProps {
  /** Folder whose path to show (data-bound), or pass `crumbs` directly. */
  folderId?: string | null;
  crumbs?: readonly Crumb[];
  onNavigate(id: string): void;
  /** Right-hand text such as "12 items · 3 folders". */
  meta?: ReactNode;
  actions?: ReactNode;
  /** A document sits below the last crumb, so the crumb is a link rather than the current page. */
  documentOpen?: boolean;
}

export type FolderLayout = 'grid' | 'list';

export interface FolderToolbarProps extends ShelfComponentProps {
  canWrite: boolean;
  onAddFiles(files: File[]): void;
  /** Present only when folders can be created. */
  onNewFolder?(): void;
  /** Uploads in flight: a count ("Adding 2 documents…") or just whether any are (U4 widened this from `boolean`, additive). */
  adding: boolean | number;
  layout: FolderLayout;
  onLayoutChange(layout: FolderLayout): void;
}

export interface ViewToggleProps extends ShelfComponentProps {
  value: FolderLayout;
  onChange(value: FolderLayout): void;
}

export interface UploadDropzoneProps extends ShelfSource, ShelfComponentProps {
  folderId?: string | null;
  /** Called with dropped/picked files instead of uploading them through the session. */
  onFiles?(files: File[]): void;
  disabled?: boolean;
  hint?: ReactNode;
  children?: ReactNode;
}

export type DocumentAction = ItemAction;

export interface DocumentCardProps extends ShelfComponentProps {
  item: ShelfItem & Partial<Pick<OverlayItem, 'sync' | 'outboxId' | 'localOnly' | 'syncError'>>;
  /** Thumbnail loader; without one, `client` (or the nearest provider) is used. */
  loader?: ThumbLoader;
  client?: ShelfClient;
  selected?: boolean;
  /** Offer Rename / Move / Delete in the menu. */
  canWrite?: boolean;
  onOpen(id: string): void;
  onAction?(action: DocumentAction, id: string): void;
  onRetry?(outboxId: string): void;
  onDiscard?(outboxId: string): void;
}

export interface DocumentCollectionProps extends ShelfSource, ShelfComponentProps {
  /** Folder whose documents to show (data-bound), or pass `items` directly. */
  folderId?: string | null;
  /** Server items; items from the outbox overlay (`sync`, `outboxId`, ...) are drawn with their sync state. */
  items?: readonly DocumentCardProps['item'][];
  selectedId?: string | null;
  canWrite?: boolean;
  onOpen(id: string): void;
  onAction?(action: DocumentAction, id: string): void;
  onRetry?(outboxId: string): void;
  onDiscard?(outboxId: string): void;
  /** The last rows are in view: fetch the next page. */
  onNearEnd?(): void;
}
export type DocumentGalleryProps = DocumentCollectionProps;
export interface DocumentListProps extends DocumentCollectionProps {
  /** Subfolders shown as rows above the documents. */
  folders?: readonly OverlayFolder[];
  folderCaption?(folder: ShelfFolderRecord): string;
  onOpenFolder?(id: string): void;
  folderActions?(folder: ShelfFolderRecord): MenuAction[];
}

/** The document page's tabs. */
export type DocumentTabId = 'content' | 'preview' | 'text';

/** Shared by the document page and its Preview tab (additive in 0.4 U6). */
export interface DocumentPreviewOptions {
  /** Show the Small / Medium / Large / Original bar over an image preview. Default true. When false the image shows at the size it opens with. */
  showPreviewSizes?: boolean;
}

export interface DocumentPageProps extends ShelfSource, ShelfComponentProps, DocumentPreviewOptions {
  documentId: string;
  /**
   * Which tabs to show and in what order. Default ['text', 'preview', 'content']. A listed tab that does not apply
   * (Content without a generated site) is skipped; the page opens on the first one that is available.
   */
  documentTabs?: readonly DocumentTabId[];
  /** The listing's record, shown while the full document loads. */
  initial?: ShelfItem;
  /** Where it sits, for the Location row. */
  location?: string;
  folderName?: string;
  onClose?(): void;
  /** Present only when the matching write is allowed. */
  actions?: { rename?(): void; move?(): void; delete?(): void };
}

export interface DocumentTextTabProps extends ShelfComponentProps {
  text: string | null | undefined;
}
export interface DocumentPreviewTabProps extends ShelfComponentProps, DocumentPreviewOptions {
  document: ShelfDocument;
  client?: ShelfClient;
  loader?: ThumbLoader;
}
export interface DocumentContentTabProps extends ShelfSource, ShelfComponentProps {
  documentId: string;
  /** The document's `has_site`; the document-site renderer is a lazy chunk fetched only when there is a site. */
  hasSite?: boolean;
}
