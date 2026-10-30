// Type-checks every subpath as CommonJS (moduleResolution node16) against the built dist.
import m0 = require('@pj-slf-998231/sdk');
type ShelfClient_m0 = m0.ShelfClient;
type ShelfItem_m0 = m0.ShelfItem;
import m1 = require('@pj-slf-998231/sdk/react');
type ShelfFolderProps_m1 = m1.ShelfFolderProps;
import m2 = require('@pj-slf-998231/sdk/react/folder-view');
import m3 = require('@pj-slf-998231/sdk/react/provider');
type ShelfProviderProps_m3 = m3.ShelfProviderProps;
type ShelfSource_m3 = m3.ShelfSource;
type UseShelfResult_m3 = m3.UseShelfResult;
import m4 = require('@pj-slf-998231/sdk/react/hooks');
type UseFoldersResult_m4 = m4.UseFoldersResult;
type UseFolderResult_m4 = m4.UseFolderResult;
type UseDocumentResult_m4 = m4.UseDocumentResult;
type UseOutboxResult_m4 = m4.UseOutboxResult;
type UseDocumentActionsResult_m4 = m4.UseDocumentActionsResult;
type UseFolderActionsResult_m4 = m4.UseFolderActionsResult;
type UseUploadResult_m4 = m4.UseUploadResult;
import m5 = require('@pj-slf-998231/sdk/react/folder-card');
type FolderCardProps_m5 = m5.FolderCardProps;
import m6 = require('@pj-slf-998231/sdk/react/folder-grid');
type FolderGridProps_m6 = m6.FolderGridProps;
import m7 = require('@pj-slf-998231/sdk/react/folder-header');
type FolderHeaderProps_m7 = m7.FolderHeaderProps;
import m8 = require('@pj-slf-998231/sdk/react/folder-toolbar');
type FolderToolbarProps_m8 = m8.FolderToolbarProps;
import m9 = require('@pj-slf-998231/sdk/react/view-toggle');
type ViewToggleProps_m9 = m9.ViewToggleProps;
import m10 = require('@pj-slf-998231/sdk/react/upload-dropzone');
type UploadDropzoneProps_m10 = m10.UploadDropzoneProps;
import m11 = require('@pj-slf-998231/sdk/react/document-card');
type DocumentCardProps_m11 = m11.DocumentCardProps;
import m12 = require('@pj-slf-998231/sdk/react/document-gallery');
type DocumentGalleryProps_m12 = m12.DocumentGalleryProps;
import m13 = require('@pj-slf-998231/sdk/react/document-list');
type DocumentListProps_m13 = m13.DocumentListProps;
import m14 = require('@pj-slf-998231/sdk/react/document-page');
type DocumentPageProps_m14 = m14.DocumentPageProps;
type DocumentTextTabProps_m14 = m14.DocumentTextTabProps;
import m15 = require('@pj-slf-998231/sdk/react/offline-banner');
import m16 = require('@pj-slf-998231/sdk/react/action-menu');
type MenuAction_m16 = m16.MenuAction;
import m17 = require('@pj-slf-998231/sdk/react/folder-tree');
type FolderTreeProps_m17 = m17.FolderTreeProps;

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
