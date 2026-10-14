const fs = require('node:fs')

const count = value =>
  Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unavailable'
const validScore = value => Number.isFinite(value) && value >= 0 && value <= 100

const renderReports = (reports, metadata) => {
  const comments = {}
  const titles = { fallow: 'Fallow', 'react-doctor': 'React Doctor' }
  for (const name of Object.keys(titles)) {
    const report = reports.find(item => item?.tool === name)
    const summary = report?.summary ?? {}
    const score = report?.score ?? summary.score
    const minimumScore = report?.minimumScore ?? 90
    const available =
      report?.completed === true &&
      validScore(score) &&
      validScore(minimumScore)
    const passed = available && score >= minimumScore
    const status = !available
      ? '⚠️ Unavailable'
      : passed
        ? '🟢 Passed'
        : '🔴 Failed'
    const lines = [
      `## Audit: ${titles[name]} — ${status}`,
      '',
      available
        ? passed
          ? 'The required score gate passed.'
          : 'The score is below the required minimum; the QA audit gate fails.'
        : 'The audit failed or its score is unavailable; the QA audit gate cannot pass.',
      '',
      '| Metric | Result |',
      '| --- | ---: |',
      `| ${name === 'fallow' ? 'Average maintainability' : 'Score'} | ${validScore(score) && report?.completed === true ? `${score}/100` : 'Unavailable'} |`,
      `| Required minimum | ${validScore(minimumScore) ? `${minimumScore}/100` : 'Unavailable'} |`
    ]
    if (report?.completed === true) {
      if (name === 'fallow') {
        lines.push(
          `| Overall health (informational) | ${validScore(report.healthScore) ? `${report.healthScore}/100` : 'Unavailable'} |`
        )
        lines.push(`| Total findings | ${count(summary.total_issues)} |`)
        for (const [key, value] of Object.entries(summary)) {
          if (
            key !== 'total_issues' &&
            /^[a-z_]+$/.test(key) &&
            Number.isSafeInteger(value) &&
            value > 0
          ) {
            lines.push(`| ${key.replaceAll('_', ' ')} | ${value} |`)
          }
        }
      } else {
        for (const [label, key] of [
          ['Errors', 'errorCount'],
          ['Warnings', 'warningCount'],
          ['Affected files', 'affectedFileCount']
        ])
          lines.push(`| ${label} | ${count(summary[key])} |`)
      }
    }
    lines.push(
      '',
      `🕒 Updated: ${metadata.now}`,
      '',
      `[Workflow run](${metadata.serverUrl}/${metadata.repository}/actions/runs/${metadata.runId}/attempts/${metadata.runAttempt}) · Attempt ${metadata.runAttempt}`,
      '',
      `Full reports: vx-ci-artifact-${metadata.job}-${metadata.runAttempt} (30-day retention). These counts remain after artifact expiry.`,
      ''
    )
    comments[name] = lines.join('\n')
  }
  return { comments, markdown: Object.values(comments).join('\n---\n\n') }
}

const main = (env = process.env) => {
  let reports = []
  try {
    const parsed = JSON.parse(fs.readFileSync(env.AUDIT_REPORT, 'utf8'))
    if (Array.isArray(parsed)) reports = parsed
  } catch {
    // vx-bot/NOTE: A failed audit or setup step must publish unavailable results.
  }
  const { comments, markdown } = renderReports(reports, {
    now: new Date()
      .toISOString()
      .replace('T', ' ')
      .replace(/\.\d{3}Z$/, ' UTC'),
    serverUrl: env.GITHUB_SERVER_URL,
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT || '1',
    job: env.GITHUB_JOB
  })
  fs.writeFileSync(env.AUDIT_MARKDOWN, markdown)
  for (const [name, body] of Object.entries(comments)) {
    const file = `${env.AUDIT_MARKDOWN}.${name}.md`
    fs.writeFileSync(file, body)
    if (env.GITHUB_OUTPUT) {
      fs.appendFileSync(
        env.GITHUB_OUTPUT,
        `${name.replaceAll('-', '_')}_path=${file}\n`
      )
    }
  }
  if (env.GITHUB_STEP_SUMMARY)
    fs.appendFileSync(env.GITHUB_STEP_SUMMARY, markdown)
}

module.exports = { main, renderReports }
if (require.main === module) main()
