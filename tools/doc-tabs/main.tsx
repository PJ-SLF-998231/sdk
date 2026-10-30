import { createRoot } from 'react-dom/client';
import { DocumentPage } from '../../dist/react/document-page/index.js';

// ?doc=<id>&sizes=0|1&tabs=content,preview,text
const q = new URLSearchParams(location.search);
const tabs = q.get('tabs');
createRoot(document.getElementById('root')!).render(
  <DocumentPage
    baseUrl="/api/shelf"
    theme="light"
    documentId={q.get('doc') ?? 'd1'}
    {...(q.get('sizes') === '0' ? { showPreviewSizes: false } : {})}
    {...(tabs ? { documentTabs: tabs.split(',') as ('content' | 'preview' | 'text')[] } : {})}
  />,
);
