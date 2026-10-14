const assert = require('node:assert/strict')
const { test } = require('node:test')
const { mkdtempSync, readFileSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { main, renderReports } = require('./render.cjs')

const metadata = {
  now: '2026-10-15 05:00:00 UTC',
  serverUrl: 'https://github.com',
  repository: 'vezham/app',
  runId: '13',
  runAttempt: '2',
  job: 'audit'
}
const report = (score, overrides = {}) => ({
  tool: 'fallow',
  completed: true,
  score,
  minimumScore: 90,
  healthScore: 55,
  summary: { total_issues: 3, unused_files: 2, unused_exports: 1 },
  ...overrides
})

test('a completed audit below the threshold is Failed rather than advisory or Passed', () => {
  const { comments } = renderReports([report(70)], metadata)
  assert.match(comments.fallow, /🔴 Failed/)
  assert.match(comments.fallow, /70\/100/)
  assert.match(comments.fallow, /90\/100/)
  assert.match(comments.fallow, /QA audit gate fails/)
  assert.doesNotMatch(comments.fallow, /advisory|Completed\.|🟢 Passed/)
})

test('threshold equality passes and overall health stays informational', () => {
  const { comments } = renderReports([report(90)], metadata)
  assert.match(comments.fallow, /🟢 Passed/)
  assert.match(comments.fallow, /Overall health \(informational\) \| 55\/100/)
})

test('the runner recorded threshold controls the displayed gate', () => {
  const { comments } = renderReports(
    [report(92, { minimumScore: 95 })],
    metadata
  )
  assert.match(comments.fallow, /🔴 Failed/)
  assert.match(comments.fallow, /Required minimum \| 95\/100/)
})

for (const score of [null, undefined, '95', 101, -1, NaN, Infinity]) {
  test(`unavailable or invalid score ${String(score)} cannot render Passed`, () => {
    const { comments } = renderReports([report(score)], metadata)
    assert.match(comments.fallow, /⚠️ Unavailable/)
    assert.match(comments.fallow, /QA audit gate cannot pass/)
    assert.doesNotMatch(comments.fallow, /🟢 Passed/)
  })
}

test('incomplete audits cannot pass even if a score is present', () => {
  assert.match(
    renderReports([report(100, { completed: false })], metadata).comments
      .fallow,
    /⚠️ Unavailable/
  )
})

test('tools retain separate bodies and React Doctor counts', () => {
  const result = renderReports(
    [
      report(70),
      report(100, {
        tool: 'react-doctor',
        summary: { errorCount: 0, warningCount: 1, affectedFileCount: 1 }
      })
    ],
    metadata
  )
  assert.match(result.comments.fallow, /🔴 Failed/)
  assert.match(result.comments['react-doctor'], /🟢 Passed/)
  assert.match(result.comments['react-doctor'], /Warnings \| 1/)
  assert.match(result.comments.fallow, /2026-10-15 05:00:00 UTC/)
  assert.match(result.comments.fallow, /runs\/13\/attempts\/2/)
  assert.match(result.comments.fallow, /Attempt 2/)
})

for (const content of [null, '{broken', '{}', '[]']) {
  test(`missing or malformed report ${String(content)} produces both unavailable summaries`, t => {
    const directory = mkdtempSync(join(tmpdir(), 'vx-audit-render-'))
    t.after(() => rmSync(directory, { recursive: true, force: true }))
    const reportPath = join(directory, 'report.json')
    if (content !== null) writeFileSync(reportPath, content)
    const markdown = join(directory, 'summary.md')
    const outputs = join(directory, 'outputs')
    const job = join(directory, 'job.md')
    main({
      AUDIT_REPORT: reportPath,
      AUDIT_MARKDOWN: markdown,
      GITHUB_OUTPUT: outputs,
      GITHUB_STEP_SUMMARY: job,
      GITHUB_SERVER_URL: metadata.serverUrl,
      GITHUB_REPOSITORY: metadata.repository,
      GITHUB_RUN_ID: metadata.runId,
      GITHUB_RUN_ATTEMPT: metadata.runAttempt,
      GITHUB_JOB: metadata.job
    })
    for (const tool of ['fallow', 'react-doctor'])
      assert.match(
        readFileSync(`${markdown}.${tool}.md`, 'utf8'),
        /⚠️ Unavailable/
      )
    assert.match(readFileSync(outputs, 'utf8'), /fallow_path=/)
    assert.match(readFileSync(outputs, 'utf8'), /react_doctor_path=/)
    assert.equal(readFileSync(job, 'utf8'), readFileSync(markdown, 'utf8'))
  })
}
