const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { updateSummary } = require('./main.cjs')

const fixture = () => {
  const comments = []
  const calls = []
  let id = 1
  const repos = {
    listCommentsForCommit: Symbol('listCommentsForCommit'),
    createCommitComment: async params => {
      calls.push(['create', params])
      const comment = { id: id++, body: params.body, user: { type: 'Bot' } }
      comments.push(comment)
      return { data: comment }
    },
    updateCommitComment: async params => {
      calls.push(['update', params])
      comments.find(comment => comment.id === params.comment_id).body =
        params.body
    }
  }
  const input = {
    github: {
      rest: { repos },
      paginate: async (method, params) => {
        assert.equal(method, repos.listCommentsForCommit)
        assert.deepEqual(params, {
          owner: 'vezham',
          repo: 'app',
          commit_sha: 'source-sha',
          per_page: 100
        })
        return comments
      }
    },
    context: { repo: { owner: 'vezham', repo: 'app' }, sha: 'source-sha' },
    summary: '### QA failed\n\nAttempt 1 · run link · timestamp',
    kind: 'qa',
    workflowRef: 'vezham/app/.github/workflows/qa.yml@refs/heads/timeline',
    runNumber: '12',
    runAttempt: '1'
  }
  return { comments, calls, input }
}

test('a rerun updates the existing comment with its new result and run details', async () => {
  const { input, comments, calls } = fixture()
  assert.equal((await updateSummary(input)).operation, 'created')
  assert.equal(
    (
      await updateSummary({
        ...input,
        runAttempt: '2',
        summary: '### QA passed\n\nAttempt 2 · new run link · new timestamp'
      })
    ).operation,
    'updated'
  )
  assert.equal(comments.length, 1)
  assert.match(comments[0].body, /QA passed/)
  assert.match(comments[0].body, /Attempt 2 · new run link · new timestamp/)
  assert.deepEqual(
    calls.map(call => call[0]),
    ['create', 'update']
  )
  assert.equal(calls[0][1].commit_sha, 'source-sha')
  assert.equal(calls[1][1].comment_id, comments[0].id)
})

test('new runs of the same workflow reuse its comment, including across branches', async () => {
  const { input, comments } = fixture()
  await updateSummary(input)
  await updateSummary({
    ...input,
    runNumber: '13',
    workflowRef: input.workflowRef.replace('timeline', 'feat/test')
  })
  assert.equal(comments.length, 1)
  assert.match(comments[0].body, /vx-ci-run:13:1/)
})

test('QA, BnD and Release keep separate summaries on the same commit', async () => {
  const { input, comments } = fixture()
  for (const kind of ['qa', 'bnd', 'release'])
    await updateSummary({ ...input, kind })
  assert.equal(comments.length, 3)
})

test('different workflow files with the same summary kind keep separate comments', async () => {
  const { input, comments } = fixture()
  await updateSummary(input)
  await updateSummary({
    ...input,
    workflowRef: input.workflowRef.replace('qa.yml', 'oss-qa.yml')
  })
  assert.equal(comments.length, 2)
})

test('old comments and human comments are preserved', async () => {
  const { input, comments } = fixture()
  await updateSummary(input)
  const managed = comments.pop()
  comments.push({ ...managed, id: 99, user: { type: 'User' } })
  comments.push({
    id: 100,
    user: { type: 'Bot' },
    body: '### CI Status: previous summary'
  })
  const before = comments.map(comment => comment.body)
  await updateSummary(input)
  assert.equal(comments.length, 3)
  assert.deepEqual(
    comments.slice(0, 2).map(comment => comment.body),
    before
  )
})

test('an older run cannot replace a recorded newer run even with a larger attempt', async () => {
  const { input, comments, calls } = fixture()
  await updateSummary({ ...input, runNumber: '13' })
  const before = comments[0].body
  assert.equal(
    (await updateSummary({ ...input, runAttempt: '9' })).operation,
    'skipped'
  )
  assert.equal(comments[0].body, before)
  assert.equal(calls.length, 1)
})

test('an older attempt cannot replace a recorded newer attempt of the same run', async () => {
  const { input, calls } = fixture()
  await updateSummary({ ...input, runAttempt: '2' })
  assert.equal((await updateSummary(input)).operation, 'skipped')
  assert.equal(calls.length, 1)
})

test('identical retry is idempotent', async () => {
  const { input, calls } = fixture()
  await updateSummary(input)
  assert.equal((await updateSummary(input)).operation, 'unchanged')
  assert.equal(calls.length, 1)
})

test('invalid run metadata fails before any API write', async () => {
  for (const overrides of [
    { kind: 'other' },
    { summary: '' },
    { workflowRef: '' },
    { runNumber: 'no' },
    { runAttempt: '0' }
  ]) {
    const { input, calls } = fixture()
    await assert.rejects(updateSummary({ ...input, ...overrides }))
    assert.equal(calls.length, 0)
  }
})

test('malformed managed comment is not silently overwritten', async () => {
  const { input, comments, calls } = fixture()
  await updateSummary(input)
  comments[0].body = comments[0].body.replace(/<!-- vx-ci-run:.*? -->/, '')
  await assert.rejects(
    updateSummary({ ...input, runAttempt: '2' }),
    /missing run metadata/
  )
  assert.equal(calls.length, 1)
})

test('API permission failures are reported instead of creating another comment', async () => {
  const { input, comments, calls } = fixture()
  await updateSummary(input)
  input.github.rest.repos.updateCommitComment = async () => {
    throw new Error('403 denied')
  }
  await assert.rejects(
    updateSummary({ ...input, runAttempt: '2' }),
    /403 denied/
  )
  assert.equal(comments.length, 1)
  assert.equal(calls.length, 1)
})

for (const kind of ['qa', 'bnd', 'release']) {
  test(`${kind} summary calls the common updater and preserves PR and check reporting`, () => {
    const action = readFileSync(
      join(__dirname, `../../summary-${kind}/action.yml`),
      'utf8'
    )
    assert.match(
      action,
      /uses: vezham\/vx-deployer\/\.github\/actions\/common\/comment-ci-summary@timeline/
    )
    assert.match(action, new RegExp(`kind: ${kind}`))
    assert.doesNotMatch(action, /peter-evans\/commit-comment/)
    assert.match(action, /marocchino\/sticky-pull-request-comment@v2/)
    assert.match(action, /LouisBrunner\/checks-action@v2/)
  })
}
