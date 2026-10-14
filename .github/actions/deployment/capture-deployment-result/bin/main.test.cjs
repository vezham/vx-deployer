const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, readFileSync, readdirSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { captureResult } = require('./main.cjs')
test('public result transport includes URLs and identity without credentials or build secrets', t => {
  const directory = mkdtempSync(join(tmpdir(), 'vx-result-test-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const outputs = {}
  const env = {
    RUNNER_TEMP: directory,
    SOURCE_REPO: 'example/apps',
    SOURCE_SHA: 'a'.repeat(40),
    DEPLOYMENT_APP: 'demo',
    DEPLOYMENT_CATEGORY: 'apps',
    TARGET_ENV: 'production',
    PRODUCTION_TARGET: 'us',
    DEPLOYMENT_STATUS: 'success',
    FINISHED_AT: '2026-10-14T01:00:00Z',
    STARTED_AT: '2026-10-14T00:59:00Z',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SERVER_URL: 'https://github.com',
    PREVIEW_URL: 'https://demo-us.web.app',
    LIVE_URL: 'https://demo.web.app',
    GCP_SA_KEY: 'sensitive key',
    BUILD_SECRETS: 'sensitive bundle'
  }
  const context = {
    repo: { owner: 'example', repo: 'deployer' },
    runId: 1,
    actor: 'tester',
    eventName: 'schedule'
  }
  captureResult({
    context,
    env,
    core: {
      setOutput: (key, value) => {
        outputs[key] = value
      }
    }
  })
  const text = readFileSync(join(outputs.path, 'result.json'), 'utf8'),
    record = JSON.parse(text)
  assert.equal(record.live_url, 'https://demo.web.app/')
  assert.equal(record.production_target, 'us')
  assert.equal(record.run_attempt, 1)
  assert.equal(record.sha, 'a'.repeat(40))
  assert.equal(text.includes('sensitive'), false)
  assert.deepEqual(readdirSync(outputs.path), ['result.json'])
  assert(outputs.name.startsWith('result-demo-'))
})
