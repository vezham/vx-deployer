const assert = require('node:assert/strict')
const { test } = require('node:test')
const { updateTracker } = require('./main.cjs')
const fixture = () => {
  const statuses = [],
    comments = []
  const repos = {
    createCommitStatus: async args => {
      const status = {
        ...args,
        id: statuses.length + 1,
        created_at: '2026-10-14T00:00:00Z',
        creator: { id: 1 }
      }
      statuses.push(status)
      return { data: status }
    },
    listCommentsForCommit: {},
    listCommitStatusesForRef: {},
    createCommitComment: async args => {
      const comment = {
        ...args,
        id: 1,
        html_url: 'https://github.com/comment/1',
        user: { id: 1 }
      }
      comments.push(comment)
      return { data: comment }
    },
    updateCommitComment: async args => {
      Object.assign(comments[0], args)
      return { data: comments[0] }
    }
  }
  const github = {
    rest: { repos },
    paginate: async method =>
      method === repos.listCommentsForCommit ? comments : statuses
  }
  return {
    github,
    core: { setOutput: () => undefined, warning: () => undefined },
    context: {
      repo: { owner: 'example', repo: 'deployer' },
      runId: 1,
      actor: 'tester'
    },
    env: {
      SOURCE_REPO: 'example/apps',
      SOURCE_SHA: 'a'.repeat(40),
      PROMOTION_APP: 'cdn',
      TARGET_ENV: 'production',
      PROMOTION_STATUS: 'success',
      GITHUB_SERVER_URL: 'https://github.com',
      GITHUB_RUN_ATTEMPT: '1'
    },
    sleep: async () => undefined,
    statuses,
    comments
  }
}
test('one source commit comment tracks regions separately with their own URLs', async () => {
  const f = fixture()
  for (const target of ['us', 'eu'])
    await updateTracker({
      ...f,
      env: {
        ...f.env,
        PRODUCTION_TARGET: target,
        LIVE_URL: `https://${target}.web.app`
      }
    })
  assert.equal(f.comments.length, 1)
  const body = f.comments[0].body
  assert.match(body, /PRODUCTION\/US.*https:\/\/us.web.app/)
  assert.match(body, /PRODUCTION\/EU.*https:\/\/eu.web.app/)
  assert.equal(
    f.statuses.filter(
      status => status.context === 'vx-promotion/cdn/production/us'
    ).length,
    1
  )
  assert.doesNotMatch(body, /\| PRODUCTION \|/)
})
test('single Production status keeps its original context and row', async () => {
  const f = fixture()
  await updateTracker(f)
  assert.equal(f.statuses[0].context, 'vx-promotion/cdn/production')
  assert.match(f.comments[0].body, /\| PRODUCTION \|/)
})
test('a failed regional retry preserves successful links without touching another target', async () => {
  const f = fixture()
  await updateTracker({
    ...f,
    env: { ...f.env, PRODUCTION_TARGET: 'us', LIVE_URL: 'https://us.web.app' }
  })
  await updateTracker({
    ...f,
    context: { ...f.context, runId: 2 },
    env: { ...f.env, PRODUCTION_TARGET: 'us', PROMOTION_STATUS: 'failure' }
  })
  assert.match(
    f.comments[0].body,
    /PRODUCTION\/US.*Failed.*https:\/\/us.web.app/
  )
})
