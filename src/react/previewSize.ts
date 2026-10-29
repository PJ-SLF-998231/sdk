import type { PreviewSize } from '../types';

const ORDER: readonly PreviewSize[] = ['small', 'medium', 'large'];

/**
 * The preview size to fetch for a box `cssWidth` CSS px wide on a screen with `dpr` device pixels per CSS px:
 * device px <= 360 wants small, <= 800 medium, more large. If that size is not available the nearest one is
 * used (ties go to the larger, sharper one). Null when nothing usable is available.
 * `allowLarge: false` caps the answer at medium (the document view passes true / nothing).
 */
export function pickPreviewSize(
  cssWidth: number,
  dpr: number,
  available: readonly string[],
  opts?: { allowLarge?: boolean },
): PreviewSize | null {
  const have = ORDER.map((s, i) => ({ s, i })).filter(({ s }) => available.includes(s));
  if (have.length === 0) return null;
  const px = cssWidth * (dpr > 0 ? dpr : 1);
  let want = px <= 360 ? 0 : px <= 800 ? 1 : 2;
  if (opts?.allowLarge === false) want = Math.min(want, 1);
  let best = have[0]!;
  for (const h of have) {
    const d = Math.abs(h.i - want);
    const bd = Math.abs(best.i - want);
    if (d < bd || (d === bd && h.i > best.i)) best = h;
  }
  return best.s;
}
