const environments = ['tva', 'dev', 'qa', 'preview', 'production']
const states = {
  in_progress: 'pending',
  success: 'success',
  failure: 'failure',
  cancelled: 'error'
}
const labels = {
  pending: '⏳ In progress',
  success: '✅ Deployed',
  failure: '❌ Failed',
  error: '⏹️ Cancelled'
}

const timestamp = value =>
  value ? value.replace('T', ' ').replace(/\.\d{3}Z$|Z$/, '') : '—'
const newestFirst = (left, right) => right.id - left.id

const renderTracker = ({
  statuses,
  app,
  repository,
  sha,
  serverUrl,
  marker
}) => {
  const prefix = `vx-promotion/${app}/`
  const rows = environments.map(environment => {
    const events = statuses
      .filter(event => event.context === prefix + environment)
      .sort(newestFirst)
    if (!events.length)
      return `| ${environment.toUpperCase()} | — Pending | — | — | — | — | — |`
    const attempts = new Map()
    for (const event of events) {
      const attempt = attempts.get(event.target_url) || {
        latest: event,
        firstId: event.id,
        started: null
      }
      attempt.firstId = Math.min(attempt.firstId, event.id)
      if (event.state === 'pending') attempt.started = event.created_at
      attempts.set(event.target_url, attempt)
    }
    // vx-bot/NOTE: An older run finishing late must not replace a newer attempt's progress.
    const attempt = [...attempts.values()].sort(
      (left, right) => right.firstId - left.firstId
    )[0]
    const latest = attempt.latest
    const successful = events.find(event => event.state === 'success')
    const actor = latest.description?.split(' by ')[1]
    const finished =
      latest.state === 'pending' ? '—' : timestamp(latest.created_at)
    const lastSuccess = successful
      ? `[${timestamp(successful.created_at)}](${successful.target_url})`
      : '—'
    return `| ${environment.toUpperCase()} | ${labels[latest.state]} | ${timestamp(attempt.started)} | ${finished} | ${lastSuccess} | ${actor ? `@${actor}` : '—'} | [Run](${latest.target_url}) |`
  })
  return [
    marker,
    `### Promotion tracker: ${app}`,
    '',
    `**Commit:** [${sha.slice(0, 7)}](${serverUrl}/${repository}/commit/${sha})`,
    '',
    '| Environment | Latest attempt | Started (UTC) | Finished (UTC) | Last successful deployment (UTC) | Actor | Workflow |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    'Failed or cancelled retries preserve the last successful deployment. Times are UTC.'
  ].join('\n')
}

const updateTracker = async ({
  github,
  context,
  core,
  env = process.env,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
}) => {
  const repository = env.SOURCE_REPO
  const sha = env.SOURCE_SHA.toLowerCase()
  const app = env.PROMOTION_APP
  const environment = env.TARGET_ENV
  const status = env.PROMOTION_STATUS
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository))
    throw new Error('GIT_REPO must be owner/repository')
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error('GIT_SHA must be a full 40-character commit SHA')
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app))
    throw new Error(
      'APP_NAME must contain lowercase letters, numbers or hyphens'
    )
  if (!environments.includes(environment))
    throw new Error('APP_ENV must be tva, dev, qa, preview or production')
  if (!Object.hasOwn(states, status))
    throw new Error('Unsupported promotion status')
  const [owner, repo] = repository.split('/')
  const marker = `<!-- vx-promotion-tracker:${app}:${sha} -->`
  const runUrl = `${env.GITHUB_SERVER_URL}/${context.repo.owner}/${context.repo.repo}/actions/runs/${context.runId}/attempts/${env.GITHUB_RUN_ATTEMPT}`
  const { data: recorded } = await github.rest.repos.createCommitStatus({
    owner,
    repo,
    sha,
    state: states[status],
    context: `vx-promotion/${app}/${environment}`,
    description: `${status} by ${context.actor}`,
    target_url: runUrl
  })
  const listTrackers = async () => {
    const comments = await github.paginate(
      github.rest.repos.listCommentsForCommit,
      { owner, repo, commit_sha: sha, per_page: 100 }
    )
    return comments
      .filter(comment => comment.body?.startsWith(marker))
      .sort((left, right) => left.id - right.id)
  }
  const buildBody = async () => {
    const statuses = await github.paginate(
      github.rest.repos.listCommitStatusesForRef,
      { owner, repo, ref: sha, per_page: 100 }
    )
    return renderTracker({
      statuses,
      app,
      repository,
      sha,
      serverUrl: env.GITHUB_SERVER_URL,
      marker
    })
  }
  let trackers = await listTrackers()
  if (!trackers.length) {
    await github.rest.repos.createCommitComment({
      owner,
      repo,
      commit_sha: sha,
      body: await buildBody()
    })
  }
  let comment
  // vx-bot/NOTE: Rebuild from durable status events after overlapping writes or initial comment creation.
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt) await sleep(1000)
    trackers = await listTrackers()
    if (!trackers.length)
      throw new Error('Promotion tracker disappeared during update')
    const canonical = trackers[0]
    const body = await buildBody()
    comment = canonical
    if (canonical.body !== body) {
      const response = await github.rest.repos.updateCommitComment({
        owner,
        repo,
        comment_id: canonical.id,
        body
      })
      comment = response.data
    }
    for (const duplicate of trackers.slice(1)) {
      if (duplicate.user.id === recorded.creator.id) {
        try {
          await github.rest.repos.deleteCommitComment({
            owner,
            repo,
            comment_id: duplicate.id
          })
        } catch (error) {
          if (error.status !== 404) throw error
        }
      }
    }
  }
  core.setOutput('comment_id', comment.id)
  core.setOutput('comment_url', comment.html_url)
}

module.exports = { renderTracker, updateTracker }
