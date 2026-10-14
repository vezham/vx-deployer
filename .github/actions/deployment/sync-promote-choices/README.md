# Sync promotion app choices

Generates category app dropdowns from enabled entries in `web-apps.yaml` using the
shared resolver. App IDs are sorted, disabled apps are excluded, duplicate IDs across
groups fail, and every enabled promotion stage and Production target is validated.
Only the marked app-choice blocks are generated; workflow dispatch controls remain
committed YAML, since GitHub has no dependent dropdowns.

The category entry workflows use `promote-<category>.yml` and forward all manual
inputs to `./.github/workflows/promote.yml`. The common
`promote.yml` is reusable only and owns target planning and deployment. The
registry group map determines category from `APP`. No category input is forwarded
to the promotion engine; category filtering applies to the generated dropdowns.

```yaml
- uses: actions/checkout@v4
- uses: vezham/vx-deployer/.github/actions/deployment/sync-promote-choices@timeline
  with:
    ALL_CATEGORIES: 'true'
    MODE: check
```

In all-category mode, `WORKFLOW_DIRECTORY` defaults to `.github/workflows`.
Each category with enabled apps must have an entry workflow. Missing workflows,
unknown/empty category workflows, incorrect shared workflow routing and missing input
forwarding fail explicitly. The checker validates every category before writing any
choice block. `promote-check-choices.yml` is excluded from entrypoint discovery.
When a category has no enabled apps, remove its entry workflow until it is needed.

`MODE: check` reports stale choices without writing files. `MODE: write` updates
choice blocks; commit those changes with the registry. This action never commits,
pushes or starts a deployment. The adjacent resolver supplies its pinned parser and
pnpm setup; source app dependency installation is unnecessary.

Regenerate every category locally from `vx-fe-deployer`:

```sh
bash ../vx-deployer/.github/actions/deployment/resolve-web-app/bin/setup.sh
ALL_CATEGORIES=true REGISTRY_PATH=.github/config/web-apps.yaml \
  WORKFLOW_DIRECTORY=.github/workflows MODE=write \
  node ../vx-deployer/.github/actions/deployment/resolve-web-app/bin/sync-choices.cjs
```

To update only one category, use the optional fourth CLI argument:

```sh
node ../vx-deployer/.github/actions/deployment/resolve-web-app/bin/sync-choices.cjs \
  .github/config/web-apps.yaml .github/workflows/promote-cdns.yml write cdns
```

For a single-workflow action call, set `WORKFLOW_PATH` and `CATEGORY`, leaving
`ALL_CATEGORIES: 'false'`. Omit `CATEGORY` only for a separate workflow that intentionally
lists all apps. Single-file mode is independent of the shared workflow routing guard; use
all-category checking in CI. Invalid mode flags and incompatible selectors fail.
