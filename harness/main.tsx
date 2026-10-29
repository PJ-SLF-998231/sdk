import { createRoot } from 'react-dom/client';
import { ShelfFolder } from '../dist/react/index.js';

const q = new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(
  <ShelfFolder baseUrl="/api/shelf" theme={(q.get('theme') as 'light' | 'dark') || 'light'} />,
);
