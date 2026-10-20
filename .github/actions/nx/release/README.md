# Nx release

Runs the caller's `@vx:@vx-ws/release` target through pnpm. The caller owns
versioning, builds, changelogs, and package selection; this action forwards release
options and publishing credentials.

## Caller requirements

- Check out the source with release tags and full history. Attach a branch when
  the release runner commits and pushes changes.
- Set up Node.js, pnpm, dependencies, npm registry authentication, and Git identity
  before invoking this action. The shared `setup-install-npm` action supplies this
  setup.
- Provide the `@vx:@vx-ws/release` target and its supported release options.
- For provenance, use a GitHub-hosted runner, grant `id-token: write`, and publish
  from a public source repository. Each package's `repository` metadata must match
  that repository, including case. See [npm's provenance requirements](https://docs.npmjs.com/generating-provenance-statements/).
- When publishing through pnpm 12, pin 12.14.0 or newer. Native provenance config
  support was verified with 12.14.0; 12.3.4 ignores the publish setting and can
  publish without provenance. The action does not check or upgrade pnpm.

## Inputs

| Input            | Required | Default | Purpose                                                                                                                                                         |
| ---------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GITHUB_TOKEN`   | Yes      |         | GitHub credentials for the release runner.                                                                                                                      |
| `NPM_TOKEN`      | Yes      |         | Passed as `NODE_AUTH_TOKEN` for configured registry authentication.                                                                                             |
| `NPM_PROVENANCE` | No       | `true`  | Requests or disables provenance through publisher configuration.                                                                                                |
| `version`        | No       | Empty   | Explicit version or increment; empty delegates version selection to the runner.                                                                                 |
| `args`           | No       | Empty   | Whitespace-separated `firstRelease`, `dryRun`, or `verbose` flags, including supported aliases and boolean values. Other options and shell syntax are rejected. |

After checkout and runtime setup, a caller can preview a release with:

```yaml
permissions:
  contents: write
  id-token: write

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      # Checkout and setup steps go here.
      - uses: vezham/vx-deployer/.github/actions/nx/release@timeline
        with:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.VX_DEPLOYER_NPM }}
          NPM_PROVENANCE: true
          args: --dryRun
```

## Provenance behavior

The action maps `NPM_PROVENANCE` to both `NPM_CONFIG_PROVENANCE` for npm-compatible
publishers and `PNPM_CONFIG_PROVENANCE` for pnpm. pnpm 12.14.0 reads the latter
natively when publishing, including an explicit `false`.

Nx's default inferred publish target can be used without a PATH adapter or
package-specific publisher. The release runner and publisher remain responsible
for honoring dry-run and publish options and returning failures. A nonzero release
command exit fails this action. Setting the environment variables requests
provenance; it does not independently verify that a published package has it.

## Validation

From the vx-deployer repository root, run:

```sh
node --test .github/actions/nx/release/bin/provenance.test.cjs
```

These tests use a stub publisher to check provenance `true` and `false`, argument
forwarding, invalid-option rejection, and failure propagation. They do not contact
npm or generate an attestation.

A successful release dry run confirms command wiring but does not generate an
attestation. After a real publish, inspect the exact published version:

```sh
npm view @scope/package@1.2.3 dist.attestations --json
```

Confirm the provenance entry and its linked source and workflow on npm. Registry
signatures alone do not establish build provenance.
