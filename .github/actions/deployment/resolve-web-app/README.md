# Resolve web app settings

Reads the common `.github/config/web-apps.yaml` registry at an explicit repository
and ref. `APP` selects one app and its environment profile; `CATEGORY` lists enabled
apps for a scheduled workflow matrix. Matrix outputs stay JSON for GitHub Actions'
`fromJSON` expressions.

The parser preserves numeric and boolean values, supports comments and aliases,
and rejects duplicate keys, malformed YAML and multiple documents. The registry
must be a schema-1 mapping with `defaults` and `apps`. Unknown app IDs or invalid
settings fail before deployment; registry API errors do not substitute defaults.

The parser uses YAML's JSON scalar schema so values match the previous JSON
registry. Use lowercase `true`/`false` for booleans. Shared defaults and per-app
`environments` overrides are resolved by this action. Node runtime selection is
handled after source checkout by `common/setup-install`, using the app or workspace
`package.json`; the registry does not provide a Node version.

## Parser maintenance

`js-yaml` is an action-local dependency, pinned to **5.4.3** in `package.json`
and `pnpm-lock.yaml`. The composite action sets up the pnpm version declared by
its own `packageManager` field, then invokes `bin/setup.sh` before loading the
JavaScript resolver.

The shell script selects its action directory regardless of the caller's working
directory and runs a frozen install with lifecycle scripts disabled.
`--ignore-workspace` keeps the resolver independent of parent workspace settings
and the source application's package manager and build install.

To update the parser, select an explicit version, update the dependency and lockfile
in this action directory, then run the resolver tests. Commit both manifests;
`--frozen-lockfile` fails when they disagree. The parser loads through
`require('js-yaml')`.

## Verification

```sh
bash .github/actions/deployment/resolve-web-app/bin/setup.sh
node --test .github/actions/deployment/resolve-web-app/bin/main.test.cjs
```

## Promotion dropdown generation

`bin/sync-choices.cjs` uses this parser and resolver to generate the enabled app
choices for promotion workflows. See `../sync-promote-choices/README.md` for
the shared action and local regeneration commands.
