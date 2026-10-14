const { readFileSync } = require('node:fs')
const {
  validateCategory,
  getMonthlyJournal,
  findHistoryRecord,
  ensureMonthlyJournal
} = require('./monthly.cjs')
const { respectRateLimits } = require('./api.cjs')
const { emptyState, parseState, addEntry, stateBody } = require('./state.cjs')

const {
  normalizeProductionTarget,
  deploymentEnvironment
} = require('../../resolve-web-app/bin/config.cjs')

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
    if (record.category !== undefined) validateCategory(record.category)
    timestamp(record.finished_at)
    safeUrl(record.workflow_url)
    if (
      record.kind !== undefined &&
      !['promotion', 'rebuild'].includes(record.kind)
    )
      return null
    record.kind = record.kind || 'promotion'
    if (record.kind === 'rebuild' && record.environment !== 'production')
      return null
    record.production_target = normalizeProductionTarget(
      record.production_target ?? '',
      record.environment
    )
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
    `Current deployment state for **${app}** from **${source}**.`,
    '',
    'This closed issue is the scheduler index. New history is recorded in monthly category journals linked from each state entry.',
    'Older comments remain as historical records. TVA is tracked on source commits.',
    'Failed or cancelled attempts do not replace the latest successful SHA for each environment/target.'
  ].join('\n')

