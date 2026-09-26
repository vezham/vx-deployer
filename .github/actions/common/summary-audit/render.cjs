const fs = require('node:fs')

const count = value =>
  Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unavailable'
let reports = []
try {
  const parsed = JSON.parse(fs.readFileSync(process.env.AUDIT_REPORT, 'utf8'))
  if (Array.isArray(parsed)) reports = parsed
} catch {
  // vx-bot/NOTE: Publish missing results when an audit or setup step failed.
}
const sections = []
const comments = {}
const footer = `[Workflow run](${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}) · Attempt ${process.env.GITHUB_RUN_ATTEMPT || '1'}\n\nFull reports: vx-ci-artifact-${process.env.GITHUB_JOB}-${process.env.GITHUB_RUN_ATTEMPT || '1'} (30-day retention). These counts remain after artifact expiry.`
for (const name of ['fallow', 'react-doctor']) {
  const report = reports.find(item => item?.tool === name)
  const lines = [
    `## Audit: ${name}`,
    '',
    'Findings and scores are advisory.',
    ''
  ]
  if (report?.completed !== true) {
    lines.push('⚠️ Audit failed or results are unavailable.', '')
  } else {
    const summary = report.summary ?? {}
    const score = report.score ?? summary.score
    const label = name === 'fallow' ? 'Average maintainability' : 'Score'
    const value =
      Number.isFinite(score) && score >= 0 && score <= 100
        ? `${score}/100`
        : name === 'react-doctor'
          ? 'Unavailable — scoring API did not return a score'
          : 'Unavailable'
    lines.push(`**${label}: ${value}**`, '')
    if (name === 'fallow') {
      const health = report.healthScore
      const healthValue =
        Number.isFinite(health) && health >= 0 && health <= 100
          ? `${health}/100`
          : 'Unavailable'
      lines.push(`**Overall health: ${healthValue} (informational)**`, '')
    }
    lines.push('Completed.', '', '| Metric | Count |', '| --- | ---: |')
    if (name === 'fallow') {
      lines.push(`| Total findings | ${count(summary.total_issues)} |`)
      for (const [key, value] of Object.entries(summary)) {
        if (
          key !== 'total_issues' &&
          /^[a-z_]+$/.test(key) &&
          Number.isSafeInteger(value) &&
          value > 0
        )
          lines.push(`| ${key.replaceAll('_', ' ')} | ${value} |`)
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
  lines.push('', '---', '', footer, '')
  const body = lines.join('\n')
  comments[name] = `<!-- vx-audit:${name} -->\n${body}`
  sections.push(body)
}
const markdown = sections.join('\n---\n\n')
fs.writeFileSync(`${process.env.AUDIT_MARKDOWN}.json`, JSON.stringify(comments))
fs.writeFileSync(process.env.AUDIT_MARKDOWN, markdown)
if (process.env.GITHUB_STEP_SUMMARY)
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
