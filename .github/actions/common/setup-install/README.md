# Setup Node.js and pnpm

For shared web deployments, pass `APP_PATH` after checking out the source commit.
The action reads `<APP_PATH>/package.json` first and falls back to the source
workspace root’s `package.json` when no app runtime is declared. It passes the
selected file to `actions/setup-node@v4` via `node-version-file`, using
`volta.node` before `engines.node`. Version ranges are preserved; pin an exact
version in the source manifest when required. Missing or malformed declarations
fail explicitly; dependency engine constraints in the lockfile do not select a
project runtime.

pnpm uses the existing package-manager setup and installs committed dependencies
with `--frozen-lockfile`. Callers without `APP_PATH` keep their existing
`NODE_VERSION` override, matrix version or Node 22 fallback.

## Verification

```sh
node --test .github/actions/common/setup-install/bin/runtime.test.cjs
```
