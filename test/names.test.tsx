// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { DocumentCard } from '../src/react/DocumentCard';
import { DocumentRow } from '../src/react/DocumentRow';
import { ShelfFolder } from '../src/react';
import type { ThumbLoader } from '../src/internal/contracts';
import type { ShelfClient, ShelfItem } from '../src';

// jsdom does no layout, so these tests pin the markup the wrapping CSS hangs on and the CSS rules themselves;
// harness/wrap.mjs measures the real layout in Chromium (1280/900/375 px, plain and hostile host).
afterEach(cleanup);

const UNBROKEN = 'Stellenbosch_Wedding_Colour_and_Style_Guide_White_Background_Final_Approved_Revision_Seven.pdf';
const SPACED = 'Quarterly review of the Stellenbosch wedding venue shortlist and catering quotes for the October event.pdf';
const loader: ThumbLoader = { load: async () => null, peek: () => null, dispose: () => {} };
const noop = () => {};
const item = (filename: string): ShelfItem => ({
  id: 'f1', filename, content_type: 'application/pdf', size_bytes: 2048, folder_id: 'root', parse_status: 'parsed',
  created_at: '2026-01-02T00:00:00Z', edited_at: null, parsed_at: null, preview_sizes: [],
});

const css = readFileSync(resolve(process.cwd(), 'src/styles/extras.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
/** Declarations of every rule in extras.css whose selector list contains `sel`. */
const decls = (sel: string): string =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(',').some((s) => s.trim() === `.shelf-sdk ${sel}`)).map((m) => m[2]).join('\n');

describe('long names: markup', () => {
  it.each([UNBROKEN, SPACED, 'a'.repeat(72) + '.txt'])('card keeps the whole name in the name element: %s', (name) => {
    const { container } = render(<DocumentCard item={item(name)} view="gallery" loader={loader} onOpen={noop} />);
    const h3 = container.querySelector('.shelf-sdk__file-card-name')!;
    expect(h3.textContent).toBe(name);
    expect(h3.querySelector('button.shelf-sdk__file-card-link')).toBeTruthy();
    expect(container.querySelector('.shelf-sdk__file-card-body')).toBeTruthy();
  });
  it.each([UNBROKEN, SPACED])('row has a name text span inside the name button: %s', (name) => {
    const { container } = render(<table><tbody><DocumentRow item={item(name)} view="list" loader={loader} onOpen={noop} /></tbody></table>);
    const t = container.querySelector('.shelf-sdk__item-name .shelf-sdk__item-name-text')!;
    expect(t.textContent).toBe(name);
  });
});

describe('long names: the folder view', () => {
  it.each([UNBROKEN.replace('.pdf', ''), SPACED.replace('.pdf', '')])('folder card and crumb carry %s', async (name) => {
    const client = {
      info: async () => ({ access: 'read' }),
      folders: async () => [{ id: 'root', name, parent_id: null }, { id: 'sub', name, parent_id: 'root' }],
      listFiles: async () => ({ items: [], next_cursor: null }),
      thumbnailUrl: () => '', originalUrl: () => '',
    } as unknown as ShelfClient;
    const { container } = render(<ShelfFolder client={client} />);
    const tile = await vi_waitFor(() => container.querySelector('.shelf-sdk__folder-tile-name'));
    expect(tile.textContent).toBe(name);
    expect(container.querySelector('.shelf-sdk__breadcrumbs .shelf-sdk__breadcrumb')!.textContent).toBe(name);
  });
});

async function vi_waitFor<T extends Element>(get: () => T | null): Promise<T> {
  for (let i = 0; i < 100; i++) { const v = get(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error('element never rendered');
}

describe('long names: CSS rules (the same ones as Shelf web)', () => {
  // view.css is generated from web's global.css (scripts/sync-web-css.mjs), extras.css is the SDK's own.
  const view = readFileSync(resolve(process.cwd(), 'src/styles/view.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const viewDecls = (sel: string): string =>
    [...view.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter((m) => m[1]!.split(',').some((x) => x.trim() === `.shelf-sdk ${sel}`)).map((m) => m[2]).join('\n');
  const all = (sel: string) => `${viewDecls(sel)}\n${decls(sel)}`;

  it.each(['.shelf-sdk__file-card-name', '.shelf-sdk__folder-tile-name', '.shelf-sdk__item-name-text', '.shelf-sdk__doc-title .shelf-sdk__section-title', '.shelf-sdk__preview-facts dd'])(
    'names break with overflow-wrap: break-word, as web does: %s', (sel) => {
      expect(viewDecls(sel)).toMatch(/overflow-wrap:\s*break-word/);
    });
  it.each(['.shelf-sdk__folder-tile-main', '.shelf-sdk__folder-tile-text', '.shelf-sdk__item-name'])('flex container %s can shrink (min-width: 0)', (sel) => {
    expect(viewDecls(sel)).toMatch(/min-width:\s*0/);
  });
  it('no name is clamped to a number of lines', () => {
    expect(css).not.toMatch(/line-clamp/);
    expect(view).not.toMatch(/line-clamp/);
  });
  it('the buttons that carry a name break anywhere (a button is an atomic inline: break-word does not shrink it)', () => {
    for (const sel of ['.shelf-sdk__file-card-link', '.shelf-sdk__item-name-text']) expect(decls(sel)).toMatch(/overflow-wrap:\s*anywhere/);
  });
  it('list names wrap: no ellipsis or nowrap on the name cell', () => {
    expect(decls('.shelf-sdk__item-list-fixed td')).not.toMatch(/text-overflow/);
    expect(all('.shelf-sdk__item-name-text')).not.toMatch(/white-space:\s*nowrap/);
  });
  it('crumbs do not wrap a name: nowrap + ellipsis, items may shrink', () => {
    expect(decls('.shelf-sdk__breadcrumb')).toMatch(/text-overflow:\s*ellipsis/);
    expect(decls('.shelf-sdk__breadcrumb')).toMatch(/white-space:\s*nowrap/);
    expect(decls('.shelf-sdk__breadcrumbs li')).toMatch(/min-width:\s*0/);
  });
  it('folder tree names are one line with an ellipsis', () => {
    expect(viewDecls('.shelf-sdk__folder-tree-name')).toMatch(/text-overflow:\s*ellipsis/);
    expect(viewDecls('.shelf-sdk__folder-tree-name')).toMatch(/white-space:\s*nowrap/);
  });
  it('messages that quote a name break', () => {
    expect(decls('.shelf-sdk__dropzone-limits')).toMatch(/overflow-wrap:\s*break-word/);
  });
});
