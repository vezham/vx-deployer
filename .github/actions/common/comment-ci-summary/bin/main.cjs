const { readFileSync } = require('node:fs')

const positiveInteger = (value, name) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return number
}

const updateSummary = async ({
  github,
  context,
  summary,
  kind,
  workflowRef,
  runNumber,
  runAttempt
}) => {
  if (
    !['qa', 'bnd', 'release', 'audit-fallow', 'audit-react-doctor'].includes(
      kind
    )
  ) {
    throw new Error('Unsupported CI summary kind')
  }
  const workflow = workflowRef?.split('@')[0]
  if (!workflow || !summary?.trim()) {
    throw new Error('Workflow reference and summary are required')
  }
  const number = positiveInteger(runNumber, 'Run number')
  const attempt = positiveInteger(runAttempt, 'Run attempt')
  const marker = `<!-- vx-ci-summary:${kind}:${encodeURIComponent(workflow)} -->`
  const body = `${marker}\n<!-- vx-ci-run:${number}:${attempt} -->\n\n${summary}`
  const comments = await github.paginate(
    github.rest.repos.listCommentsForCommit,
    { ...context.repo, commit_sha: context.sha, per_page: 100 }
  )
  const existing = comments
    .filter(
      comment =>
        comment.user?.type === 'Bot' && comment.body?.startsWith(`${marker}\n`)
    )
    .sort((left, right) => right.id - left.id)[0]

  if (existing) {
    const previous = existing.body.match(/\n<!-- vx-ci-run:(\d+):(\d+) -->\n/)
    if (!previous) {
      throw new Error('Managed CI comment is missing run metadata')
    }
    const previousNumber = positiveInteger(previous[1], 'Previous run number')
    const previousAttempt = positiveInteger(previous[2], 'Previous run attempt')
    if (
      previousNumber > number ||
      (previousNumber === number && previousAttempt > attempt)
    ) {
      return { operation: 'skipped', commentId: existing.id }
    }
    if (existing.body === body) {
      return { operation: 'unchanged', commentId: existing.id }
    }
    await github.rest.repos.updateCommitComment({
      ...context.repo,
      comment_id: existing.id,
      body
    })
    return { operation: 'updated', commentId: existing.id }
  }

  const response = await github.rest.repos.createCommitComment({
    ...context.repo,
    commit_sha: context.sha,
    body
  })
  return { operation: 'created', commentId: response.data.id }
}

const main = async ({ github, context, core }) => {
  const result = await updateSummary({
    github,
    context,
    summary: readFileSync(process.env.CI_SUMMARY_PATH, 'utf8'),
    kind: process.env.CI_SUMMARY_KIND,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    runNumber: process.env.GITHUB_RUN_NUMBER,
    runAttempt: process.env.GITHUB_RUN_ATTEMPT
  })
  core.info(`CI summary ${result.operation} (comment ${result.commentId})`)
}

module.exports = { main, updateSummary }
