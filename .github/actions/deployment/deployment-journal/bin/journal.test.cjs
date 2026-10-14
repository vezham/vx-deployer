const { mkdtempSync, writeFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  appendDeployment,
  readLatestDeployment,
  parseRecord,
  issueBody,
  prepareMonthlyJournal
} = require('./journal.cjs')

const fixture = () => {
  let nextIssue = 1,
    nextComment = 1
  const issues = [],
    comments = [],
    outputs = {},
    calls = []
  const context = {
    repo: { owner: 'vezham', repo: 'vx-fe-deployer' },
    runId: 10,
    actor: 'tester',
    eventName: 'workflow_dispatch'
  }
  const env = {
    JOURNAL_REPO: 'vezham/vx-fe-deployer',
    SOURCE_REPO: 'vezham/vx-fe-apps-cdns',
    SOURCE_SHA: 'a'.repeat(40),
    DEPLOYMENT_APP: 'static-cdn',
    DEPLOYMENT_CATEGORY: 'cdns',
    TARGET_ENV: 'production',
    DEPLOYMENT_STATUS: 'success',
    FINISHED_AT: '2026-10-13T05:00:00Z',
    STARTED_AT: '2026-10-13T04:59:00Z',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SERVER_URL: 'https://github.com'
  }
  const clone = value => JSON.parse(JSON.stringify(value))
  const rest = {
    get: async ({ issue_number }) => {
      calls.push(['get', issue_number])
      return {
        data: clone({
          ...issues.find(issue => issue.number === issue_number),
          comments: comments.filter(
            comment => comment.issue_number === issue_number
          ).length
        })
      }
    },
    listForRepo: async params => {
      calls.push(['list', params])
      return {
        data: clone(
          issues
            .filter(
              issue =>
                (!params.labels || issue.labels?.includes(params.labels)) &&
                (params.state === 'all' || issue.state === params.state)
            )
            .map(issue => ({
              ...issue,
              comments: comments.filter(
                comment => comment.issue_number === issue.number
              ).length
            }))
        )
      }
    },
    listComments: async ({ issue_number, page = 1, per_page = 100 }) => {
      const items = comments
        .filter(comment => comment.issue_number === issue_number)
        .slice((page - 1) * per_page, page * per_page)
      calls.push(['read-comments', issue_number, page, items.length])
      return { data: clone(items) }
    },
    getLabel: async () => ({ data: {} }),
    createLabel: async () => ({ data: {} }),
    create: async params => {
      calls.push(['create', params])
      const issue = {
        ...params,
        number: nextIssue++,
        state: 'open',
        user: { type: 'Bot' },
        html_url: `https://github.com/vezham/vx-fe-deployer/issues/${nextIssue - 1}`
      }
      issues.push(issue)
      return { data: clone(issue) }
    },
    createComment: async params => {
      calls.push(['comment', params])
      const comment = {
        ...params,
        id: nextComment++,
        user: { type: 'Bot' },
        html_url: `https://github.com/comment/${nextComment - 1}`
      }
      comments.push(comment)
      return { data: clone(comment) }
    },
    update: async params => {
      calls.push(['update', params])
      Object.assign(
        issues.find(issue => issue.number === params.issue_number),
        params
      )
      return {}
    }
  }
  const github = {
    rest: { issues: rest },
    paginate: async (method, params) => {
      if (method !== rest.listComments) return (await method(params)).data
      const data = []
      for (let page = 1; ; page++) {
        const response = await method({ ...params, page })
        data.push(...response.data)
        if (response.data.length < params.per_page) return data
      }
    }
  }
  const core = {
    setOutput: (name, value) => {
      outputs[name] = value
    }
  }
  const append = async (overrides = {}, id = 10) => {
    const actual = { ...env, ...overrides }
    await prepareMonthlyJournal({
      github,
      core,
      context: { ...context, runId: id },
      env: actual
    })
    return appendDeployment({
      github,
      core,
      context: { ...context, runId: id },
      env: { ...actual, MONTHLY_ISSUE: outputs.issue_number }
    })
  }
  const read = (overrides = {}) =>
    readLatestDeployment({ github, core, env: { ...env, ...overrides } })
  return {
    issues,
    comments,
    outputs,
    calls,
    github,
    core,
    env,
    context,
    append,
    get stateIssue() {
      return issues.find(issue =>
        issue.body?.startsWith('<!-- vx-deployment-journal:')
      )
    },
    read
  }
}

