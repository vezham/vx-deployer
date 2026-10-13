const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const { resolveNodeVersionFile } = require('./runtime.cjs')

const fixture = (t, app = {}, root = { engines: { node: '>=24.x' } }) => {
  const workspace = mkdtempSync(join(tmpdir(), 'vx-node-runtime-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  mkdirSync(join(workspace, 'apps/test'), { recursive: true })
  writeFileSync(join(workspace, 'apps/test/package.json'), JSON.stringify(app))
  writeFileSync(join(workspace, 'package.json'), JSON.stringify(root))
  return { workspace, appPath: 'apps/test' }
}

test('app engines select the app package instead of a different workspace runtime', t => {
  const input = fixture(t, { engines: { node: '22.x' } })
  assert.equal(resolveNodeVersionFile(input), 'apps/test/package.json')
})

test('an app without a runtime inherits the workspace engines', t => {
  const input = fixture(t, { name: 'test', version: '1.0.0' })
  assert.equal(resolveNodeVersionFile(input), 'package.json')
})

test('explicit Volta runtime selects the app manifest', t => {
  assert.equal(
    resolveNodeVersionFile(fixture(t, { volta: { node: '24.10.0' } })),
    'apps/test/package.json'
  )
})

test('workspace Volta runtime is inherited when app has no runtime', t => {
  assert.equal(
    resolveNodeVersionFile(fixture(t, {}, { volta: { node: '24.10.0' } })),
    'package.json'
  )
})

test('missing declarations do not substitute a fixed version or lockfile dependency engines', t => {
  const input = fixture(t, {}, {})
  writeFileSync(
    join(input.workspace, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\npackages:\n  dependency@1.0.0:\n    engines: {node: '>=22'}\n"
  )
  assert.throws(
    () => resolveNodeVersionFile(input),
    /Declare engines.node or volta.node/
  )
})

for (const requirement of ['', ' ', 24, null, '24.x\nother']) {
  test(`invalid app declaration ${JSON.stringify(requirement)} fails before root fallback`, t => {
    assert.throws(
      () =>
        resolveNodeVersionFile(fixture(t, { engines: { node: requirement } })),
      /Invalid Node runtime declaration/
    )
  })
}

test('Volta has precedence over engines when choosing a manifest', t => {
  assert.throws(
    () =>
      resolveNodeVersionFile(
        fixture(t, { volta: { node: 24 }, engines: { node: '24.x' } })
      ),
    /Invalid Node runtime declaration/
  )
})

test('malformed app manifest fails before root fallback', t => {
  const input = fixture(t)
  writeFileSync(join(input.workspace, 'apps/test/package.json'), '{')
  assert.throws(() => resolveNodeVersionFile(input), SyntaxError)
})

test('missing source app manifest fails explicitly', t => {
  const input = fixture(t)
  rmSync(join(input.workspace, 'apps/test/package.json'))
  assert.throws(() => resolveNodeVersionFile(input), /ENOENT/)
})

for (const app of [null, [], 'app']) {
  test(`non-object app manifest ${JSON.stringify(app)} is rejected`, t => {
    assert.throws(
      () => resolveNodeVersionFile(fixture(t, app)),
      /Expected a package.json object/
    )
  })
}

for (const appPath of [
  '../app',
  'apps/../test',
  '/apps/test',
  'apps/./test',
  'apps/test\nother'
]) {
  test(`unsafe path ${JSON.stringify(appPath)} is rejected`, t => {
    assert.throws(
      () => resolveNodeVersionFile({ ...fixture(t), appPath }),
      /relative source app directory/
    )
  })
}

test('CLI emits a version-file output while leaving source engine ranges intact', t => {
  const input = fixture(t)
  const output = join(input.workspace, 'output.txt')
  execFileSync(process.execPath, [join(__dirname, 'runtime.cjs')], {
    env: {
      ...process.env,
      GITHUB_WORKSPACE: input.workspace,
      SOURCE_APP_PATH: input.appPath,
      GITHUB_OUTPUT: output
    }
  })
  assert.equal(readFileSync(output, 'utf8'), 'node_version_file=package.json\n')
  assert.equal(
    JSON.parse(readFileSync(join(input.workspace, 'package.json'), 'utf8'))
      .engines.node,
    '>=24.x'
  )
})
