'use strict'

const weekdays = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
const timezone = 'Asia/Kolkata'
const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const validateRule = rule => {
  if (
    !isObject(rule) ||
    (rule.enabled !== undefined && typeof rule.enabled !== 'boolean')
  )
    throw new Error('Schedule must be an object with a boolean enabled flag')
  const allowed = {
    daily: ['enabled', 'frequency'],
    weekly: ['enabled', 'frequency', 'days'],
    monthly: ['enabled', 'frequency', 'day']
  }
  if (
    !Object.hasOwn(allowed, rule.frequency) ||
    Object.keys(rule).some(key => !allowed[rule.frequency].includes(key))
  )
    throw new Error(
      'Schedule requires daily, weekly or monthly frequency with matching fields'
    )
  if (
    rule.frequency === 'weekly' &&
    (!Array.isArray(rule.days) ||
      !rule.days.length ||
      rule.days.some(day => !weekdays.includes(day)) ||
      new Set(rule.days).size !== rule.days.length)
  )
    throw new Error('Weekly schedule requires unique days from sun through sat')
  if (
    rule.frequency === 'monthly' &&
    (!Number.isInteger(rule.day) || rule.day < 1 || rule.day > 31)
  )
    throw new Error('Monthly schedule requires a day from 1 through 31')
  return { enabled: true, ...rule }
}
const resolveSchedule = (defaults, override) => {
  const base = defaults === undefined ? undefined : validateRule(defaults)
  if (override === undefined) {
    if (!base)
      throw new Error(
        'Scheduled discovery requires defaults.schedule or a complete app schedule'
      )
    return base
  }
  if (
    isObject(override) &&
    Object.keys(override).length === 1 &&
    typeof override.enabled === 'boolean'
  ) {
    if (!base)
      throw new Error('An enabled-only schedule requires defaults.schedule')
    return { ...base, enabled: override.enabled }
  }
  return {
    ...validateRule(override),
    enabled: override.enabled ?? base?.enabled ?? true
  }
}
const calendarDate = timestamp => {
  if (
    typeof timestamp !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T/.test(timestamp) ||
    !Number.isFinite(Date.parse(timestamp))
  )
    throw new Error('Invalid scheduler run timestamp')
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short'
    })
      .formatToParts(new Date(timestamp))
      .map(part => [part.type, part.value])
  )
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    day: Number(parts.day),
    weekday: parts.weekday.toLowerCase()
  }
}
const dueOn = (schedule, date) =>
  schedule.enabled &&
  (schedule.frequency === 'daily' ||
    (schedule.frequency === 'weekly' && schedule.days.includes(date.weekday)) ||
    (schedule.frequency === 'monthly' && schedule.day === date.day))
const selectDueDeployments = ({ defaults, apps, deployments, timestamp }) => {
  const date = calendarDate(timestamp)
  const due = new Map()
  for (const entry of deployments) {
    if (!due.has(entry.app))
      due.set(
        entry.app,
        dueOn(resolveSchedule(defaults, apps[entry.app].schedule), date)
      )
  }
  return {
    date: date.date,
    deployments: deployments.filter(entry => due.get(entry.app))
  }
}
const readRunTimestamp = async ({ github, env }) => {
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(env.GITHUB_REPOSITORY || '') ||
    env.GITHUB_REPOSITORY.split('/').some(part => part === '.' || part === '..')
  )
    throw new Error('Scheduled discovery requires the workflow repository')
  const runId = Number(env.GITHUB_RUN_ID)
  if (!Number.isSafeInteger(runId) || runId <= 0)
    throw new Error('Scheduled discovery requires a valid workflow run ID')
  const [owner, repo] = env.GITHUB_REPOSITORY.split('/')
  const { data } = await github.rest.actions.getWorkflowRun({
    owner,
    repo,
    run_id: runId
  })
  calendarDate(data.created_at)
  return data.created_at
}
module.exports = {
  resolveSchedule,
  calendarDate,
  selectDueDeployments,
  readRunTimestamp
}
