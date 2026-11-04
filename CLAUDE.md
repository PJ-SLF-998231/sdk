# Working notes

- Work happens on a branch and lands through a pull request. Never push to `main`.
- Every PR must pass CI (`ci.yml`: typecheck, test, build and the checks below; `gitleaks.yml`) before merge.
- Releases are automatic: a merge to `main` that touches publishable files runs `release.yaml` (CI gate, then publish to npmjs.org, then tag `vX.Y.Z` and a GitHub release with generated notes). The version is computed by `scripts/next-version.mjs` from the commits since the latest tag (`BREAKING CHANGE` or `type!:` major, `feat:` minor, otherwise patch); `package.json` `version` is a floor, not the source of the published version: raise it above the latest tag to force a version. Do not tag by hand and do not publish from a laptop. A `CHANGELOG.md` entry is optional, for notable changes (GitHub release notes are generated); `[skip release]` in a commit message opts it out.
- Never commit secrets or tokens (a folder key is `shelf_ik_...`; README examples read it from the environment).
- Never raise a size budget in `scripts/entries.mjs` without a comment giving the reason, and never weaken a check to get a PR green.
- The proxy recipe in `README.md` ("Server-side proxy recipe") is the same as `sdk-react-native`'s; change both together.

Checks, as CI runs them (`npm ci` first; the `check:*` scripts that read `dist` need `npm run build`):

```sh
npm run typecheck
npm test
npm run build
npm run check:dist
node scripts/check-css.mjs
npm run check:entries      # entry boundaries
npm run check:imports
npm run size               # scripts/size-budget.mjs: the per-entry gzip size budgets
node scripts/size-report.mjs
npm run check:example      # examples/folder-card-only
npm run check:docs         # check:tokens (README token table) and check:readme (README snippets type-check against dist)
npm run check:treeshake
npm run check:package      # attw and publint
npm run check:types        # test/types/bundler and test/types/node16
npm pack --dry-run
```
