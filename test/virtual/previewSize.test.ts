import { describe, expect, it } from 'vitest';
import { pickPreviewSize } from '../../src/react/previewSize';

const all = ['small', 'medium', 'large'];
describe('pickPreviewSize', () => {
  it.each([
    [all, 260, 1, 'small'],
    [all, 260, 2, 'medium'],
    [all, 40, 2, 'small'],
    [['medium'], 40, 1, 'medium'],
    [[], 260, 1, null],
    [[], 900, 2, null],
    [all, 900, 2, 'large'],
    [['small', 'medium'], 900, 2, 'medium'],
    [['small', 'large'], 260, 2, 'large'],
  ])('(%j, %d, %d) => %s', (avail, w, dpr, want) => {
    expect(pickPreviewSize(w, dpr, avail as string[])).toBe(want);
  });
  it('allowLarge false caps at medium', () => {
    expect(pickPreviewSize(900, 2, all, { allowLarge: false })).toBe('medium');
  });
});
