import { describe, expect, it } from 'vitest';
import { partyId, shortLabel, subItemId, timelineOrder, TOC_MAX_SUBHEADINGS, tocEntries } from '../../src/docsite/toc';
import receipt from '../fixtures/site-receipt.json';

const spec = (...blocks: object[]) => ({ version: 1, blocks });

describe('tocEntries', () => {
  it('numbers the receipt like a book: sections, subheadings and right-hand values', () => {
    const toc = tocEntries(receipt);
    expect(toc.map((s) => [s.number, s.title, s.id, s.value])).toEqual([
      ['1', 'Key facts', 'site-key-facts', undefined],
      ['2', 'Total', 'site-amount', 'EUR 12.40'],
      ['3', 'Parties', 'site-parties', undefined],
      ['4', 'Timeline', 'site-timeline', undefined],
      ['5', 'Items', 'site-table', undefined],
      ['6', 'Source', 'site-source', undefined],
    ]);
    expect(toc[0]!.subheadings).toEqual([
      { number: '1.1', title: 'Receipt number', id: 'site-key-facts-1' },
      { number: '1.2', title: 'Paid with', id: 'site-key-facts-2' },
      { number: '1.3', title: 'Place', id: 'site-key-facts-3' }, // the stored entities block, folded into key facts
    ]);
    expect(toc[1]!.subheadings).toEqual([
      { number: '2.1', title: 'Subtotal', id: 'site-amount-1', value: 'EUR 10.42' },
      { number: '2.2', title: 'VAT 19%', id: 'site-amount-2', value: 'EUR 1.98' },
    ]);
    expect(toc[2]!.subheadings).toEqual([{ number: '3.1', title: 'Corner Cafe', id: 'site-parties-from', value: 'From' }]);
    expect(toc[3]!.subheadings.map((s) => [s.title, s.value])).toEqual([
      ['Purchased', '30 Sep 2026'],
      ['Statement month', 'Oct 2026'],
    ]);
    // tables and the source have no subheadings
    expect(toc[4]!.subheadings).toEqual([]);
    expect(toc.every((s) => s.more === 0)).toBe(true);
  });

  it('lists at most TOC_MAX_SUBHEADINGS and counts the rest as more', () => {
    const items = Array.from({ length: TOC_MAX_SUBHEADINGS + 3 }, (_, i) => ({ label: `Fact ${i + 1}`, value: String(i) }));
    const [facts] = tocEntries(spec({ type: 'key_facts', props: { items } }));
    expect(facts!.subheadings).toHaveLength(TOC_MAX_SUBHEADINGS);
    expect(facts!.subheadings.at(-1)!.number).toBe(`1.${TOC_MAX_SUBHEADINGS}`);
    expect(facts!.more).toBe(3);
  });

  it('a sub-item title wins over the derived label', () => {
    const [facts] = tocEntries(
      spec({ type: 'key_facts', props: { items: [{ label: 'Nr', value: '1', title: 'Receipt no.' }, { label: 'Paid', value: 'x' }] } }),
    );
    expect(facts!.subheadings.map((s) => s.title)).toEqual(['Receipt no.', 'Paid']);
  });

  it('adds the source footer only when asked or when the spec has a source block', () => {
    const facts = { type: 'key_facts', props: { items: [{ label: 'A', value: '1' }] } };
    expect(tocEntries(spec(facts)).map((s) => s.id)).toEqual(['site-key-facts']);
    expect(tocEntries(spec(facts), { footer: true }).map((s) => s.id)).toEqual(['site-key-facts', 'site-source']);
    expect(tocEntries(spec(facts), { idPrefix: 'p' }).map((s) => s.id)).toEqual(['p-key-facts']);
  });

  it('leaves out what is not a valid spec', () => {
    expect(tocEntries(null)).toEqual([]);
    expect(tocEntries({ version: 1, blocks: [{ type: 'nope', props: {} }] })).toEqual([]);
  });
});

describe('helpers', () => {
  it('subItemId and partyId', () => {
    expect(subItemId('site-key-facts', 2)).toBe('site-key-facts-2');
    expect(partyId('site-parties', 'to')).toBe('site-parties-to');
  });

  it('timelineOrder sorts by date and keeps the spec order on ties', () => {
    const items = [{ date: '2026-03-01', k: 'b' }, { date: '2026-01-01', k: 'a' }, { date: '2026-03-01', k: 'c' }];
    expect(timelineOrder(items).map((i) => i.k)).toEqual(['a', 'b', 'c']);
    expect(items.map((i) => i.k)).toEqual(['b', 'a', 'c']); // not sorted in place
  });

  it('shortLabel collapses whitespace and cuts at a word with an ellipsis', () => {
    expect(shortLabel('  a   b  ')).toBe('a b');
    expect(shortLabel('one two three four', 10)).toBe('one two…');
    expect(shortLabel('abcdefghijklmnop', 10)).toBe('abcdefghi…');
    expect(shortLabel('alpha, beta gamma', 8)).toBe('alpha…');
  });
});
