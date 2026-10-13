# Validate promotion

Validates a full source SHA, destination and a successful prerequisite deployment
of the same app and SHA. `PROMOTION_PATH` is an optional JSON array; omission
retains `tva → dev → qa → preview → production`.

The path must start with `tva`, end with `production`, and contain a unique,
ordered subset of the standard stages. Examples:

- `["tva","preview","production"]`: Preview requires TVA; Production requires Preview.
- `["tva","production"]`: Production requires TVA.

Destinations omitted from a path are rejected before API access. The validator
resolves the requested SHA in the source repository and reads statuses on that
commit, accepting only a success in `vx-promotion/<app>/<preceding stage>`.
GitHub API failures propagate. The run summary records the configured path and
links to the prerequisite deployment. Skipped stages are not marked as deployed.

The central registry resolver reads each app's `promotion_path` and passes its
JSON representation through source preparation to this action. This applies to
manual promotion and scheduled Production rebuilds.

```sh
node --test .github/actions/deployment/validate-promotion/bin/policy.test.cjs \
  .github/actions/deployment/validate-promotion/bin/main.test.cjs
```
