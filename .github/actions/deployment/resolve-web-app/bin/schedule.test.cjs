const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  buildBatches,
  validateBatch,
  discoverJournalIssues
} = require('./schedule.cjs')
const targets = ['au', 'eu', 'in', 'sg', 'us']
const deployments = () =>
  Array.from({ length: 150 }, (_, i) =>
    targets.map(target => ({
      app: `app-${i}`,
      target,
      category: 'apps',
      journal_issue: String(i + 1)
    }))
  ).flat()
test('150 apps and 750 targets become eight batches with no duplicates or omissions', () => {
  const input = deployments(),
    batches = buildBatches(input)
  assert.equal(batches.length, 8)
  assert.deepEqual(
    batches.map(b => b.count),
    [100, 100, 100, 100, 100, 100, 100, 50]
  )
  assert.deepEqual(
    batches.flatMap(b => validateBatch(b.deployments)),
    input
  )
  assert(batches.every(b => b.count <= 100))
})
test('empty discovery skips all batches', () =>
  assert.deepEqual(buildBatches([]), []))
for (const invalid of [
  [],
  Array(101).fill({ app: 'demo', target: 'us', category: 'apps' }),
  [{ app: 'demo', target: '../us', category: 'apps' }],
  [{ app: 'demo', target: 'us', category: 'apps', journal_issue: '0' }],
  [
    { app: 'demo', target: 'us', category: 'apps' },
    { app: 'demo', target: 'us', category: 'apps' }
  ]
])
  test(
    'invalid scheduled batch fails before deployment: ' + invalid.length,
    () => assert.throws(() => validateBatch(invalid))
  )
test('duplicate targets across batch boundaries are rejected', () => {
  const rows = Array.from({ length: 101 }, (_, i) => ({
    app: `app-${i}`,
    target: 'default',
    category: 'apps'
  }))
  rows[100] = rows[0]
  assert.throws(() => buildBatches(rows), /Duplicate/)
})
test('batch-count and output budgets fail explicitly before publishing matrix output', () => {
  assert.throws(() => buildBatches(Array(25601)), /256-batch/)
  const rows = Array.from({ length: 1000 }, (_, i) => ({
    app: `app-${i}-` + 'a'.repeat(1000),
    target: 'default',
    category: 'apps'
  }))
  assert.throws(() => buildBatches(rows), /output budget/)
})
test('journal discovery scans issues once and attaches the canonical app journal for every region', async () => {
  let calls = 0
  const apps = Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [
      `app-${i}`,
      { repository: `example/repo-${i}` }
    ])
  )
  const issues = Object.keys(apps).map((app, i) => ({
    number: i + 1,
    body: `<!-- vx-deployment-journal:${apps[app].repository}:${app} -->`
  }))
  issues.push({ ...issues[0], number: 999 })
  const github = {
    rest: { issues: { listForRepo: {} } },
    paginate: async () => {
      calls++
      return issues
    }
  }
  const rows = await discoverJournalIssues({
    github,
    journalRepository: 'example/deployer',
    deployments: deployments(),
    apps
  })
  assert.equal(calls, 1)
  assert.equal(rows.length, 750)
  assert(
    rows
      .filter(row => row.app === 'app-0')
      .every(row => row.journal_issue === '1')
  )
})
test('unrecorded apps, pull requests and journals for a different source cannot select a SHA', async () => {
  const github = {
    rest: { issues: { listForRepo: {} } },
    paginate: async () => [
      { number: 1, body: '<!-- vx-deployment-journal:other/source:demo -->' },
      {
        number: 2,
        pull_request: {},
        body: '<!-- vx-deployment-journal:example/source:demo -->'
      }
    ]
  }
  assert.deepEqual(
    await discoverJournalIssues({
      github,
      journalRepository: 'example/deployer',
      deployments: [{ app: 'demo', target: 'default', category: 'apps' }],
      apps: { demo: { repository: 'example/source' } }
    }),
    []
  )
})
