'use strict'

const {
  deploymentEnvironment
} = require('../../resolve-web-app/bin/config.cjs')
const { getPromotionPath, getPreviousEnvironment } = require('./policy.cjs')

const validatePromotion = async ({ github, core, env = process.env }) => {
  const sha = env.SOURCE_SHA
  const environment = env.TARGET_ENV
  const app = env.PROMOTION_APP
  const repository = env.SOURCE_REPO
  if (!/^[a-f0-9]{40}$/i.test(sha))
    throw new Error('GIT_SHA must be a full 40-character commit SHA')
  if (!['dev', 'qa', 'preview', 'production'].includes(environment))
    throw new Error('APP_ENV must be dev, qa, preview or production')
  if (!app || !/^[a-z0-9][a-z0-9-]*$/.test(app))
    throw new Error(
      'APP_NAME must contain lowercase letters, numbers or hyphens'
    )
  if (!/^[^/\s]+\/[^/\s]+$/.test(repository))
    throw new Error('GIT_REPO must be owner/repository')
  const stages = getPromotionPath(
    env.PROMOTION_PATH ? JSON.parse(env.PROMOTION_PATH) : undefined
  )
  const destination = deploymentEnvironment(
    environment,
    env.PRODUCTION_TARGET || ''
  )
  const previousEnvironment = getPreviousEnvironment(environment, stages)
  const [owner, repo] = repository.split('/')
  const { data: commit } = await github.rest.repos.getCommit({
    owner,
    repo,
    ref: sha
  })
  if (
    typeof commit.sha !== 'string' ||
    commit.sha.toLowerCase() !== sha.toLowerCase()
  )
    throw new Error('Resolved source commit does not match GIT_SHA')
  const shortSha = commit.sha.slice(0, 7)
  const statuses = await github.paginate(
    github.rest.repos.listCommitStatusesForRef,
    {
      owner,
      repo,
      ref: commit.sha,
      per_page: 100
    }
  )
  const prerequisite = statuses.find(
    status =>
      status.context === `vx-promotion/${app}/${previousEnvironment}` &&
      status.state === 'success'
  )
  if (!prerequisite)
    throw new Error(
      `Cannot promote ${app}@${shortSha} to ${environment}: a successful ${previousEnvironment} deployment of the same app and SHA is required`
    )

  core.setOutput('sha', commit.sha)
  core.setOutput('short_sha', shortSha)
  await core.summary
    .addHeading(`Promotion: ${destination} | ${shortSha}`)
    .addLink(`${repository}@${shortSha}`, commit.html_url)
    .addRaw(`\n\nPromotion path: **${stages.join(' → ')}**.\n`)
    .addRaw(
      `\n\nOrder check passed: successful **${previousEnvironment}** deployment at ${prerequisite.created_at}.\n`
    )
    .addLink('Prerequisite deployment run', prerequisite.target_url)
    .addRaw(`\n\nFull SHA: \`${commit.sha}\`\n`)
    .write()
}

module.exports = { validatePromotion }