const renderRecord = (record, stateUrl) => {
  const labels = {
    success: '✅ Succeeded',
    failure: '❌ Failed',
    cancelled: '⏹️ Cancelled'
  }
  return [
    `${recordPrefix}${JSON.stringify(record)} -->`,
    `### ${record.app} | ${record.kind} | ${deploymentEnvironment(record.environment, record.production_target)} | ${record.sha.slice(0, 7)} | ${labels[record.status]}`,
    '',
    `**Source:** ${markdownLink(`${record.source_repository}@${record.sha.slice(0, 7)}`, record.source_url)}`,
    `**Current state:** ${markdownLink('App state', stateUrl)}`,
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
  if (
    !['true', 'false'].includes(env.IS_REBUILD || 'false') ||
    (env.IS_REBUILD === 'true' && env.TARGET_ENV !== 'production')
  )
    throw new Error('Rebuilds are only allowed for Production')
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
  const productionTarget = normalizeProductionTarget(
    env.PRODUCTION_TARGET || '',
    env.TARGET_ENV
  )
  const successful = env.DEPLOYMENT_STATUS === 'success'
  return {
    schema_version: 1,
    kind: env.IS_REBUILD === 'true' ? 'rebuild' : 'promotion',
    event_id: `${workflowRepository}/${runId}/${attempt}/${env.DEPLOYMENT_APP}/${deploymentEnvironment(env.TARGET_ENV, productionTarget)}`,
    app: env.DEPLOYMENT_APP,
    category: validateCategory(env.DEPLOYMENT_CATEGORY),
    source_repository: source,
    sha,
    source_url: `${env.GITHUB_SERVER_URL}/${source}/commit/${sha}`,
    environment: env.TARGET_ENV,
    production_target: productionTarget,
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

const matchingRecord = (record, env) =>
  record &&
  record.source_repository === env.SOURCE_REPO &&
  record.app === env.DEPLOYMENT_APP &&
  record.workflow_repository.toLowerCase() === env.JOURNAL_REPO.toLowerCase()

const validateStateRecord = env => record =>
  matchingRecord(
    parseRecord({ body: `${recordPrefix}${JSON.stringify(record)} -->` }),
    env
  )

const getJournal = async ({ github, env, create = false }) => {
  const target = repositoryParts(env.JOURNAL_REPO)
  const parameters = {
    github,
    journalRepository: env.JOURNAL_REPO,
    sourceRepository: env.SOURCE_REPO,
    app: env.DEPLOYMENT_APP
  }
  let journals
  if (env.JOURNAL_ISSUE) {
    if (
      !/^[1-9]\d*$/.test(env.JOURNAL_ISSUE) ||
      !Number.isSafeInteger(Number(env.JOURNAL_ISSUE))
    )
      throw new Error('Invalid journal issue number')
    const response = await github.rest.issues.get({
      ...target,
      issue_number: Number(env.JOURNAL_ISSUE)
    })
    journals = [response.data]
  } else journals = await findJournals(parameters)
  let journal = journals[0]
  if (!journal && create) {
    const response = await github.rest.issues.create({
      ...target,
      title: `Deployment state | ${env.DEPLOYMENT_APP}`,
      body: issueBody(env.SOURCE_REPO, env.DEPLOYMENT_APP)
    })
    journals = await findJournals(parameters)
    journal = journals[0] || response.data
  }
  if (
    journal &&
    (journal.pull_request ||
      !journal.body?.startsWith(
        journalMarker(env.SOURCE_REPO, env.DEPLOYMENT_APP)
      ))
  )
    throw new Error(
      'Journal issue does not match the source repository and app'
    )
  return { journal, journals, target, parameters }
}

const recentComments = async (github, target, journal) => {
  const response = await github.rest.issues.listComments({
    ...target,
    issue_number: journal.number,
    per_page: 100,
    page: Math.max(1, Math.ceil((journal.comments || 0) / 100))
  })
  return response.data
}

const writeState = async ({ github, target, journal, env, state }) => {
  const body = stateBody(issueBody(env.SOURCE_REPO, env.DEPLOYMENT_APP), state)
  await github.rest.issues.update({
    ...target,
    issue_number: journal.number,
    title: `Deployment state | ${env.DEPLOYMENT_APP}`,
    state: 'closed',
    body
  })
  journal.body = body
}

const loadState = async ({
  github,
  env,
  journal,
  journals,
  target,
  parameters,
  recover = false
}) => {
  let state = parseState(journal.body, validateStateRecord(env))
  if (!state) {
    // vx-bot/NOTE: Read old history once; the workflow serializes bootstrap and writes per app.
    journals = await findJournals(parameters)
    state = emptyState()
    for (const issue of journals.length ? journals : [journal]) {
      const comments = await github.paginate(github.rest.issues.listComments, {
        ...target,
        issue_number: issue.number,
        per_page: 100
      })
      for (const comment of comments) {
        const record = comment.user?.type === 'Bot' && parseRecord(comment)
        if (!matchingRecord(record, env)) continue
        const url =
          comment.html_url || `${issue.html_url}#issuecomment-${comment.id}`
        safeUrl(url)
        addEntry(state, record, url, comment.id)
      }
    }
  }
  if (state.pending) {
    // vx-bot/NOTE: Recover an interrupted append before exposing its successful SHA.
    if (!recover)
      throw new Error(
        'Journal has an incomplete write; recover it under the per-app journal lock'
      )
    const record = state.pending
    const history = state.pending_history
      ? await getMonthlyJournal({
          github,
          target,
          number: state.pending_history.issue_number,
          record
        })
      : journal
    let comment = state.pending_history
      ? await findHistoryRecord({
          github,
          target,
          journal: history,
          record,
          parseRecord,
          recover: true
        })
      : (await recentComments(github, target, journal)).find(
          item =>
            item.user?.type === 'Bot' &&
            parseRecord(item)?.event_id === record.event_id
        )
    if (comment) {
      const previous = parseRecord(comment)
      if (previous.sha !== record.sha || previous.status !== record.status)
        throw new Error('Conflicting pending journal entry')
    } else {
      const response = await github.rest.issues.createComment({
        ...target,
        issue_number: history.number,
        body: renderRecord(record, journal.html_url)
      })
      comment = response.data
    }
    addEntry(state, record, comment.html_url, comment.id)
    delete state.pending
    delete state.pending_history
    await writeState({ github, target, journal, env, state })
  }
  return state
}

const readDeploymentResult = ({ context, env = process.env }) => {
  const attempt = Number(env.GITHUB_RUN_ATTEMPT)
  if (
    !Number.isSafeInteger(attempt) ||
    attempt <= 0 ||
    !['true', 'false'].includes(env.IS_REBUILD || 'false')
  )
    throw new Error('Invalid workflow attempt or rebuild mode')
  validateCategory(env.DEPLOYMENT_CATEGORY)
  const record = env.RESULT_FILE
    ? parseRecord({
        body: `${recordPrefix}${readFileSync(env.RESULT_FILE, 'utf8').trim()} -->`
      })
    : buildRecord({ context, env })
  if (
    !record ||
    record.source_repository !== env.SOURCE_REPO ||
    record.app !== env.DEPLOYMENT_APP ||
    record.category !== env.DEPLOYMENT_CATEGORY ||
    record.environment !== env.TARGET_ENV ||
    record.production_target !==
      normalizeProductionTarget(env.PRODUCTION_TARGET || '', env.TARGET_ENV) ||
    record.run_id !== Number(context.runId) ||
    record.run_attempt > attempt ||
    record.kind !== (env.IS_REBUILD === 'true' ? 'rebuild' : 'promotion')
  )
    throw new Error(
      'Deployment result does not match this app, target and workflow run'
    )
  if (
    env.JOURNAL_REPO.toLowerCase() !==
      record.workflow_repository.toLowerCase() ||
    record.workflow_repository.toLowerCase() !==
      `${context.repo.owner}/${context.repo.repo}`.toLowerCase()
  )
    throw new Error(
      'Deployment journal must be written from a workflow in the journal repository'
    )
  return record
}

const prepareMonthlyJournal = async ({
  github,
  context,
  core,
  env = process.env
}) => {
  respectRateLimits({ github, core })
  const record = readDeploymentResult({ context, env })
  const journal = await ensureMonthlyJournal({
    github,
    target: repositoryParts(env.JOURNAL_REPO),
    record
  })
  core.setOutput('issue_number', String(journal.number))
  core.setOutput('issue_url', journal.html_url)
}

const appendDeployment = async ({
  github,
  context,
  core,
  env = process.env
}) => {
  respectRateLimits({ github, core })
  const record = readDeploymentResult({ context, env })
  const data = await getJournal({ github, env, create: true })
  const { journal, journals, target } = data
  const state = await loadState({ github, env, ...data, recover: true })
  const history = await getMonthlyJournal({
    github,
    target,
    number: env.MONTHLY_ISSUE,
    record
  })
  const known = Object.values(state.destinations)
    .flatMap(item => [item.latest_attempt, item.latest_success])
    .find(item => item?.record.event_id === record.event_id)
  const existing = known
    ? undefined
    : await findHistoryRecord({
        github,
        target,
        journal: history,
        record,
        parseRecord
      })
  let comment = known
    ? { html_url: known.entry_url, id: known.entry_id, record: known.record }
    : existing
  if (comment) {
    const previous = comment.record || parseRecord(comment)
    if (previous.sha !== record.sha || previous.status !== record.status)
      throw new Error('Conflicting journal entry for this workflow attempt')
  } else {
    state.pending = record
    state.pending_history = { issue_number: history.number }
    // Validate the final size before appending so failures leave a recoverable intent.
    const projected = structuredClone(state)
    addEntry(
      projected,
      record,
      `${history.html_url}#issuecomment-999999999999`,
      999999999999
    )
    delete projected.pending
    delete projected.pending_history
    stateBody(issueBody(env.SOURCE_REPO, env.DEPLOYMENT_APP), projected)
    await writeState({ github, target, journal, env, state })
    const response = await github.rest.issues.createComment({
      ...target,
      issue_number: history.number,
      body: renderRecord(record, journal.html_url)
    })
    comment = response.data
  }
  addEntry(state, record, comment.html_url, comment.id)
  delete state.pending
  delete state.pending_history
  await writeState({ github, target, journal, env, state })
  for (const duplicate of journals.slice(1))
    if (duplicate.state === 'open' && duplicate.user?.type === 'Bot')
      await github.rest.issues.update({
        ...target,
        issue_number: duplicate.number,
        state: 'closed',
        body: `${issueBody(record.source_repository, record.app)}\n\nContinue in ${journal.html_url}.`
      })
  core.setOutput('issue_number', journal.number)
  core.setOutput('issue_url', journal.html_url)
  core.setOutput('entry_url', comment.html_url)
  core.setOutput('history_issue_url', history.html_url)
}

const readLatestDeployment = async ({ github, core, env = process.env }) => {
  respectRateLimits({ github, core })
  repositoryParts(env.SOURCE_REPO)
  validateApp(env.DEPLOYMENT_APP)
  if (!environments.includes(env.TARGET_ENV))
    throw new Error('Invalid journal environment')
  const productionTarget = normalizeProductionTarget(
    env.PRODUCTION_TARGET || '',
    env.TARGET_ENV
  )
  const data = await getJournal({ github, env })
  const { journal, target } = data
  let latest
  if (journal) {
    const hadIndex = Boolean(parseState(journal.body, validateStateRecord(env)))
    const state = await loadState({
      github,
      env,
      ...data,
      recover: env.UPDATE_INDEX === 'true'
    })
    if (!hadIndex && env.UPDATE_INDEX === 'true')
      await writeState({ github, target, journal, env, state })
    latest =
      state.destinations[
        deploymentEnvironment(env.TARGET_ENV, productionTarget)
      ]?.latest_success
  }
  core.setOutput('found', String(Boolean(latest)))
  core.setOutput('sha', latest?.record.sha || '')
  core.setOutput('finished_at', latest?.record.finished_at || '')
  core.setOutput('workflow_url', latest?.record.workflow_url || '')
  core.setOutput('issue_url', journal?.html_url || '')
  core.setOutput('issue_number', journal ? String(journal.number) : '')
  core.setOutput('entry_url', latest?.entry_url || '')
  core.setOutput('preview_url', latest?.record.preview_url || '')
  core.setOutput('live_url', latest?.record.live_url || '')
}

module.exports = {
  appendDeployment,
  readLatestDeployment,
  parseRecord,
  issueBody,
  buildRecord,
  prepareMonthlyJournal,
  readDeploymentResult
}
