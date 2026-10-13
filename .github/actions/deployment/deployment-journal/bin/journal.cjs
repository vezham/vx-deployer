const environments = ['dev', 'qa', 'preview', 'production']
const terminalStatuses = ['success', 'failure', 'cancelled']
const recordPrefix = '<!-- vx-deployment-record:'
const journalMarker = (source, app) =>
  `<!-- vx-deployment-journal:${source}:${app} -->`

const repositoryParts = value => {
  if (typeof value !== 'string' || !/^[^/\s]+\/[^/\s]+$/.test(value))
    throw new Error('Repository must be owner/repository')
  const [owner, repo] = value.split('/')
  return { owner, repo }
}

const validateApp = app => {
  if (typeof app !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(app))
    throw new Error(
      'APP_NAME must contain lowercase letters, numbers or hyphens'
    )
}

const timestamp = value => {
  const parsed = new Date(value)
  if (!value || Number.isNaN(parsed.getTime()))
    throw new Error('Invalid deployment timestamp')
  return parsed.toISOString()
}

const safeUrl = value => {
  if (!value) return null
  const parsed = new URL(value)
  if (
    !['https:', 'http:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password
  )
    throw new Error('Deployment links must be HTTP URLs without credentials')
  return parsed.href
}

const markdownLink = (text, url) =>
  url
    ? `[${text}](${url.replace(/[()|]/g, character => `%${character.charCodeAt(0).toString(16)}`)})`
    : '—'

const parseRecord = comment => {
  if (!comment.body?.startsWith(recordPrefix)) return null
  const end = comment.body.indexOf(' -->')
  if (end === -1) return null
  try {
    const record = JSON.parse(comment.body.slice(recordPrefix.length, end))
    if (
      record.schema_version !== 1 ||
      !environments.includes(record.environment) ||
      !terminalStatuses.includes(record.status) ||
      !/^[a-f0-9]{40}$/.test(record.sha) ||
      !Number.isSafeInteger(record.run_id) ||
      record.run_id <= 0 ||
      !Number.isSafeInteger(record.run_attempt) ||
      record.run_attempt <= 0 ||
      typeof record.event_id !== 'string'
    )
      return null
    repositoryParts(record.source_repository)
    repositoryParts(record.workflow_repository)
    validateApp(record.app)
    timestamp(record.finished_at)
    safeUrl(record.workflow_url)
    return record
  } catch {
    return null
  }
}

const findJournals = async ({
  github,
  journalRepository,
  sourceRepository,
  app
}) => {
  const { owner, repo } = repositoryParts(journalRepository)
  const marker = journalMarker(sourceRepository, app)
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100
  })
  return issues
    .filter(issue => !issue.pull_request && issue.body?.startsWith(marker))
    .sort((left, right) => left.number - right.number)
}

const issueBody = (source, app) =>
  [
    journalMarker(source, app),
    `Deployment history for **${app}** from **${source}**.`,
    '',
    'Each comment records one completed Dev, QA, Preview or Production attempt.',
    'TVA is tracked on source commits. Failed or cancelled attempts do not replace the current successful production SHA.',
    '',
    'Entries contain structured metadata for scheduled workflows. No deployment tags are required.'
  ].join('\n')

const renderRecord = record => {
  const labels = {
    success: '✅ Succeeded',
    failure: '❌ Failed',
    cancelled: '⏹️ Cancelled'
  }
  return [
    `${recordPrefix}${JSON.stringify(record)} -->`,
    `### ${record.environment} | ${record.sha.slice(0, 7)} | ${labels[record.status]}`,
    '',
    `**Source:** ${markdownLink(`${record.source_repository}@${record.sha.slice(0, 7)}`, record.source_url)}`,
    `**Started (UTC):** ${record.started_at || '—'}`,
    `**Finished (UTC):** ${record.finished_at}`,
    `**Actor:** @${record.actor}`,
    `**Trigger:** ${record.trigger}`,
    '',
    `**Preview:** ${markdownLink('Preview', record.preview_url)}${record.preview_expires_at ? ` · Expires ${record.preview_expires_at}` : ''}`,
    `**Live:** ${markdownLink('Live', record.live_url)}`,
    '',
    `${markdownLink('Workflow run', record.workflow_url)} · Attempt ${record.run_attempt}`,
    '',
    '<details><summary>Deployment data</summary>',
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
    '</details>'
  ].join('\n')
}

