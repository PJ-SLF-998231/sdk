// Decides the next release version from the latest v* tag, the package.json version and the commits since the tag.
// Used by .github/workflows/release.yaml. Plain node, no dependencies.
//
//   node scripts/next-version.mjs             prints the version to release, or nothing when there is nothing to release
//   node scripts/next-version.mjs --dry-run   prints the same decision with the reasoning
//
// Rules: `BREAKING CHANGE` or `type!:` on any line of a commit message -> major; `feat:` / `feat(scope):` -> minor;
// anything else -> patch. A package.json version above the latest tag is released exactly as written (manual
// major/minor control). No commits since the tag -> nothing. A commit with `[skip release]` is not counted.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(v) {
  const m = SEMVER.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

function compare(a, b) {
  const x = parse(a);
  const y = parse(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

/** 'major' | 'minor' | 'patch' for one commit message (subject + body). */
export function commitLevel(message) {
  let level = 'patch';
  for (const raw of String(message).split('\n')) {
    const line = raw.trim();
    if (/^BREAKING[ -]CHANGE\b/.test(line) || /^[a-z]+(\([^)]*\))?!:/i.test(line)) return 'major';
    if (/^feat(\([^)]*\))?:/i.test(line)) level = 'minor';
  }
  return level;
}

export function isSkipped(message) {
  return /\[skip release\]/i.test(message);
}

/**
 * @param {{ latestTag: string | null, packageVersion: string, commits: string[] }} input
 *   latestTag is the version of the latest release tag without the leading v (or null), commits are the full messages since it.
 * @returns {string | null} the version to release, or null when there is nothing to release
 */
export function nextVersion({ latestTag, packageVersion, commits }) {
  if (!parse(packageVersion)) throw new Error(`package.json version is not x.y.z: ${packageVersion}`);
  if (latestTag == null) return packageVersion;
  if (!parse(latestTag)) throw new Error(`latest tag is not x.y.z: ${latestTag}`);
  const counted = commits.filter((c) => !isSkipped(c));
  if (counted.length === 0) return null;
  if (compare(packageVersion, latestTag) > 0) return packageVersion;
  let level = 'patch';
  for (const c of counted) {
    const l = commitLevel(c);
    if (l === 'major') {
      level = 'major';
      break;
    }
    if (l === 'minor') level = 'minor';
  }
  const [maj, min, pat] = parse(latestTag);
  if (level === 'major') return `${maj + 1}.0.0`;
  if (level === 'minor') return `${maj}.${min + 1}.0`;
  return `${maj}.${min}.${pat + 1}`;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function readState() {
  const tags = git('tag', '--merged', 'HEAD', '--list', 'v*')
    .split('\n')
    .filter((t) => /^v\d+\.\d+\.\d+$/.test(t))
    .map((t) => t.slice(1))
    .sort(compare);
  const latestTag = tags.length ? tags[tags.length - 1] : null;
  const range = latestTag ? [`v${latestTag}..HEAD`] : ['HEAD'];
  const commits = git('log', '--format=%B%x00', ...range)
    .split('\0')
    .map((c) => c.trim())
    .filter(Boolean);
  const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
  return { latestTag, packageVersion, commits };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const state = readState();
  const version = nextVersion(state);
  if (process.argv.includes('--dry-run')) {
    const counted = state.commits.filter((c) => !isSkipped(c));
    console.log(`latest tag:       ${state.latestTag ? `v${state.latestTag}` : '(none)'}`);
    console.log(`package.json:     ${state.packageVersion}`);
    console.log(`commits since:    ${state.commits.length} (${state.commits.length - counted.length} skipped by [skip release])`);
    for (const c of counted) console.log(`  ${commitLevel(c).padEnd(5)} ${c.split('\n')[0]}`);
    console.log(`decision:         ${version ? `release ${version}` : 'nothing to release'}`);
  } else if (version) {
    console.log(version);
  }
}
