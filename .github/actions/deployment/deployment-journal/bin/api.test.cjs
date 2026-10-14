const assert = require('node:assert/strict')
const { test } = require('node:test')
const { respectRateLimits } = require('./api.cjs')
const fixture = () => {
  let hook
  const waits = []
  const github = {
    hook: {
      wrap: (_, handler) => {
        hook = handler
      }
    }
  }
  respectRateLimits({
    github,
    core: { info: () => undefined },
    sleep: async ms => {
      waits.push(ms)
    },
    now: () => 100000
  })
  return { waits, run: request => hook(request, {}) }
}
test('primary quota exhaustion waits for reset and retries without exposing request credentials', async () => {
  const f = fixture()
  let calls = 0
  const result = await f.run(async () => {
    if (!calls++)
      throw {
        status: 403,
        response: {
          headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': '105' }
        }
      }
    return 'ok'
  })
  assert.equal(result, 'ok')
  assert.deepEqual(f.waits, [6000])
})
test('secondary quota retry-after is respected', async () => {
  const f = fixture()
  let calls = 0
  await f.run(async () => {
    if (!calls++)
      throw { status: 429, response: { headers: { 'retry-after': '3' } } }
    return 'ok'
  })
  assert.deepEqual(f.waits, [3000])
})
test('authorization failures propagate immediately rather than sleeping or hiding errors', async () => {
  const f = fixture()
  const error = {
    status: 403,
    message: 'Resource not accessible by integration'
  }
  await assert.rejects(
    f.run(async () => {
      throw error
    }),
    value => value === error
  )
  assert.deepEqual(f.waits, [])
})
test('rate-limit retry attempts remain bounded', async () => {
  const f = fixture()
  let calls = 0
  await assert.rejects(
    f.run(async () => {
      calls++
      throw { status: 429, response: { headers: { 'retry-after': '1' } } }
    })
  )
  assert.equal(calls, 4)
  assert.equal(f.waits.length, 3)
})

test('successful responses reserve API headroom before the next client starts', async () => {
  const f = fixture()
  const response = {
    headers: { 'x-ratelimit-remaining': '20', 'x-ratelimit-reset': '105' }
  }
  assert.equal(await f.run(async () => response), response)
  assert.deepEqual(f.waits, [6000])
})
test('successful responses with available quota continue immediately', async () => {
  const f = fixture()
  await f.run(async () => ({
    headers: { 'x-ratelimit-remaining': '500', 'x-ratelimit-reset': '105' }
  }))
  assert.deepEqual(f.waits, [])
})
