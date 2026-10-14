# Resolve web app settings

Reads the common `.github/config/web-apps.yaml` registry at an explicit repository
and ref. `APP` selects one app and its environment profile; `CATEGORY` lists enabled
apps for a scheduled workflow matrix; `ALL_APPS: true` discovers every category.
Choose exactly one selector. Matrix outputs stay JSON for GitHub Actions'
`fromJSON` expressions.

The parser preserves numeric and boolean values, supports comments and aliases,
and rejects duplicate keys, malformed YAML and multiple documents. The registry
uses `schema: 2`, shared `defaults` and top-level groups (`apps`, `apps-cdns`,
`apps-internals`, `apps-platforms`, `apps-pods`, `apps-suites`, `apps-widgets`).
Categories are derived from these keys; entries omit `category`. IDs must be
unique across groups, including disabled entries. Unknown app IDs or invalid
settings fail before deployment; registry API errors do not substitute defaults.
The grouped `schema: 2` format is the baseline. Other registry versions are rejected.

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

The action resolves its package manifest relative to `GITHUB_WORKSPACE` before
calling `pnpm/action-setup`, whose `package_json_file` input is joined to that
workspace path. This also works when the downloaded action is outside the checkout.

Apps may set `promotion_path` to an ordered subset beginning with `tva` and
ending with `production`. Omission uses the full order. The resolver rejects
omitted destinations and emits the effective path as JSON for source validation.

## Production targets and app settings

`PRODUCTION_TARGET` selects an app-specific Production destination. Single Production
uses `default`; named-only registry maps require an explicit target. Targets are rejected
for non-Production deployments. The promotion prerequisite is still the preceding stage
in that app's `promotion_path`, for the same source SHA. The journal resolves a separate
latest successful SHA for each Production target.

The resolver merges `values` and `secret_values` from defaults,
app, default environment, app environment and target, in that order. It outputs public
values and secret names, never secret contents. `deployments` contains `{app, target, category}`
pairs for category scheduling. See the controller registry README for configuration.

## TVA caller repository

For automatic TVA builds, this action derives the source repository from the caller's
`github.repository` context. The caller still passes only `APP` and `CALLER`.
Forks can reuse an app ID and TVA profile; each build checks out its own repository
and records statuses and comments there. Each calling repository supplies its own
Actions secrets under the configured credential and build-secret names.

The registry `repository` continues to select the source for manual promotions
and scheduled Production rebuilds. TVA caller identity cannot redirect a promotion.
The allowed TVA branches and app paths are unchanged.

## Unified scheduled discovery

Use `ALL_APPS: 'true'` without `APP` or `CATEGORY` to build one matrix across all
registry groups, including `apps`. Disabled entries are excluded. Each app expands
into its default or named Production targets. The matrix records category metadata
for display while the shared deployment flow still locks and reads history per app
and Production target. Empty discovery returns `[]` so the caller can skip deployment.

## Bounded scheduled batches

`batches` contains up to 100 targets per batch, with category labels and serialized
`deployments` for the common worker. With `JOURNAL_REPO`, discovery reads the issue
directory once and includes only apps with a canonical journal. Every region gets
that app's known `journal_issue`; final source selection still happens under the
app/target deployment lock. No journal means the app waits for another run.

Batch count and output size are checked before publishing outputs. Normal app and
TVA resolution do not query the journal. API quota errors wait for reset/retry-after
with bounded retries; permission failures propagate immediately.

## Calendar filtering

`SCHEDULED_ONLY: 'true'` applies per-app `schedule` rules during `ALL_APPS` or
`CATEGORY` discovery. `defaults.schedule` is required in this mode; app overrides
replace cadence fields and inherit the enabled flag independently. Daily, weekly
(lowercase weekday lists) and monthly (day 1–31) rules are supported. Invalid rules
fail registry parsing, including when a rule is disabled. Disabled schedules do not
remove apps from normal discovery, TVA resolution or manual promotion.

The resolver reads the current run's `created_at` using the caller's Actions read
permission, and converts it to `Asia/Kolkata`. Manual dispatch and reruns use that
same original run date. Filtering happens before journal lookup and batch creation;
all Production targets of a due app are included. Monthly dates missing from a
month are skipped. There is no missed-run catch-up. Without `SCHEDULED_ONLY`, app
resolution and unfiltered registry discovery keep their existing behavior.

## Manual promotion target planning

With `APP`, `APP_ENV` and `EXPAND_PROMOTION_TARGETS: 'true'`, the action emits
`promotion_targets`, a JSON array for the manual dispatcher matrix. Empty
`PRODUCTION_TARGET` in Production selects every configured target, including an
explicit `default` when present; an app without a target map selects `default` once.
An explicit target selects only that destination. Non-Production selects one empty
target and rejects region inputs.

All selected profiles validate before outputs are emitted. Planning rejects unknown
or disabled apps, invalid/missing target settings, skipped promotion stages and more
than 256 targets. It does not perform schedule filtering or bypass promotion-source
validation. The per-target deployment workflow still verifies the SHA and prerequisite
stage before building. Ordinary single-app resolution remains strict and expects a
specific target for named-only Production maps; the dispatcher passes those resolved
targets explicitly. Do not combine expansion with TVA `CALLER` or scheduled discovery.
