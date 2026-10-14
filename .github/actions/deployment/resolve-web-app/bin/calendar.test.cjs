const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  resolveSchedule,
  calendarDate,
  selectDueDeployments,
  readRunTimestamp
} = require('./calendar.cjs')
const defaults = { frequency: 'weekly', days: ['mon', 'thu', 'sat'] }
const apps = {
  inherited: {},
  daily: { schedule: { frequency: 'daily' } },
  weekly: { schedule: { frequency: 'weekly', days: ['wed'] } },
  monthly: { schedule: { frequency: 'monthly', day: 1 } },
  disabled: { schedule: { enabled: false } }
}
const deployments = Object.keys(apps).flatMap(app =>
  ['us', 'eu'].map(target => ({ app, target, category: 'apps' }))
)
const selected = timestamp =>
  selectDueDeployments({ defaults, apps, deployments, timestamp }).deployments

test('Wednesday IST selects daily and overridden weekly cadence for every regional target', () => {
  const rows = selected('2026-10-13T23:30:00Z')
  assert.deepEqual([...new Set(rows.map(row => row.app))], ['daily', 'weekly'])
  assert.equal(rows.length, 4)
  assert.equal(calendarDate('2026-10-13T23:30:00Z').date, '2026-10-14')
})
test('Monday IST preserves the existing inherited cadence and disables only scheduled builds', () => {
  assert.deepEqual(
    [...new Set(selected('2026-10-18T23:30:00Z').map(row => row.app))],
    ['inherited', 'daily']
  )
})
test('monthly cadence follows the local calendar across month and year boundaries', () => {
  assert(selected('2026-10-31T23:30:00Z').some(row => row.app === 'monthly'))
  assert(selected('2026-12-31T23:30:00Z').some(row => row.app === 'monthly'))
  assert(!selected('2026-11-01T23:30:00Z').some(row => row.app === 'monthly'))
})
test('month-end rules skip short months, including leap-year handling', () => {
  const select = (day, timestamp) =>
    selectDueDeployments({
      defaults,
      apps: { demo: { schedule: { frequency: 'monthly', day } } },
      deployments: [{ app: 'demo', target: 'default', category: 'apps' }],
      timestamp
    }).deployments.length
  assert.equal(select(31, '2026-04-29T23:30:00Z'), 0)
  assert.equal(select(31, '2026-05-30T23:30:00Z'), 1)
  assert.equal(select(29, '2028-02-28T23:30:00Z'), 1)
  assert.equal(select(29, '2027-02-27T23:30:00Z'), 0)
})
test('cadence replacement drops fields from the default; enabled flag inherits independently', () => {
  assert.deepEqual(resolveSchedule(defaults, { frequency: 'daily' }), {
    enabled: true,
    frequency: 'daily'
  })
  assert.deepEqual(resolveSchedule(defaults, { enabled: false }), {
    ...defaults,
    enabled: false
  })
  assert.equal(
    resolveSchedule(
      { ...defaults, enabled: false },
      { frequency: 'monthly', day: 1 }
    ).enabled,
    false
  )
  assert.equal(
    resolveSchedule({ ...defaults, enabled: false }, { enabled: true }).enabled,
    true
  )
})
for (const invalid of [
  null,
  [],
  {},
  { enabled: 'false' },
  { frequency: 'hourly' },
  { frequency: 'daily', day: 1 },
  { frequency: 'daily', days: ['mon'] },
  { frequency: 'weekly' },
  { frequency: 'weekly', days: [] },
  { frequency: 'weekly', days: ['mon', 'mon'] },
  { frequency: 'weekly', days: ['monday'] },
  { frequency: 'weekly', days: ['mon'], day: 1 },
  { frequency: 'monthly' },
  { frequency: 'monthly', day: 0 },
  { frequency: 'monthly', day: 32 },
  { frequency: 'monthly', day: '1' },
  { frequency: 'monthly', day: 1.5 },
  { enabled: false, unknown: true }
])
  test('invalid schedule rejected: ' + JSON.stringify(invalid), () =>
    assert.throws(() => resolveSchedule(defaults, invalid), /Schedule|schedule/)
  )
test('empty due selection is valid and original deployment list is preserved', () => {
  const original = structuredClone(deployments)
  const result = selectDueDeployments({
    defaults,
    apps: {
      ...apps,
      daily: { schedule: { enabled: false } },
      weekly: { schedule: { enabled: false } }
    },
    deployments,
    timestamp: '2026-10-13T23:30:00Z'
  })
  assert.deepEqual(result.deployments, [])
  assert.deepEqual(deployments, original)
})
test('workflow creation timestamp remains stable across delayed execution and reruns', async () => {
  let request
  const env = { GITHUB_REPOSITORY: 'example/deployer', GITHUB_RUN_ID: '123' }
  const github = {
    rest: {
      actions: {
        getWorkflowRun: async args => {
          request = args
          return {
            data: {
              created_at: '2026-10-13T23:30:00Z',
              run_started_at: '2026-10-15T23:30:00Z'
            }
          }
        }
      }
    }
  }
  const timestamp = await readRunTimestamp({ github, env })
  assert.equal(calendarDate(timestamp).date, '2026-10-14')
  assert.deepEqual(request, { owner: 'example', repo: 'deployer', run_id: 123 })
})
test('invalid timestamps and invalid run identity cannot silently select a different date', async () => {
  for (const timestamp of ['', null, 'tomorrow', '2026-10-14'])
    assert.throws(() => calendarDate(timestamp), /timestamp/)
  await assert.rejects(
    readRunTimestamp({
      github: {},
      env: { GITHUB_REPOSITORY: '../repo', GITHUB_RUN_ID: '123' }
    }),
    /repository/
  )
  await assert.rejects(
    readRunTimestamp({
      github: {},
      env: { GITHUB_REPOSITORY: 'example/repo', GITHUB_RUN_ID: '0' }
    }),
    /run ID/
  )
})
