import { describe, expect, it } from 'vitest';
import { isAboveToc, MIN_TOC_SECTIONS, siteSections, tocSections } from '../../src/docsite/sections';
import { prepareSite, type Block } from '../../src/docsite/spec';
import receipt from '../fixtures/site-receipt.json';

const blocks = (...b: object[]) => b as unknown as Block[];
const table = { type: 'table', props: { columns: ['A'], rows: [['1']] } };

describe('siteSections', () => {
  it('the receipt: one section per drawn block, in layout order, with stable slugs', () => {
    const { blocks: prepared } = prepareSite(receipt);
    const sections = siteSections(prepared, { footer: true });
    expect(sections.map((s) => [s.id, s.title])).toEqual([
      ['site-summary', 'Summary'],
      ['site-key-facts', 'Key facts'],
      ['site-amount', 'Total'],
      ['site-parties', 'Parties'],
      ['site-timeline', 'Timeline'],
      ['site-table', 'Items'],
      ['site-source', 'Source'],
    ]);
    // the source footer carries the source block it draws
    expect(sections.at(-1)!.block?.type).toBe('source');
  });

  it('leaves out the hero and the source block, and adds the footer only when it is drawn', () => {
    const b = blocks({ type: 'hero', props: { title: 'T' } }, { type: 'source', props: {} });
    expect(siteSections(b, { footer: false })).toEqual([]);
    expect(siteSections(b, { footer: true })).toEqual([{ id: 'site-source', title: 'Source', block: b[1] }]);
  });

  it('a footer without a source block (only the original link) has no block', () => {
    expect(siteSections([], { footer: true })).toEqual([{ id: 'site-source', title: 'Source', block: undefined }]);
  });

  it('numbers tables only when there is more than one', () => {
    expect(siteSections(blocks(table), { footer: false }).map((s) => [s.id, s.title])).toEqual([['site-table', 'Items']]);
    expect(siteSections(blocks(table, table, table), { footer: false }).map((s) => [s.id, s.title])).toEqual([
      ['site-table-1', 'Items 1 of 3'],
      ['site-table-2', 'Items 2 of 3'],
      ['site-table-3', 'Items 3 of 3'],
    ]);
  });

  it('takes the amount heading from its label and honours idPrefix', () => {
    const b = blocks({ type: 'amount', props: { label: 'Balance due', value: '1' } });
    expect(siteSections(b, { footer: true, idPrefix: 'doc2' }).map((s) => [s.id, s.title])).toEqual([
      ['doc2-amount', 'Balance due'],
      ['doc2-source', 'Source'],
    ]);
  });
});

describe('tocSections', () => {
  it('lists everything but the summary, which is drawn above it', () => {
    const sections = siteSections(prepareSite(receipt).blocks, { footer: true });
    const toc = tocSections(sections);
    expect(toc.map((s) => s.id)).not.toContain('site-summary');
    expect(toc).toHaveLength(sections.length - 1);
    expect(sections.filter(isAboveToc).map((s) => s.id)).toEqual(['site-summary']);
  });

  it('MIN_TOC_SECTIONS is three', () => {
    expect(MIN_TOC_SECTIONS).toBe(3);
  });
});
