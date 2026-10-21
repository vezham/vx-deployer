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

test('missing declarations leave version selection to the action fallback and ignore lockfile engines', t => {
  const input = fixture(t, {}, {})
  writeFileSync(
    join(input.workspace, 'pnpm-lock.yaml'),
    "lockfileVersion: '9.0'\npackages:\n  dependency@1.0.0:\n    engines: {node: '>=22'}\n"
  )
  assert.equal(resolveNodeVersionFile(input), '')
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

for (const root of [
  { engines: { node: '22.x' } },
  { volta: { node: '24.10.0' } }
]) {
  test(`a caller without APP_PATH reads its root runtime ${JSON.stringify(root)}`, t => {
    const { workspace } = fixture(t, {}, root)
    assert.equal(resolveNodeVersionFile({ workspace }), 'package.json')
  })
}

test('a caller without APP_PATH or a runtime permits the action fallback', t => {
  const { workspace } = fixture(t, {}, {})
  assert.equal(resolveNodeVersionFile({ workspace }), '')
})

for (const requirement of ['', ' ', 24, null, '24.x\nother']) {
  test(`invalid root declaration ${JSON.stringify(requirement)} fails instead of falling back`, t => {
    const { workspace } = fixture(t, {}, { engines: { node: requirement } })
    assert.throws(
      () => resolveNodeVersionFile({ workspace }),
      /Invalid Node runtime declaration/
    )
  })
}

test('malformed root manifest fails instead of falling back', t => {
  const { workspace } = fixture(t)
  writeFileSync(join(workspace, 'package.json'), '{')
  assert.throws(() => resolveNodeVersionFile({ workspace }), SyntaxError)
})

test('root-only resolution does not require an app manifest', t => {
  const { workspace } = fixture(t)
  rmSync(join(workspace, 'apps'), { recursive: true, force: true })
  assert.equal(resolveNodeVersionFile({ workspace }), 'package.json')
})

test('CLI emits an empty version file when a legacy caller needs the action fallback', t => {
  const input = fixture(t, {}, {})
  const output = join(input.workspace, 'output.txt')
  const stdout = execFileSync(
    process.execPath,
    [join(__dirname, 'runtime.cjs')],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_WORKSPACE: input.workspace,
        SOURCE_APP_PATH: '',
        GITHUB_OUTPUT: output
      }
    }
  )
  assert.equal(readFileSync(output, 'utf8'), 'node_version_file=\n')
  assert.match(stdout, /Node 24 compatibility fallback/)
})