const buildRecord = ({ context, env }) => {
  const source = env.SOURCE_REPO
  const workflowRepository = `${context.repo.owner}/${context.repo.repo}`
  repositoryParts(source)
  validateApp(env.DEPLOYMENT_APP)
  if (!environments.includes(env.TARGET_ENV))
    throw new Error('Journal only records dev, qa, preview and production')
  if (!terminalStatuses.includes(env.DEPLOYMENT_STATUS))
    throw new Error('Journal status must be success, failure or cancelled')
  const sha = env.SOURCE_SHA?.toLowerCase()
  if (!/^[a-f0-9]{40}$/.test(sha || ''))
    throw new Error('GIT_SHA must be a full 40-character SHA')
  const runId = Number(context.runId)
  const attempt = Number(env.GITHUB_RUN_ATTEMPT)
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(attempt) ||
    attempt <= 0
  )
    throw new Error('Invalid workflow run or attempt')
  const finished = timestamp(env.FINISHED_AT)
  const started = env.STARTED_AT ? timestamp(env.STARTED_AT) : null
  if (started && started > finished)
    throw new Error('Deployment cannot finish before it starts')
  const successful = env.DEPLOYMENT_STATUS === 'success'
  return {
    schema_version: 1,
    event_id: `${workflowRepository}/${runId}/${attempt}/${env.DEPLOYMENT_APP}/${env.TARGET_ENV}`,
    app: env.DEPLOYMENT_APP,
    source_repository: source,
    sha,
    source_url: `${env.GITHUB_SERVER_URL}/${source}/commit/${sha}`,
    environment: env.TARGET_ENV,
    status: env.DEPLOYMENT_STATUS,
    started_at: started,
    finished_at: finished,
    actor: env.GITHUB_TRIGGERING_ACTOR || context.actor,
    trigger: context.eventName,
    workflow_repository: workflowRepository,
    run_id: runId,
    run_attempt: attempt,
    workflow_url: `${env.GITHUB_SERVER_URL}/${workflowRepository}/actions/runs/${runId}/attempts/${attempt}`,
    preview_url: successful ? safeUrl(env.PREVIEW_URL) : null,
    preview_expires_at:
      successful && env.PREVIEW_EXPIRES_AT
        ? timestamp(env.PREVIEW_EXPIRES_AT)
        : null,
    live_url: successful ? safeUrl(env.LIVE_URL) : null
  }
}

const appendDeployment = async ({
  github,
  context,
  core,
  env = process.env
}) => {
  const record = buildRecord({ context, env })
  const target = repositoryParts(env.JOURNAL_REPO)
  if (
    env.JOURNAL_REPO.toLowerCase() !== record.workflow_repository.toLowerCase()
  )
    throw new Error(
      'Deployment journal must be written from a workflow in the journal repository'
    )
  const arguments_ = {
    github,
    journalRepository: env.JOURNAL_REPO,
    sourceRepository: record.source_repository,
    app: record.app
  }
  let journals = await findJournals(arguments_)
  let journal = journals[0]
  if (!journal) {
    const { data } = await github.rest.issues.create({
      ...target,
      title: `Deployment log | ${record.app}`,
      body: issueBody(record.source_repository, record.app)
    })
    journals = await findJournals(arguments_)
    journal = journals[0] || data
  }
  const comments = await github.paginate(github.rest.issues.listComments, {
    ...target,
    issue_number: journal.number,
    per_page: 100
  })
  const existing = comments.find(
    comment => parseRecord(comment)?.event_id === record.event_id
  )
  let comment = existing
  if (!existing) {
    const { data } = await github.rest.issues.createComment({
      ...target,
      issue_number: journal.number,
      body: renderRecord(record)
    })
    comment = data
  } else {
    const previous = parseRecord(existing)
    if (previous.sha !== record.sha || previous.status !== record.status)
      throw new Error('Conflicting journal entry for this workflow attempt')
  }
  for (const duplicate of journals.slice(1)) {
    if (duplicate.state === 'open' && duplicate.user?.type === 'Bot') {
      await github.rest.issues.update({
        ...target,
        issue_number: duplicate.number,
        state: 'closed',
        body: `${issueBody(record.source_repository, record.app)}\n\nContinue in ${journal.html_url}.`
      })
    }
  }
  core.setOutput('issue_number', journal.number)
  core.setOutput('issue_url', journal.html_url)
  core.setOutput('entry_url', comment.html_url)
}

const readLatestDeployment = async ({ github, core, env = process.env }) => {
  repositoryParts(env.SOURCE_REPO)
  validateApp(env.DEPLOYMENT_APP)
  if (!environments.includes(env.TARGET_ENV))
    throw new Error('Invalid journal environment')
  const target = repositoryParts(env.JOURNAL_REPO)
  const journals = await findJournals({
    github,
    journalRepository: env.JOURNAL_REPO,
    sourceRepository: env.SOURCE_REPO,
    app: env.DEPLOYMENT_APP
  })
  const journal = journals[0]
  let latest
  if (journal) {
    const comments = []
    // vx-bot/NOTE: Include any duplicate journals from simultaneous first deployments so history stays readable.
    for (const issue of journals) {
      comments.push(
        ...(await github.paginate(github.rest.issues.listComments, {
          ...target,
          issue_number: issue.number,
          per_page: 100
        }))
      )
    }
    latest = comments
      .filter(comment => comment.user?.type === 'Bot')
      .map(comment => ({ record: parseRecord(comment), comment }))
      .filter(
        ({ record }) =>
          record &&
          record.source_repository === env.SOURCE_REPO &&
          record.app === env.DEPLOYMENT_APP &&
          record.environment === env.TARGET_ENV &&
          record.status === 'success' &&
          record.workflow_repository.toLowerCase() ===
            env.JOURNAL_REPO.toLowerCase()
      )
      .sort(
        (left, right) =>
          Date.parse(right.record.finished_at) -
            Date.parse(left.record.finished_at) ||
          right.comment.id - left.comment.id
      )[0]
  }
  core.setOutput('found', String(Boolean(latest)))
  core.setOutput('sha', latest?.record.sha || '')
  core.setOutput('finished_at', latest?.record.finished_at || '')
  core.setOutput('workflow_url', latest?.record.workflow_url || '')
  core.setOutput('issue_url', journal?.html_url || '')
  core.setOutput('entry_url', latest?.comment.html_url || '')
  core.setOutput('preview_url', latest?.record.preview_url || '')
  core.setOutput('live_url', latest?.record.live_url || '')
}

module.exports = {
  appendDeployment,
  readLatestDeployment,
  parseRecord,
  issueBody
}
