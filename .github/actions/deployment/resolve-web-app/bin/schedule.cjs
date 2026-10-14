'use strict'

const batchSize = 100
const idPattern = /^[a-z0-9][a-z0-9-]*$/
const validateBatch = source => {
  const deployments = typeof source === 'string' ? JSON.parse(source) : source
  if (
    !Array.isArray(deployments) ||
    !deployments.length ||
    deployments.length > batchSize
  )
    throw new Error('A scheduled batch must contain 1–100 targets')
  const identities = new Set()
  for (const entry of deployments) {
    if (
      !entry ||
      typeof entry !== 'object' ||
      Array.isArray(entry) ||
      ![entry.app, entry.target, entry.category].every(
        value => typeof value === 'string' && idPattern.test(value)
      )
    )
      throw new Error('Invalid scheduled app, target or category')
    if (
      entry.journal_issue !== undefined &&
      (typeof entry.journal_issue !== 'string' ||
        !/^[1-9]\d*$/.test(entry.journal_issue) ||
        !Number.isSafeInteger(Number(entry.journal_issue)))
    )
      throw new Error('Invalid scheduled journal issue number')
    const identity = `${entry.app}/${entry.target}`
    if (identities.has(identity))
      throw new Error('Duplicate scheduled target: ' + identity)
    identities.add(identity)
  }
  return deployments
}
const buildBatches = deployments => {
  if (!Array.isArray(deployments))
    throw new Error('Expected scheduled deployments')
  if (deployments.length > batchSize * 256)
    throw new Error('Scheduled targets exceed the 256-batch capacity')
  const batches = []
  const identities = new Set()
  for (let offset = 0; offset < deployments.length; offset += batchSize) {
    const chunk = validateBatch(deployments.slice(offset, offset + batchSize))
    for (const entry of chunk) {
      const identity = `${entry.app}/${entry.target}`
      if (identities.has(identity))
        throw new Error('Duplicate scheduled target: ' + identity)
      identities.add(identity)
    }
    batches.push({
      index: batches.length + 1,
      count: chunk.length,
      deployments: JSON.stringify(chunk)
    })
  }
  if (Buffer.byteLength(JSON.stringify(batches), 'utf16le') > 900000)
    throw new Error(
      'Scheduled batch output exceeds the job output budget; narrow the registry scope'
    )
  return batches
}
const discoverJournalIssues = async ({
  github,
  journalRepository,
  deployments,
  apps
}) => {
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(journalRepository))
    throw new Error('Invalid journal repository')
  const [owner, repo] = journalRepository.split('/')
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'all',
    per_page: 100
  })
  const lookup = new Map()
  for (const issue of issues
    .filter(issue => !issue.pull_request)
    .sort((a, b) => a.number - b.number)) {
    const match = issue.body?.match(
      /^<!-- vx-deployment-journal:([^:\s]+\/[^:\s]+):([a-z0-9][a-z0-9-]*) -->/
    )
    if (!match) continue
    const key = `${match[1].toLowerCase()}/${match[2]}`
    if (!lookup.has(key)) lookup.set(key, String(issue.number))
  }
  return deployments.flatMap(entry => {
    const journal = lookup.get(
      `${apps[entry.app].repository.toLowerCase()}/${entry.app}`
    )
    return journal ? [{ ...entry, journal_issue: journal }] : []
  })
}
module.exports = { validateBatch, buildBatches, discoverJournalIssues }
