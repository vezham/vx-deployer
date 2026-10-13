const assert = require('node:assert/strict')
const { test } = require('node:test')
const { validatePromotion } = require('./main.cjs')
const sha = 'a'.repeat(40)
const context = (overrides = {}, statuses = []) => {
  const requests = []
  const output = {}
  const summaries = []
  const summary = Object.fromEntries(
    ['addHeading', 'addLink', 'addRaw'].map(method => [
      method,
      (...args) => {
        summaries.push(args)
        return summary
      }
    ])
  )
  summary.write = async () => summaries.push(['write'])
  const github = {
    rest: {
      repos: {
        getCommit: async args => {
          requests.push(args)
          return {
            data: {
              sha,
              html_url: 'https://github.com/example/source/commit/' + sha
            }
          }
        },
        listCommitStatusesForRef: {}
      }
    },
    paginate: async (_, args) => {
      requests.push(args)
      return statuses
    }
  }
  return {
    env: {
      SOURCE_SHA: sha,
      TARGET_ENV: 'production',
      PROMOTION_APP: 'cdn',
      SOURCE_REPO: 'example/source',
      ...overrides
    },
    github,
    core: {
      setOutput: (key, value) => {
        output[key] = value
      },
      summary
    },
    requests,
    output,
    summaries
  }
}
const success = (stage, app = 'cdn') => ({
  context: `vx-promotion/${app}/${stage}`,
  state: 'success',
  created_at: '2026-10-14T00:00:00Z',
  target_url: 'https://github.com/example/source/actions/runs/1'
})

for (const [destination, path, previous] of [
  ['production', undefined, 'preview'],
  ['preview', ['tva', 'preview', 'production'], 'tva'],
  ['production', ['tva', 'preview', 'production'], 'preview'],
  ['production', ['tva', 'production'], 'tva'],
  ['qa', ['tva', 'qa', 'production'], 'tva']
]) {
  test(`validate ${destination} after ${previous} using ${JSON.stringify(path ?? 'default')}`, async () => {
    const input = context(
      {
        TARGET_ENV: destination,
        ...(path ? { PROMOTION_PATH: JSON.stringify(path) } : {})
      },
      [success(previous)]
    )
    await validatePromotion(input)
    assert.equal(input.output.sha, sha)
    assert.equal(input.output.short_sha, 'aaaaaaa')
    assert.deepEqual(input.requests[1], {
      owner: 'example',
      repo: 'source',
      ref: sha,
      per_page: 100
    })
    assert(
      input.summaries.some(args => String(args[0]).includes('Promotion path:'))
    )
  })
}

for (const statuses of [
  [],
  [success('preview', 'other-app')],
  [success('dev')],
  [{ ...success('preview'), state: 'failure' }],
  [{ ...success('preview'), state: 'pending' }]
]) {
  test('successful required stage for the same app is mandatory', async () => {
    const input = context({}, statuses)
    await assert.rejects(validatePromotion(input), /successful preview/)
    assert.deepEqual(input.output, {})
  })
}

test('a successful omitted stage cannot substitute for the configured prerequisite', async () => {
  await assert.rejects(
    validatePromotion(
      context({ PROMOTION_PATH: '["tva","production"]' }, [success('preview')])
    ),
    /successful tva/
  )
})

test('destination outside an app path fails before GitHub API access', async () => {
  const input = context(
    { TARGET_ENV: 'dev', PROMOTION_PATH: '["tva","preview","production"]' },
    [success('tva')]
  )
  await assert.rejects(
    validatePromotion(input),
    /not in the app promotion_path/
  )
  assert.deepEqual(input.requests, [])
})

test('wrong resolved SHA fails without querying statuses', async () => {
  const input = context()
  input.github.rest.repos.getCommit = async () => ({
    data: { sha: 'b'.repeat(40) }
  })
  await assert.rejects(validatePromotion(input), /does not match/)
  assert.deepEqual(input.output, {})
})

for (const overrides of [
  { SOURCE_SHA: 'timeline' },
  { TARGET_ENV: 'live' },
  { PROMOTION_APP: 'bad app' },
  { SOURCE_REPO: 'https://github.com/example/source' },
  { PROMOTION_PATH: '[' },
  { PROMOTION_PATH: '["dev","production"]' }
]) {
  test(`reject malformed source or policy ${JSON.stringify(overrides)}`, async () => {
    const input = context(overrides)
    await assert.rejects(validatePromotion(input))
    assert.deepEqual(input.requests, [])
  })
}

test('status read failures propagate without approving promotion', async () => {
  const input = context()
  input.github.paginate = async () => {
    throw new Error('HTTP 403')
  }
  await assert.rejects(validatePromotion(input), /HTTP 403/)
  assert.deepEqual(input.output, {})
})

test('each Production target validates the same app/SHA prerequisite and identifies its target', async () => {
  for (const target of ['us', 'customer-east']) {
    const input = context(
      {
        PRODUCTION_TARGET: target,
        PROMOTION_PATH: '["tva","dev","production"]'
      },
      [success('dev')]
    )
    await validatePromotion(input)
    assert.equal(input.output.sha, sha)
    assert(
      input.summaries.some(args =>
        String(args[0]).includes(`production/${target}`)
      )
    )
  }
})
test('a region cannot bypass the configured app prerequisite', async () => {
  const input = context({ PRODUCTION_TARGET: 'us' }, [success('production/eu')])
  await assert.rejects(validatePromotion(input), /successful preview/)
})