test('one journal records different promotion environments and source commits', async () => {
  const f = fixture()
  await f.append({ TARGET_ENV: 'dev' }, 1)
  await f.append({ TARGET_ENV: 'qa', SOURCE_SHA: 'b'.repeat(40) }, 2)
  await f.append({ TARGET_ENV: 'production' }, 3)
  assert.equal(f.issues.length, 2)
  assert.equal(f.comments.length, 3)
  assert.equal(parseRecord(f.comments[1]).sha, 'b'.repeat(40))
  assert.match(f.comments[0].body, /Deployment data/)
  assert.match(f.comments[0].body, /vx-fe-apps-cdns\/commit\//)
})

test('latest success survives later failures and cancellations', async () => {
  const f = fixture()
  await f.append()
  await f.append(
    {
      SOURCE_SHA: 'b'.repeat(40),
      DEPLOYMENT_STATUS: 'failure',
      FINISHED_AT: '2026-10-13T06:00:00Z'
    },
    11
  )
  await f.append(
    {
      SOURCE_SHA: 'c'.repeat(40),
      DEPLOYMENT_STATUS: 'cancelled',
      FINISHED_AT: '2026-10-13T07:00:00Z'
    },
    12
  )
  await f.read()
  assert.equal(f.outputs.found, 'true')
  assert.equal(f.outputs.sha, 'a'.repeat(40))
})

test('completion time beats comment order and commit age, including rollback', async () => {
  const f = fixture()
  await f.append(
    { SOURCE_SHA: 'b'.repeat(40), FINISHED_AT: '2026-10-13T06:00:00Z' },
    11
  )
  await f.append(
    { SOURCE_SHA: 'c'.repeat(40), FINISHED_AT: '2026-10-13T05:00:00Z' },
    10
  )
  await f.read()
  assert.equal(f.outputs.sha, 'b'.repeat(40))
  await f.append(
    { SOURCE_SHA: 'a'.repeat(40), FINISHED_AT: '2026-10-13T07:00:00Z' },
    12
  )
  await f.read()
  assert.equal(f.outputs.sha, 'a'.repeat(40))
})

test('writing the same workflow attempt twice does not add another entry', async () => {
  const f = fixture()
  await f.append()
  await f.append()
  assert.equal(f.comments.length, 1)
  await f.append({ GITHUB_RUN_ATTEMPT: '2' })
  assert.equal(f.comments.length, 2)
  await assert.rejects(
    f.append({ DEPLOYMENT_STATUS: 'failure' }),
    /Conflicting/
  )
})

test('URLs and expiry belong only to successful attempts', async () => {
  const f = fixture()
  const urls = {
    PREVIEW_URL: 'https://preview.web.app',
    LIVE_URL: 'https://live.web.app',
    PREVIEW_EXPIRES_AT: '2026-10-20T00:00:00Z'
  }
  await f.append(urls)
  await f.append({ ...urls, DEPLOYMENT_STATUS: 'failure' }, 11)
  const good = parseRecord(f.comments[0]),
    failed = parseRecord(f.comments[1])
  assert.equal(good.preview_url, 'https://preview.web.app/')
  assert.equal(good.preview_expires_at, '2026-10-20T00:00:00.000Z')
  assert.equal(failed.preview_url, null)
  await f.read()
  assert.equal(f.outputs.live_url, 'https://live.web.app/')
})

test('reader rejects ordinary, malformed, human and mismatched entries', async () => {
  const f = fixture()
  await f.append()
  const record = parseRecord(f.comments[0])
  const add = (record, user = { type: 'Bot' }) =>
    f.comments.push({
      id: f.comments.length + 1,
      issue_number: 1,
      user,
      body: `<!-- vx-deployment-record:${JSON.stringify(record)} -->`
    })
  add(
    { ...record, sha: 'b'.repeat(40), finished_at: '2026-10-14T00:00:00Z' },
    { type: 'User' }
  )
  add({
    ...record,
    source_repository: 'vezham/other',
    sha: 'b'.repeat(40),
    finished_at: '2026-10-14T00:00:00Z'
  })
  add({
    ...record,
    app: 'other',
    sha: 'b'.repeat(40),
    finished_at: '2026-10-14T00:00:00Z'
  })
  add({
    ...record,
    environment: 'qa',
    sha: 'b'.repeat(40),
    finished_at: '2026-10-14T00:00:00Z'
  })
  f.comments.push({
    id: 100,
    issue_number: 1,
    user: { type: 'Bot' },
    body: '<!-- vx-deployment-record:{malformed} -->'
  })
  await f.read()
  assert.equal(f.outputs.sha, 'a'.repeat(40))
})

test('no recorded production success returns found=false and no SHA', async () => {
  const f = fixture()
  await f.read()
  assert.equal(f.outputs.found, 'false')
  assert.equal(f.outputs.sha, '')
  await f.append({ TARGET_ENV: 'preview' })
  await f.read()
  assert.equal(f.outputs.found, 'false')
})

test('a source repository workflow cannot write the central journal', async () => {
  const f = fixture()
  await assert.rejects(
    appendDeployment({
      github: f.github,
      core: f.core,
      env: f.env,
      context: {
        ...f.context,
        repo: { owner: 'vezham', repo: 'vx-fe-apps-cdns' }
      }
    }),
    /journal repository/
  )
  assert.equal(f.issues.length, 0)
})

test('TVA and invalid source records are rejected before writes', async () => {
  const f = fixture()
  for (const overrides of [
    { TARGET_ENV: 'tva' },
    { SOURCE_SHA: 'timeline' },
    { DEPLOYMENT_STATUS: 'in_progress' },
    { FINISHED_AT: 'invalid' },
    { DEPLOYMENT_APP: '../app' },
    { SOURCE_REPO: 'missing-owner' }
  ])
    await assert.rejects(f.append(overrides))
  assert.equal(f.calls.length, 0)
})

test('serialized first promotions share monthly history while keeping the app index closed', async () => {
  const f = fixture()
  await f.append({ TARGET_ENV: 'dev' }, 1)
  await f.append({ TARGET_ENV: 'qa' }, 2)
  assert.equal(f.issues.filter(issue => issue.state === 'open').length, 1)
  assert.ok(
    f.comments.every(comment => comment.issue_number !== f.stateIssue.number)
  )
  assert.equal(f.stateIssue.state, 'closed')
})

test('reader preserves valid history in duplicate or closed journal issues', async () => {
  const f = fixture()
  await f.append()
  f.stateIssue.body = issueBody(f.env.SOURCE_REPO, f.env.DEPLOYMENT_APP)
  f.comments[0].issue_number = f.stateIssue.number
  f.issues.push({ ...f.stateIssue, number: 900, state: 'closed' })
  const record = {
    ...parseRecord(f.comments[0]),
    sha: 'b'.repeat(40),
    finished_at: '2026-10-13T06:00:00Z'
  }
  f.comments.push({
    id: 10,
    issue_number: 900,
    user: { type: 'Bot' },
    body: `<!-- vx-deployment-record:${JSON.stringify(record)} -->`
  })
  await f.read()
  assert.equal(f.outputs.sha, 'b'.repeat(40))
})

test('API failure is surfaced instead of inventing a production SHA', async () => {
  const f = fixture()
  f.github.paginate = async () => {
    throw new Error('API unavailable')
  }
  await assert.rejects(f.read(), /API unavailable/)
  assert.equal(f.outputs.sha, undefined)
})

test('same run records regional targets independently and schedules never borrow another region SHA', async () => {
  const f = fixture()
  await f.append({ PRODUCTION_TARGET: 'us' })
  await f.append({ PRODUCTION_TARGET: 'eu', SOURCE_SHA: 'b'.repeat(40) })
  await f.append(
    {
      PRODUCTION_TARGET: 'us',
      SOURCE_SHA: 'c'.repeat(40),
      DEPLOYMENT_STATUS: 'failure',
      FINISHED_AT: '2026-10-13T06:00:00Z'
    },
    11
  )
  assert.equal(f.comments.length, 3)
  assert.notEqual(
    parseRecord(f.comments[0]).event_id,
    parseRecord(f.comments[1]).event_id
  )
  await f.read({ PRODUCTION_TARGET: 'us' })
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  await f.read({ PRODUCTION_TARGET: 'eu' })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
  await f.read({ PRODUCTION_TARGET: 'in' })
  assert.equal(f.outputs.found, 'false')
  await f.read()
  assert.equal(f.outputs.found, 'false')
})
test('existing unqualified Production records belong only to default', async () => {
  const f = fixture()
  await f.append()
  const record = parseRecord(f.comments[0])
  delete record.production_target
  f.comments[0].body = `<!-- vx-deployment-record:${JSON.stringify(record)} -->`
  await f.read()
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  await f.read({ PRODUCTION_TARGET: 'us' })
  assert.equal(f.outputs.found, 'false')
})
test('invalid target selection fails before journal reads or writes', async () => {
  const f = fixture()
  await assert.rejects(
    f.append({ TARGET_ENV: 'dev', PRODUCTION_TARGET: 'us' }),
    /only valid/
  )
  await assert.rejects(
    f.read({ PRODUCTION_TARGET: '../us' }),
    /Invalid Production/
  )
  assert.equal(f.calls.length, 0)
})

test('indexed lookup uses one issue GET regardless of thousands of historical comments', async () => {
  const f = fixture()
  await f.append()
  const original = f.comments[0]
  for (let i = 0; i < 10000; i++)
    f.comments.push({ ...original, id: i + 10, body: 'historical note' })
  f.calls.length = 0
  await f.read({ JOURNAL_ISSUE: String(f.stateIssue.number) })
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  assert.deepEqual(
    f.calls.map(call => call[0]),
    ['get']
  )
})
test('legacy journals bootstrap once then use the direct index', async () => {
  const f = fixture()
  await f.append()
  f.stateIssue.body = issueBody(f.env.SOURCE_REPO, f.env.DEPLOYMENT_APP)
  f.comments[0].issue_number = f.stateIssue.number
  await f.read({
    JOURNAL_ISSUE: String(f.stateIssue.number),
    UPDATE_INDEX: 'true'
  })
  assert.match(f.stateIssue.body, /vx-deployment-state:/)
  f.calls.length = 0
  await f.read({
    JOURNAL_ISSUE: String(f.stateIssue.number),
    UPDATE_INDEX: 'true'
  })
  assert.deepEqual(
    f.calls.map(call => call[0]),
    ['get']
  )
})
test('different regional attempts retain distinct successful SHAs in the same issue index', async () => {
  const f = fixture()
  await f.append({ PRODUCTION_TARGET: 'us' })
  await f.append({ PRODUCTION_TARGET: 'eu', SOURCE_SHA: 'b'.repeat(40) }, 11)
  await f.read({
    PRODUCTION_TARGET: 'us',
    JOURNAL_ISSUE: String(f.stateIssue.number)
  })
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  await f.read({
    PRODUCTION_TARGET: 'eu',
    JOURNAL_ISSUE: String(f.stateIssue.number)
  })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
})
test('rebuild history preserves classification and never changes another target after failure', async () => {
  const f = fixture()
  await f.append({ PRODUCTION_TARGET: 'us' })
  await f.append(
    {
      PRODUCTION_TARGET: 'us',
      IS_REBUILD: 'true',
      FINISHED_AT: '2026-10-13T06:00:00Z',
      LIVE_URL: 'https://us.web.app'
    },
    11
  )
  assert.equal(parseRecord(f.comments[1]).kind, 'rebuild')
  assert.match(f.comments[1].body, /### static-cdn \| rebuild/)
  await f.append(
    {
      PRODUCTION_TARGET: 'us',
      IS_REBUILD: 'true',
      DEPLOYMENT_STATUS: 'failure',
      FINISHED_AT: '2026-10-13T07:00:00Z'
    },
    12
  )
  await f.read({
    PRODUCTION_TARGET: 'us',
    JOURNAL_ISSUE: String(f.stateIssue.number)
  })
  assert.equal(f.outputs.finished_at, '2026-10-13T06:00:00.000Z')
  await assert.rejects(
    f.append({ TARGET_ENV: 'dev', IS_REBUILD: 'true' }),
    /only allowed/
  )
})
test('wrong journal IDs and corrupt state fail without substituting another repository or SHA', async () => {
  const f = fixture()
  await f.append()
  f.stateIssue.body = '<!-- vx-deployment-journal:other/repo:static-cdn -->'
  await assert.rejects(
    f.read({ JOURNAL_ISSUE: String(f.stateIssue.number) }),
    /does not match/
  )
  f.stateIssue.body =
    issueBody(f.env.SOURCE_REPO, f.env.DEPLOYMENT_APP) +
    '\n<!-- vx-deployment-state:{broken} -->'
  await assert.rejects(
    f.read({ JOURNAL_ISSUE: String(f.stateIssue.number) }),
    /index is invalid/
  )
})
test('interrupted comment creation recovers the durable intent during a locked read', async () => {
  const f = fixture()
  await f.append()
  const create = f.github.rest.issues.createComment
  f.github.rest.issues.createComment = async () => {
    throw new Error('network interruption')
  }
  await assert.rejects(
    f.append(
      { SOURCE_SHA: 'b'.repeat(40), FINISHED_AT: '2026-10-13T06:00:00Z' },
      11
    ),
    /network interruption/
  )
  assert.match(f.stateIssue.body, /"pending"/)
  f.github.rest.issues.createComment = create
  await assert.rejects(
    f.read({ JOURNAL_ISSUE: String(f.stateIssue.number) }),
    /incomplete write/
  )
  await f.read({
    JOURNAL_ISSUE: String(f.stateIssue.number),
    UPDATE_INDEX: 'true'
  })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
  assert.equal(f.comments.length, 2)
  assert.doesNotMatch(f.stateIssue.body, /"pending"/)
})
test('interrupted final index update recovers without duplicating the history comment', async () => {
  const f = fixture()
  await f.append()
  const update = f.github.rest.issues.update
  let count = 0
  f.github.rest.issues.update = async args => {
    if (++count === 2) throw new Error('interrupted update')
    return update(args)
  }
  await assert.rejects(
    f.append(
      { SOURCE_SHA: 'b'.repeat(40), FINISHED_AT: '2026-10-13T06:00:00Z' },
      11
    ),
    /interrupted update/
  )
  assert.equal(f.comments.length, 2)
  f.github.rest.issues.update = update
  await f.read({
    JOURNAL_ISSUE: String(f.stateIssue.number),
    UPDATE_INDEX: 'true'
  })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
  assert.equal(f.comments.length, 2)
})

test('regular indexed appends read only a bounded recent page after 10000 old comments', async () => {
  const f = fixture()
  await f.append()
  for (let i = 0; i < 10000; i++)
    f.comments.push({
      id: i + 100,
      issue_number: 1,
      user: { type: 'Bot' },
      body: 'old note'
    })
  f.calls.length = 0
  await f.append(
    {
      JOURNAL_ISSUE: String(f.stateIssue.number),
      FINISHED_AT: '2026-10-13T06:00:00Z'
    },
    11
  )
  const reads = f.calls.filter(call => call[0] === 'read-comments')
  assert.equal(reads.length, 1)
  assert(reads[0][3] <= 100)
  assert.equal(
    f.calls.some(call => call[0] === 'list' && !call[1]?.labels),
    false
  )
})

test('result artifacts carry complete metadata into a later journal attempt without duplicating deployments', async t => {
  const f = fixture()
  await f.append({ LIVE_URL: 'https://public.web.app' })
  const directory = mkdtempSync(join(tmpdir(), 'vx-journal-result-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const file = join(directory, 'result.json'),
    record = parseRecord(f.comments[0])
  writeFileSync(file, JSON.stringify(record))
  await f.append({
    RESULT_FILE: file,
    GITHUB_RUN_ATTEMPT: '2',
    SOURCE_SHA: '',
    DEPLOYMENT_STATUS: '',
    FINISHED_AT: '',
    LIVE_URL: ''
  })
  assert.equal(f.comments.length, 1)
  await f.read({ JOURNAL_ISSUE: String(f.stateIssue.number) })
  assert.equal(f.outputs.live_url, 'https://public.web.app/')
  writeFileSync(file, JSON.stringify({ ...record, app: 'other' }))
  await assert.rejects(
    f.append({ RESULT_FILE: file, GITHUB_RUN_ATTEMPT: '2' }),
    /does not match/
  )
})

test('monthly rotation keeps the last successful SHA and links to its old month after a new-month failure', async () => {
  const f = fixture()
  await f.append({ FINISHED_AT: '2026-10-31T23:59:59Z' })
  const priorEntry = f.outputs.entry_url,
    firstState = f.stateIssue.number
  await f.append(
    {
      FINISHED_AT: '2026-11-01T00:00:01Z',
      DEPLOYMENT_STATUS: 'failure',
      SOURCE_SHA: 'b'.repeat(40)
    },
    11
  )
  await f.read({ JOURNAL_ISSUE: String(firstState) })
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  assert.equal(f.outputs.entry_url, priorEntry)
  assert.equal(f.stateIssue.number, firstState)
  assert.equal(f.stateIssue.state, 'closed')
  assert.equal(
    f.issues.filter(issue =>
      issue.body.startsWith('<!-- vx-deployment-monthly:')
    ).length,
    2
  )
  assert.notEqual(f.comments[0].issue_number, f.comments[1].issue_number)
})
test('two apps share category history and retain independent closed indexes', async () => {
  const f = fixture()
  await f.append()
  await f.append(
    { DEPLOYMENT_APP: 'other-cdn', SOURCE_SHA: 'b'.repeat(40) },
    11
  )
  const monthly = f.issues.filter(issue =>
    issue.body.startsWith('<!-- vx-deployment-monthly:')
  )
  assert.equal(monthly.length, 1)
  assert.equal(f.comments.length, 2)
  assert.equal(f.comments[0].issue_number, f.comments[1].issue_number)
  assert.match(f.comments[1].body, /### other-cdn/)
  assert.equal(
    f.issues.filter(issue =>
      issue.body.startsWith('<!-- vx-deployment-journal:')
    ).length,
    2
  )
  await f.read()
  assert.equal(f.outputs.sha, 'a'.repeat(40))
  await f.read({ DEPLOYMENT_APP: 'other-cdn' })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
})
test('monthly pending recovery does not duplicate a comment pushed beyond the recent page by other apps', async () => {
  const f = fixture()
  await f.append()
  const update = f.github.rest.issues.update
  let count = 0
  f.github.rest.issues.update = async args => {
    if (args.body?.includes('vx-deployment-state:') && ++count === 2)
      throw new Error('interrupted index')
    return update(args)
  }
  await assert.rejects(
    f.append(
      { FINISHED_AT: '2026-10-13T06:00:00Z', SOURCE_SHA: 'b'.repeat(40) },
      11
    ),
    /interrupted index/
  )
  f.github.rest.issues.update = update
  const monthly = f.comments[1].issue_number
  for (let i = 0; i < 150; i++)
    f.comments.push({
      id: 1000 + i,
      issue_number: monthly,
      user: { type: 'Bot' },
      body: 'other app deployment'
    })
  await f.read({
    JOURNAL_ISSUE: String(f.stateIssue.number),
    UPDATE_INDEX: 'true'
  })
  assert.equal(f.outputs.sha, 'b'.repeat(40))
  assert.equal(f.comments.length, 152)
  assert.equal(
    f.comments.filter(comment => parseRecord(comment)?.run_id === 11).length,
    1
  )
})
