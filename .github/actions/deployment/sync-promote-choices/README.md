# Sync promotion app choices

Generates the `APP` dropdown in a checked-out promotion workflow from enabled
entries across every category group in `web-apps.yaml`. App IDs are sorted,
duplicate IDs across groups are rejected, and every promotion profile is
validated using the shared registry resolver. The generator changes only the
marked app-choice block and fails for an empty enabled app list.

The composite action shares the adjacent `resolve-web-app` action's pinned pnpm
installation and parser dependency. GitHub downloads the action repository,
including that sibling directory. No source app dependency install is required.

```yaml
- uses: actions/checkout@v4
- uses: vezham/vx-deployer/.github/actions/deployment/sync-promote-choices@timeline
  with:
    MODE: check
```

`MODE: check` (default) fails if choices are stale without changing files.
`MODE: write` updates the marked block; the caller must commit that workflow
change. This action does not push commits or trigger deployments.

For local generation, using a sibling `vx-deployer` checkout:

```sh
bash ../vx-deployer/.github/actions/deployment/resolve-web-app/bin/setup.sh
node ../vx-deployer/.github/actions/deployment/resolve-web-app/bin/sync-choices.cjs \
  .github/config/web-apps.yaml .github/workflows/promote.yml write
```

Commit the regenerated workflow with the registry change. GitHub's dispatch form
reads these committed choices; it cannot populate a dropdown at run time.

```sh
node --test .github/actions/deployment/resolve-web-app/bin/sync-choices.test.cjs
```

The action resolves its package manifest relative to `GITHUB_WORKSPACE` before
calling `pnpm/action-setup`, whose `package_json_file` input is joined to that
workspace path. This also works when the downloaded action is outside the checkout.

Dropdown generation validates only the promotion destinations included in each
app’s optional `promotion_path`; malformed paths fail generation.
