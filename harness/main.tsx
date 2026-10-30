import { createRoot } from 'react-dom/client';
import { ShelfFolder } from '../dist/react/index.js';

const q = new URLSearchParams(location.search);
// No ?theme= means the prop is not passed at all, so the component's own default is what is tested.
const cacheScope = q.get('cacheScope') || undefined;
const root = createRoot(document.getElementById('root')!);
// perf.mjs measures from this mark to the first painted document card.
performance.mark('sdk-mount');
root.render(
  <ShelfFolder baseUrl={q.get('api') || '/api/shelf'} {...(q.get('theme') ? { theme: q.get('theme') as 'light' | 'dark' | 'auto' } : {})} {...(cacheScope ? { cacheScope } : {})} />,
);
