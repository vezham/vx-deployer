const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { isAbsolute, join, resolve } = require('node:path')
const { test } = require('node:test')
const { resolvePackagePath } = require('./resolve-package-path.cjs')

test('relative package path resolves using pnpm/action-setup workspace join', () => {
  const workspace = '/home/runner/work/vx-fe-deployer/vx-fe-deployer'
  const relativePath = resolvePackagePath(workspace)
  assert.equal(isAbsolute(relativePath), false)
  assert.equal(
    join(workspace, relativePath),
    resolve(__dirname, '../package.json')
  )
})

test('missing workspace fails explicitly', () => {
  assert.throws(() => resolvePackagePath(''), /GITHUB_WORKSPACE/)
})

test('CLI resolves a downloaded action outside the checked-out repository', t => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'vx-pnpm-action-path-')))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const action = join(
    root,
    '_actions/vezham/vx-deployer/timeline/.github/actions/deployment/resolve-web-app'
  )
  mkdirSync(join(action, 'bin'), { recursive: true })
  cpSync(
    join(__dirname, 'resolve-package-path.cjs'),
    join(action, 'bin/resolve-package-path.cjs')
  )
  const workspace = join(root, 'vx-fe-deployer/vx-fe-deployer')
  mkdirSync(workspace, { recursive: true })
  const output = join(root, 'output')
  execFileSync(
    process.execPath,
    [join(action, 'bin/resolve-package-path.cjs')],
    {
      env: {
        ...process.env,
        GITHUB_WORKSPACE: workspace,
        GITHUB_OUTPUT: output
      }
    }
  )
  const relativePath = readFileSync(output, 'utf8')
    .trim()
    .slice('package_json_file='.length)
  assert.equal(join(workspace, relativePath), join(action, 'package.json'))
  assert.notEqual(
    join(workspace, join(action, 'package.json')),
    join(action, 'package.json')
  )
})
