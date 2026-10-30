import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** The 0.3 ShelfFolder DOM snapshots (BASELINE_SHA a92752b), as one string; a component's markup must appear in it verbatim. */
export const baselineSnap = readFileSync(resolve(process.cwd(), 'test/snapshots/__snapshots__/shelfFolder.baseline.test.tsx.snap'), 'utf8');

/** The markup normalisation of the baseline test: form-control ids replaced, one element per line. */
export const normalise = (html: string) =>
  html.replace(/(id|for|aria-controls|aria-labelledby|aria-describedby)="[^"]*:r[0-9a-z]+:[^"]*"/g, '$1="<id>"').replace(/></g, '>\n<');

/** The snapshot's block named `name` (between its export line and the next one). */
export function baselineBlock(name: string): string {
  const start = baselineSnap.indexOf(`baseline markup > ${name} 1\`] = \``);
  if (start < 0) throw new Error(`no baseline snapshot named ${name}`);
  const next = baselineSnap.indexOf('\nexports[', start);
  return baselineSnap.slice(start, next < 0 ? undefined : next);
}
