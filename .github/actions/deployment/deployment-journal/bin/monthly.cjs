'use strict'

const categories = [
  'apps',
  'cdns',
  'internals',
  'platforms',
  'pods',
  'suites',
  'widgets'
]
const validateCategory = category => {
  if (!categories.includes(category))
    throw new Error('Invalid deployment category')
  return category
}
const recordMonth = record =>
  new Date(record.finished_at).toISOString().slice(0, 7)
const marker = (category, month) =>
  `<!-- vx-deployment-monthly:${validateCategory(category)}:${month} -->`
const rotationComplete = '<!-- vx-monthly-rotation-complete -->'
const label = category => `deployment-history:${validateCategory(category)}`
const historyBody = (category, month) =>
  [
    marker(category, month),
    `Deployment history for **${category}** in **${month}** (UTC completion month).`,
    '',
    'Each comment records an app, environment/Production target, source SHA, result, completion time and deployment URLs.',
    'Dev, QA, Preview and Production promotions and routine rebuilds are included. TVA remains on source commits.',
    'Current successful SHAs are stored in the linked app state issues; monthly rotation never resets deployment state.'
  ].join('\n')
const ensureMonthlyJournal = async ({ github, target, record }) => {
  const category = validateCategory(record.category),
    month = recordMonth(record),
    bodyMarker = marker(category, month)
  // The workflow holds a per-category lock only while locating/creating the monthly issue.
  const issues = await github.paginate(github.rest.issues.listForRepo, {
    ...target,
    state: 'all',
    labels: label(category),
    since: `${month}-01T00:00:00Z`,
    per_page: 100
  })
  let journal = issues
    .filter(
      issue =>
        !issue.pull_request &&
        issue.user?.type === 'Bot' &&
        issue.body?.startsWith(bodyMarker)
    )
    .sort((a, b) => a.number - b.number)[0]
  if (journal?.body.includes(rotationComplete)) return journal
  if (!journal) {
    try {
      await github.rest.issues.getLabel({ ...target, name: label(category) })
    } catch (error) {
      if (error.status !== 404) throw error
      try {
        await github.rest.issues.createLabel({
          ...target,
          name: label(category),
          color: '1d76db',
          description: `Monthly deployment history for ${category}`
        })
      } catch (createError) {
        if (createError.status !== 422) throw createError
      }
    }
    const { data } = await github.rest.issues.create({
      ...target,
      title: `Deployment log | ${category} | ${month}`,
      body: historyBody(category, month),
      labels: [label(category)]
    })
    journal = data
  }
  const open = await github.paginate(github.rest.issues.listForRepo, {
    ...target,
    state: 'open',
    labels: label(category),
    per_page: 100
  })
  let newer = false
  for (const issue of open) {
    if (issue.pull_request || issue.user?.type !== 'Bot') continue
    const match = issue.body?.match(
      /^<!-- vx-deployment-monthly:([a-z]+):(\d{4}-\d{2}) -->/
    )
    if (!match || match[1] !== category) continue
    if (match[2] > month) newer = true
    if (match[2] < month)
      await github.rest.issues.update({
        ...target,
        issue_number: issue.number,
        state: 'closed'
      })
  }
  if (newer) {
    await github.rest.issues.update({
      ...target,
      issue_number: journal.number,
      state: 'closed'
    })
    journal.state = 'closed'
  }
  journal.body = journal.body + '\n\n' + rotationComplete
  await github.rest.issues.update({
    ...target,
    issue_number: journal.number,
    body: journal.body
  })
  return journal
}
const getMonthlyJournal = async ({ github, target, number, record }) => {
  if (!Number.isSafeInteger(Number(number)) || Number(number) <= 0)
    throw new Error('Invalid monthly journal issue number')
  const { data } = await github.rest.issues.get({
    ...target,
    issue_number: Number(number)
  })
  if (
    data.pull_request ||
    data.user?.type !== 'Bot' ||
    !data.body?.startsWith(marker(record.category, recordMonth(record)))
  )
    throw new Error(
      'Monthly issue does not match the deployment category and month'
    )
  return data
}
const findHistoryRecord = async ({
  github,
  target,
  journal,
  record,
  parseRecord,
  recover = false
}) => {
  for (
    let page = Math.max(1, Math.ceil((journal.comments || 0) / 100));
    page >= 1;
    page--
  ) {
    const { data } = await github.rest.issues.listComments({
      ...target,
      issue_number: journal.number,
      per_page: 100,
      page
    })
    const comment = data.find(
      item =>
        item.user?.type === 'Bot' &&
        parseRecord(item)?.event_id === record.event_id
    )
    if (comment) return comment
    if (!recover) break
  }
  return undefined
}
module.exports = {
  validateCategory,
  recordMonth,
  historyBody,
  ensureMonthlyJournal,
  getMonthlyJournal,
  findHistoryRecord
}
