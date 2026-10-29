/** Columns that fit in `width` px for cards at least `minCard` wide with `gap` between; at least 1. */
export function gridColumns(width: number, minCard: number, gap: number): number {
  if (!Number.isFinite(width) || width <= 0) return 1;
  return Math.max(1, Math.floor((width + gap) / (minCard + gap)));
}
