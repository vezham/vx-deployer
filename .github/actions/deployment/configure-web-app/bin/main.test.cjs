const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  statSync,
  rmSync,
  symlinkSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { configureWebApp } = require('./main.cjs')
const fixture = t => {
  const workspace = mkdtempSync(join(tmpdir(), 'vx-build-values-'))
  t.after(() => rmSync(workspace, { recursive: true, force: true }))
  mkdirSync(join(workspace, 'apps/test-app'), { recursive: true })
  const exports = {},
    masks = []
  return {
    file: join(workspace, 'apps/test-app/.env'),
    exports,
    masks,
    core: {
      setSecret: value => masks.push(value),
      exportVariable: (key, value) => {
        exports[key] = value
      }
    },
    env: {
      GITHUB_WORKSPACE: workspace,
      APP_PATH: 'apps/test-app',
      APP_NAME: 'test-app',
      SOURCE_SHA: 'a'.repeat(40),
      TRACK_ENV: 'production',
      APP_ENV: 'production',
      RELEASE_CHANNEL: 'stable',
      IS_DEBUG: 'false',
      PRODUCTION_TARGET: 'us'
    }
  }
}
test('build configuration masks referenced secrets, exports literal values and uses actual SHA and target', t => {
  const f = fixture(t)
  writeFileSync(f.file, 'UNCHANGED=original\n', { mode: 0o644 })
  configureWebApp({
    ...f,
    env: {
      ...f.env,
      BUILD_VALUES: JSON.stringify({
        API_URL: 'https://us.example',
        FEATURE: false,
        COUNT: 3,
        MULTILINE: 'line1\nline2',
        QUOTES: 'one\'two"three'
      }),
      BUILD_SECRET_VALUES: '{"API_KEY":"US_KEY"}',
      AVAILABLE_SECRETS:
        '{"US_KEY":"test-sensitive-value","UNUSED_KEY":"unused"}'
    }
  })
  assert.deepEqual(f.masks, ['test-sensitive-value'])
  assert.equal(f.exports.API_KEY, 'test-sensitive-value')
  assert.equal(f.exports.DX_APP_URL, 'test-app-production-us-aaaaaaa')
  assert.equal(f.exports.V_PRODUCTION_TARGET, 'us')
  assert.equal(f.exports.FEATURE, 'false')
  assert.equal(f.exports.MULTILINE, 'line1\nline2')
  assert.match(readFileSync(f.file, 'utf8'), /UNCHANGED=original/)
  assert.equal(statSync(f.file).mode & 0o777, 0o600)
  assert.equal(Object.hasOwn(f.exports, 'UNUSED_KEY'), false)
})
test('missing referenced secret fails before writing configuration or exporting variables', t => {
  const f = fixture(t)
  writeFileSync(f.file, 'UNCHANGED=original\n')
  assert.throws(
    () =>
      configureWebApp({
        ...f,
        env: { ...f.env, BUILD_SECRET_VALUES: '{"API_KEY":"MISSING_KEY"}' }
      }),
    /Required build secret is missing/
  )
  assert.deepEqual(f.exports, {})
  assert.equal(readFileSync(f.file, 'utf8'), 'UNCHANGED=original\n')
})
test('long app and target IDs retain distinct preview channels within Firebase length limits', t => {
  const f = fixture(t),
    targets = ['u'.repeat(70), 'u'.repeat(69) + 's'],
    channels = []
  for (const target of targets) {
    configureWebApp({
      ...f,
      env: {
        ...f.env,
        PRODUCTION_TARGET: target,
        APP_NAME: 'app-' + 'a'.repeat(70)
      }
    })
    channels.push(f.exports.DX_APP_URL)
  }
  assert.ok(channels.every(channel => channel.length <= 63))
  assert.notEqual(channels[0], channels[1])
})
test('symlinked env files are rejected without overwriting their destination', t => {
  const f = fixture(t),
    other = join(f.env.GITHUB_WORKSPACE, 'other.env')
  writeFileSync(other, 'original')
  symlinkSync(other, f.file)
  assert.throws(() => configureWebApp(f), /symlinked/)
  assert.equal(readFileSync(other, 'utf8'), 'original')
})
