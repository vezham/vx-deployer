const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  ensureMonthlyJournal,
  getMonthlyJournal,
  findHistoryRecord,
  historyBody,
  recordMonth
} = require('./monthly.cjs')
const target = { owner: 'example', repo: 'deployer' }
const fixture = () => {
  const issues = [],
    calls = [],
    labels = new Set()
  const github = {
    rest: {
      issues: {
        listForRepo: async params => {
          calls.push(['list', params])
          return {
            data: issues
              .filter(
                issue =>
                  issue.labels.includes(params.labels) &&
                  (params.state === 'all' || issue.state === params.state)
              )
              .map(issue => ({ ...issue }))
          }
        },
        getLabel: async ({ name }) => {
          if (!labels.has(name)) throw { status: 404 }
          return { data: { name } }
        },
        createLabel: async ({ name }) => {
          labels.add(name)
          return { data: { name } }
        },
        create: async params => {
          calls.push(['create', params])
          const issue = {
            ...params,
            number: issues.length + 1,
            html_url: `https://github.com/example/deployer/issues/${issues.length + 1}`,
            user: { type: 'Bot' },
            state: 'open',
            comments: 0
          }
          issues.push(issue)
          return { data: { ...issue } }
        },
        update: async params => {
          calls.push(['update', params])
          Object.assign(
            issues.find(issue => issue.number === params.issue_number),
            params
          )
          return { data: {} }
        },
        get: async ({ issue_number }) => ({
          data: { ...issues.find(issue => issue.number === issue_number) }
        })
      }
    },
    paginate: async (method, params) => (await method(params)).data
  }
  const prepare = (category, finished_at) =>
    ensureMonthlyJournal({ github, target, record: { category, finished_at } })
  return { github, issues, calls, prepare }
}
test('category monthly issue is reused by all apps and normal lookup does not create or scan unrelated issues', async () => {
  const f = fixture()
  const first = await f.prepare('cdns', '2026-10-14T00:00:00Z')
  f.calls.length = 0
  const second = await f.prepare('cdns', '2026-10-30T00:00:00Z')
  assert.equal(first.number, second.number)
  assert.equal(f.issues.length, 1)
  assert.deepEqual(
    f.calls.map(call => call[0]),
    ['list']
  )
  assert.equal(f.calls[0][1].labels, 'deployment-history:cdns')
  assert.equal(f.calls[0][1].since, '2026-10-01T00:00:00Z')
})
test('rotation closes older category months, preserves another category and permits backfilled closed months', async () => {
  const f = fixture()
  await f.prepare('cdns', '2026-10-31T23:59:59Z')
  await f.prepare('widgets', '2026-10-31T23:59:59Z')
  await f.prepare('cdns', '2026-11-01T00:00:00Z')
  assert.equal(f.issues[0].state, 'closed')
  assert.equal(f.issues[1].state, 'open')
  assert.equal(f.issues[2].state, 'open')
  const old = await f.prepare('cdns', '2026-10-14T00:00:00Z')
  assert.equal(old.number, 1)
  assert.equal(old.state, 'closed')
  assert.equal(f.issues[2].state, 'open')
  await f.prepare('cdns', '2026-09-30T23:59:59Z')
  assert.equal(f.issues[3].state, 'closed')
  assert.equal(f.issues[2].state, 'open')
})
test('completion timestamp determines the UTC month, including year rollover', () => {
  assert.equal(recordMonth({ finished_at: '2027-01-01T00:00:00Z' }), '2027-01')
  assert.equal(recordMonth({ finished_at: '2026-12-31T23:59:59Z' }), '2026-12')
})
test('prepared monthly issue must match category/month and be a bot-owned issue', async () => {
  const f = fixture()
  await f.prepare('cdns', '2026-10-14T00:00:00Z')
  const record = { category: 'cdns', finished_at: '2026-10-14T00:00:00Z' }
  assert.equal(
    (await getMonthlyJournal({ github: f.github, target, number: 1, record }))
      .number,
    1
  )
  for (const invalid of [
    { ...record, category: 'widgets' },
    { ...record, finished_at: '2026-11-01T00:00:00Z' }
  ])
    await assert.rejects(
      getMonthlyJournal({
        github: f.github,
        target,
        number: 1,
        record: invalid
      }),
      /does not match/
    )
  f.issues[0].user.type = 'User'
  await assert.rejects(
    getMonthlyJournal({ github: f.github, target, number: 1, record }),
    /does not match/
  )
})
test('pending recovery searches older monthly pages after other apps append more than 100 entries', async () => {
  const record = { event_id: 'pending' },
    pages = []
  const github = {
    rest: {
      issues: {
        listComments: async ({ page }) => {
          pages.push(page)
          return {
            data:
              page === 1
                ? [{ id: 1, user: { type: 'Bot' }, body: 'pending' }]
                : [{ id: page, user: { type: 'Bot' }, body: 'other' }]
          }
        }
      }
    }
  }
  const journal = { number: 1, comments: 250 },
    parseRecord = item => ({ event_id: item.body })
  assert.equal(
    await findHistoryRecord({ github, target, journal, record, parseRecord }),
    undefined
  )
  assert.deepEqual(pages, [3])
  pages.length = 0
  assert.equal(
    (
      await findHistoryRecord({
        github,
        target,
        journal,
        record,
        parseRecord,
        recover: true
      })
    ).id,
    1
  )
  assert.deepEqual(pages, [3, 2, 1])
})
test('permission failures do not create unlabelled or duplicate monthly issues', async () => {
  const f = fixture()
  f.github.rest.issues.getLabel = async () => {
    throw { status: 403 }
  }
  await assert.rejects(
    f.prepare('cdns', '2026-10-14T00:00:00Z'),
    error => error.status === 403
  )
  assert.equal(f.issues.length, 0)
})
test('history rendering clearly identifies the category and excludes source TVA', () => {
  assert.match(historyBody('cdns', '2026-10'), /cdns/)
  assert.match(historyBody('cdns', '2026-10'), /TVA remains on source commits/)
})

test('rotation resumes after issue creation succeeds but closing the old month is interrupted', async () => {
  const f = fixture()
  await f.prepare('cdns', '2026-10-14T00:00:00Z')
  const update = f.github.rest.issues.update
  f.github.rest.issues.update = async params => {
    if (params.issue_number === 1 && params.state === 'closed')
      throw new Error('rotation interrupted')
    return update(params)
  }
  await assert.rejects(
    f.prepare('cdns', '2026-11-01T00:00:00Z'),
    /rotation interrupted/
  )
  assert.equal(f.issues.length, 2)
  assert.equal(f.issues[0].state, 'open')
  f.github.rest.issues.update = update
  const recovered = await f.prepare('cdns', '2026-11-01T00:00:00Z')
  assert.equal(recovered.number, 2)
  assert.equal(f.issues.length, 2)
  assert.equal(f.issues[0].state, 'closed')
  assert.match(f.issues[1].body, /vx-monthly-rotation-complete/)
})
