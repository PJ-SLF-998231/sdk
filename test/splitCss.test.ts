import { describe, expect, it } from 'vitest';
import { requiredClasses, scanSource, specificity, splitCss } from '../scripts/split-css.mjs';

const files: Record<string, string> = {
  'src/styles/styles.css': '.shelf-sdk { --bg: #fff; }\n',
  'src/styles/fonts.css': '@font-face {\n  font-family: "Shelf Geist";\n  src: url("./fonts/g.woff2") format("woff2");\n}\n',
  'src/styles/base.css': '.shelf-sdk { color: var(--fg); }\n.shelf-sdk h3 { margin: 0; }\n',
  'src/styles/view.css':
    '.shelf-sdk .shelf-sdk__a { padding: 4px; }\n.shelf-sdk .shelf-sdk__b { color: red; }\n.shelf-sdk .shelf-sdk__c { padding: 8px; }\n' +
    '@keyframes shelf-sdk-spin { to { opacity: 0; } }\n.shelf-sdk .shelf-sdk__d { animation: shelf-sdk-spin 1s; }\n@media (max-width: 1px) {\n  .shelf-sdk .shelf-sdk__a { padding: 0; }\n}\n',
  'src/styles/extras.css': '.shelf-sdk .shelf-sdk__b { color: blue; }\n',
  'src/one.tsx': "export const One = () => <div className={cx('a', 'b')} />;\n",
  'src/two.tsx': "export const Two = () => <div className={cx('c', `d`)} />;\n",
  'src/three.tsx': "export const Three = () => <div className={cx('a', 'c')} />;\n",
  'src/bad.tsx': "export const Bad = () => <div className={cx('nope')} />;\n",
};
const mf = (inputs: Record<string, string[]>) => ({ inputs: Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, { imports: v.map((p) => ({ path: p })) }])) });
const run = (entries: Array<{ out: string; module: string; subpath: string; css: { file: string } | null }>, extra: Record<string, string> = {}) =>
  splitCss({ entries, metafile: mf({ 'src/one.tsx': [], 'src/two.tsx': [], 'src/three.tsx': [], 'src/bad.tsx': [] }), read: (f: string) => ({ ...files, ...extra })[f] ?? '' });

describe('split-css helpers', () => {
  it('computes specificity', () => {
    expect(specificity('.shelf-sdk .shelf-sdk__a')).toEqual([0, 2, 0]);
    expect(specificity('.shelf-sdk button:disabled')).toEqual([0, 2, 1]);
    expect(specificity('.shelf-sdk .shelf-sdk__a::before')).toEqual([0, 2, 1]);
    expect(specificity('.shelf-sdk a:not(.shelf-sdk__x)')).toEqual([0, 2, 1]);
  });
  it('does not require classes inside :not()', () => {
    expect([...requiredClasses('.a:not(.b) .c')].sort()).toEqual(['a', 'c']);
  });
  it('reads classes from cx calls, templates and skips comparisons', () => {
    const s = scanSource("cx('a b', on && `pill--${tone}`, x === 'pending' ? 'ok' : null)");
    expect([...s.literals].sort()).toEqual(['a', 'b', 'ok']);
    expect(s.patterns.some((re: RegExp) => re.test('pill--busy'))).toBe(true);
    expect(s.groups).toHaveLength(1);
  });
});

describe('splitCss', () => {
  const e1 = { out: 'one', module: 'src/one.tsx', subpath: './one', css: { file: 'css/one.css' } };
  const e2 = { out: 'two', module: 'src/two.tsx', subpath: './two', css: { file: 'css/two.css' } };
  const e3 = { out: 'three', module: 'src/three.tsx', subpath: './three', css: { file: 'css/three.css' } };

  it('writes core.css with fonts resolved from dist/css and an entry file that repeats it', () => {
    const { files: out } = run([e1]);
    expect(out['css/core.css']).toContain('url("../fonts/g.woff2")');
    expect(out['css/core.css']).not.toContain('__a');
    expect(out['css/one.css']).toContain(out['css/core.css']!.split('*/\n')[1]!.trim().slice(0, 40));
  });

  it('keeps only the rules of the classes an entry renders, in source order, with its media variants', () => {
    const css = run([e1]).files['css/one.css']!;
    expect(css).toContain('__a');
    expect(css).toContain('@media (max-width: 1px)');
    expect(css).not.toContain('__c');
    expect(css.indexOf('color: red')).toBeLessThan(css.indexOf('color: blue')); // extras after view
  });

  it('pulls a conflicting equal-specificity rule into every file that holds its partner', () => {
    // a and c both set padding at (0,2,0) and meet in three.tsx: one without c would let c win or lose by load order
    const css = run([e1, e2, e3]).files['css/one.css']!;
    expect(css).toContain('__c');
  });

  it('includes the keyframes an included rule uses', () => {
    expect(run([e2]).files['css/two.css']).toContain('@keyframes shelf-sdk-spin');
  });

  it('is deterministic', () => {
    expect(run([e1, e2, e3]).files).toEqual(run([e1, e2, e3]).files);
  });

  it('fails the build on a class no rule styles', () => {
    expect(() => run([{ out: 'bad', module: 'src/bad.tsx', subpath: './bad', css: { file: 'css/bad.css' } }])).toThrow(/"nope"/);
  });

  it('fails when a core rule ties with a class rule', () => {
    expect(() => run([e1], { 'src/styles/base.css': '.shelf-sdk :focus-visible { padding: 1px; }\n' })).toThrow(/core rule/);
  });
});
