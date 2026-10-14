'use strict'

const installed = new WeakSet()
const respectRateLimits = ({
  github,
  core,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  now = Date.now
}) => {
  if (!github.hook?.wrap || installed.has(github)) return
  installed.add(github)
  github.hook.wrap('request', async (request, options) => {
    for (let attempt = 0; ; attempt++) {
      try {
        const response = await request(options)
        const headers = response.headers || {}
        const remaining = Number(headers['x-ratelimit-remaining'])
        const reset = Number(headers['x-ratelimit-reset'])
        if (
          headers['x-ratelimit-remaining'] !== undefined &&
          remaining <= 20 &&
          reset * 1000 > now()
        ) {
          core.info?.('Waiting for GitHub API quota before continuing')
          await sleep(reset * 1000 - now() + 1000)
        }
        return response
      } catch (error) {
        const headers = error.response?.headers || {}
        let delay
        const retryAfter = Number(headers['retry-after'])
        if ([403, 429].includes(error.status) && retryAfter > 0)
          delay = retryAfter * 1000
        else if (
          error.status === 403 &&
          String(headers['x-ratelimit-remaining']) === '0' &&
          Number(headers['x-ratelimit-reset']) > 0
        )
          delay = Math.max(
            1000,
            Number(headers['x-ratelimit-reset']) * 1000 - now() + 1000
          )
        else if (
          error.status === 429 ||
          (error.status === 403 && /secondary rate limit/i.test(error.message))
        )
          delay = 60000 * 2 ** attempt
        if (delay === undefined || attempt >= 3) throw error
        core.info?.(
          `Waiting ${Math.ceil(delay / 1000)} seconds for GitHub API quota`
        )
        await sleep(delay)
      }
    }
  })
}
module.exports = { respectRateLimits }
