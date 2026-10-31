# Working notes

- Work happens on a branch and lands through a pull request. Never push to `main`.
- Every PR must pass CI (`ci.yml`: typecheck, test, build and the checks below; `gitleaks.yml`) before merge.
- Releases: bump `version` in `package.json`, merge, then push a tag `vX.Y.Z` equal to it; `release.yaml` publishes to GitHub Packages. Do not publish from a laptop. Add the version's entry to `CHANGELOG.md` in the same PR as the bump.
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
