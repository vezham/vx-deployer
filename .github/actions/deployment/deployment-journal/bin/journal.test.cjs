const assert = require('node:assert/strict')
const { test } = require('node:test')
const {
  appendDeployment,
  readLatestDeployment,
  parseRecord
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
    TARGET_ENV: 'production',
    DEPLOYMENT_STATUS: 'success',
    FINISHED_AT: '2026-10-13T05:00:00Z',
    STARTED_AT: '2026-10-13T04:59:00Z',
    GITHUB_RUN_ATTEMPT: '1',
    GITHUB_SERVER_URL: 'https://github.com'
  }
  const clone = value => JSON.parse(JSON.stringify(value))
  const rest = {
    listForRepo: async () => ({ data: clone(issues) }),
    listComments: async ({ issue_number }) => ({
      data: clone(
        comments.filter(comment => comment.issue_number === issue_number)
      )
    }),
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
      Object.assign(
        issues.find(issue => issue.number === params.issue_number),
        params
      )
      return {}
    }
  }
  const github = {
    rest: { issues: rest },
    paginate: async (method, params) => (await method(params)).data
  }
  const core = {
    setOutput: (name, value) => {
      outputs[name] = value
    }
  }
  const append = (overrides = {}, id = 10) =>
    appendDeployment({
      github,
      core,
      context: { ...context, runId: id },
      env: { ...env, ...overrides }
    })
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
    read
  }
}

test('one journal records different promotion environments and source commits', async () => {
  const f = fixture()
  await f.append({ TARGET_ENV: 'dev' }, 1)
  await f.append({ TARGET_ENV: 'qa', SOURCE_SHA: 'b'.repeat(40) }, 2)
  await f.append({ TARGET_ENV: 'production' }, 3)
  assert.equal(f.issues.length, 1)
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

test('concurrent first promotions write the canonical issue and close duplicates', async () => {
  const f = fixture()
  await Promise.all([
    f.append({ TARGET_ENV: 'dev' }, 1),
    f.append({ TARGET_ENV: 'qa' }, 2)
  ])
  assert.equal(f.issues.filter(issue => issue.state === 'open').length, 1)
  assert.ok(f.comments.every(comment => comment.issue_number === 1))
})

test('reader preserves valid history in duplicate or closed journal issues', async () => {
  const f = fixture()
  await f.append()
  f.issues.push({ ...f.issues[0], number: 2, state: 'closed' })
  const record = {
    ...parseRecord(f.comments[0]),
    sha: 'b'.repeat(40),
    finished_at: '2026-10-13T06:00:00Z'
  }
  f.comments.push({
    id: 10,
    issue_number: 2,
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
