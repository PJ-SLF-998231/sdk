// Type-checks every subpath with moduleResolution "bundler" against the built dist (run npm run build first).
import * as m0 from '@pj-slf-998231/sdk';
import type { ShelfClient as ShelfClient_m0 } from '@pj-slf-998231/sdk';
import type { ShelfItem as ShelfItem_m0 } from '@pj-slf-998231/sdk';
import type { ShelfInfo as ShelfInfo_m0 } from '@pj-slf-998231/sdk';
import * as m1 from '@pj-slf-998231/sdk/react';
import type { ShelfFolderProps as ShelfFolderProps_m1 } from '@pj-slf-998231/sdk/react';
import * as m2 from '@pj-slf-998231/sdk/react/folder-view';
import * as m3 from '@pj-slf-998231/sdk/react/provider';
import type { ShelfProviderProps as ShelfProviderProps_m3 } from '@pj-slf-998231/sdk/react/provider';
import type { ShelfSource as ShelfSource_m3 } from '@pj-slf-998231/sdk/react/provider';
import type { UseShelfResult as UseShelfResult_m3 } from '@pj-slf-998231/sdk/react/provider';
import * as m4 from '@pj-slf-998231/sdk/react/hooks';
import type { UseFoldersResult as UseFoldersResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseFolderResult as UseFolderResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseDocumentResult as UseDocumentResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseOutboxResult as UseOutboxResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseDocumentActionsResult as UseDocumentActionsResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseFolderActionsResult as UseFolderActionsResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import type { UseUploadResult as UseUploadResult_m4 } from '@pj-slf-998231/sdk/react/hooks';
import * as m5 from '@pj-slf-998231/sdk/react/folder-card';
import type { FolderCardProps as FolderCardProps_m5 } from '@pj-slf-998231/sdk/react/folder-card';
import * as m6 from '@pj-slf-998231/sdk/react/folder-grid';
import type { FolderGridProps as FolderGridProps_m6 } from '@pj-slf-998231/sdk/react/folder-grid';
import * as m7 from '@pj-slf-998231/sdk/react/folder-header';
import type { FolderHeaderProps as FolderHeaderProps_m7 } from '@pj-slf-998231/sdk/react/folder-header';
import * as m8 from '@pj-slf-998231/sdk/react/folder-toolbar';
import type { FolderToolbarProps as FolderToolbarProps_m8 } from '@pj-slf-998231/sdk/react/folder-toolbar';
import * as m9 from '@pj-slf-998231/sdk/react/view-toggle';
import type { ViewToggleProps as ViewToggleProps_m9 } from '@pj-slf-998231/sdk/react/view-toggle';
import * as m10 from '@pj-slf-998231/sdk/react/upload-dropzone';
import type { UploadDropzoneProps as UploadDropzoneProps_m10 } from '@pj-slf-998231/sdk/react/upload-dropzone';
import * as m11 from '@pj-slf-998231/sdk/react/document-card';
import type { DocumentCardProps as DocumentCardProps_m11 } from '@pj-slf-998231/sdk/react/document-card';
import * as m12 from '@pj-slf-998231/sdk/react/document-gallery';
import type { DocumentGalleryProps as DocumentGalleryProps_m12 } from '@pj-slf-998231/sdk/react/document-gallery';
import * as m13 from '@pj-slf-998231/sdk/react/document-list';
import type { DocumentListProps as DocumentListProps_m13 } from '@pj-slf-998231/sdk/react/document-list';
import * as m14 from '@pj-slf-998231/sdk/react/document-page';
import type { DocumentPageProps as DocumentPageProps_m14 } from '@pj-slf-998231/sdk/react/document-page';
import type { DocumentTextTabProps as DocumentTextTabProps_m14 } from '@pj-slf-998231/sdk/react/document-page';
import * as m15 from '@pj-slf-998231/sdk/react/offline-banner';
import * as m16 from '@pj-slf-998231/sdk/react/action-menu';
import type { MenuAction as MenuAction_m16 } from '@pj-slf-998231/sdk/react/action-menu';
import * as m17 from '@pj-slf-998231/sdk/react/folder-tree';
import type { FolderTreeProps as FolderTreeProps_m17 } from '@pj-slf-998231/sdk/react/folder-tree';

// Every subpath resolves and exposes its public names.
export const surface = {
  '.': [m0.createShelfClient, m0.isAuthLost, m0.isOfflineError, m0.ShelfError, m0.clearCache],
  './react': [m1.ShelfFolder, m1.clearCache],
  './react/folder-view': [m2.ShelfFolder],
  './react/provider': [m3.ShelfProvider, m3.useShelf],
  './react/hooks': [m4.useShelf, m4.useFolders, m4.useFolder, m4.useDocument, m4.useDocumentText, m4.useDocumentSite, m4.useUpload, m4.useOutbox, m4.useOnlineStatus, m4.useDocumentActions, m4.useFolderActions],
  './react/folder-card': [m5.FolderCard, m5.FolderNameForm],
  './react/folder-grid': [m6.FolderGrid],
  './react/folder-header': [m7.FolderHeader],
  './react/folder-toolbar': [m8.FolderToolbar],
  './react/view-toggle': [m9.ViewToggle],
  './react/upload-dropzone': [m10.UploadDropzone],
  './react/document-card': [m11.DocumentCard],
  './react/document-gallery': [m12.DocumentGallery],
  './react/document-list': [m13.DocumentList],
  './react/document-page': [m14.DocumentPage, m14.DocumentTextTab, m14.DocumentPreviewTab, m14.DocumentContentTab],
  './react/offline-banner': [m15.OfflineBanner],
  './react/action-menu': [m16.ActionMenu],
  './react/folder-tree': [m17.FolderTree],
};

// The frozen 0.4 prop types accept what the README shows and reject what it does not.
export const source: ShelfSource_m3 = { baseUrl: '/api/shelf', cacheScope: 'user-1' };
export const card: FolderCardProps_m5 = { folder: { id: 'f1', name: 'Contracts' }, itemCount: 3, onOpen: (id: string) => void id };
// @ts-expect-error an unknown prop is rejected
export const bad: FolderCardProps_m5 = { folder: { id: 'f1', name: 'Contracts' }, nope: 1 };

// The wire types follow the api's openapi.yaml: GET / (IntegrationInfo) and a document's nullable parse_status.
export const info: ShelfInfo_m0 = { id: 'i1', name: 'Acme CRM', access: 'read', expires_at: null, folder: { id: 'f1', name: 'Contracts' } };
export const noStatus: ShelfItem_m0['parse_status'] = null;
// @ts-expect-error id, name and expires_at are always sent
export const partialInfo: ShelfInfo_m0 = { access: 'read' };
