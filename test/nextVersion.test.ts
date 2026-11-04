import { describe, expect, it } from 'vitest';
import { commitLevel, nextVersion } from '../scripts/next-version.mjs';

const run = (latestTag: string | null, packageVersion: string, commits: string[]): string | null =>
  nextVersion({ latestTag, packageVersion, commits });

describe('commitLevel', () => {
  it('reads conventional markers on any line, not branch names', () => {
    expect(commitLevel('feat: add x')).toBe('minor');
    expect(commitLevel('feat(react): add x')).toBe('minor');
    expect(commitLevel('Merge pull request #1 from o/feat/x\n\nfeat: add x')).toBe('minor');
    expect(commitLevel('Merge pull request #1 from o/feat/x\n\nAdd the thing')).toBe('patch');
    expect(commitLevel('fix: y')).toBe('patch');
    expect(commitLevel('refactor!: y')).toBe('major');
    expect(commitLevel('feat(api)!: y')).toBe('major');
    expect(commitLevel('fix: y\n\nBREAKING CHANGE: z')).toBe('major');
  });
});

describe('nextVersion', () => {
  it('patch for ordinary commits', () => {
    expect(run('0.5.0', '0.5.0', ['Fix the thing', 'fix: other'])).toBe('0.5.1');
  });
  it('minor for feat', () => {
    expect(run('0.5.1', '0.5.0', ['Fix', 'feat(react): new'])).toBe('0.6.0');
  });
  it('major for breaking changes', () => {
    expect(run('0.5.1', '0.5.0', ['feat: a', 'fix!: b'])).toBe('1.0.0');
    expect(run('1.2.3', '1.2.3', ['x\n\nBREAKING CHANGE: gone'])).toBe('2.0.0');
  });
  it('null when there are no commits since the tag', () => {
    expect(run('0.5.0', '0.5.0', [])).toBeNull();
  });
  it('null when every commit is [skip release]', () => {
    expect(run('0.5.0', '0.5.0', ['docs [skip release]'])).toBeNull();
  });
  it('releases package.json exactly when it is above the latest tag', () => {
    expect(run('0.5.0', '0.6.0', ['Fix'])).toBe('0.6.0');
    expect(run('0.5.0', '1.0.0', ['feat: a'])).toBe('1.0.0');
  });
  it('releases the package.json version when there is no tag', () => {
    expect(run(null, '0.1.0', ['anything'])).toBe('0.1.0');
  });
});
