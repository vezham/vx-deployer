# Prepare a web deployment

This shared action selects `timeline` for TVA, validates a full SHA for manual
promotion, or reads the latest successful Production SHA from the deployment
journal for a scheduled rebuild. It reuses source authentication and the existing
promotion-order validator. No successful Production history returns an empty
`git_ref` so the caller skips deployment. API failures fail the action.

Call this action inside the same app/environment concurrency lock as the build
and deployment. The lock must cover journal selection so an older scheduled
selection cannot overwrite a newer manual promotion.

The action exposes only the selected branch/SHA. Its temporary source token stays
within the action; the build job obtains a separate token. The central registry
and caller live in `vx-fe-deployer`, while the shared execution workflow lives
at `vx-deployer/.github/workflows/web-app.yml`.

The registry resolver and source selection tests run together:

```sh
node --test .github/actions/deployment/resolve-web-app/bin/main.test.cjs
```

`PROMOTION_PATH` accepts the JSON array resolved from the app registry. It is
forwarded to promotion validation for both manual and scheduled deployments;
omission keeps the full order. The validator requires success in the preceding
included stage for the same app and SHA.

## Production targets and app settings

`PRODUCTION_TARGET` selects an app-specific Production destination. Single Production
uses `default`; named-only registry maps require an explicit target. Targets are rejected
for non-Production deployments. The promotion prerequisite is still the preceding stage
in that app's `promotion_path`, for the same source SHA. The journal resolves a separate
latest successful SHA for each Production target.

The resolver merges `values` and `secret_values` from defaults,
app, default environment, app environment and target, in that order. It outputs public
values and secret names, never secret contents. `deployments` contains `{app, target}`
pairs for category scheduling. See the controller registry README for configuration.
