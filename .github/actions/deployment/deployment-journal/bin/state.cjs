'use strict'

const {
  deploymentEnvironment
} = require('../../resolve-web-app/bin/config.cjs')
const prefix = '<!-- vx-deployment-state:'
const emptyState = () => ({ schema: 1, destinations: {} })
const parseState = (body, validate) => {
  const start = body?.indexOf(prefix) ?? -1
  if (start === -1) return null
  const end = body.indexOf(' -->', start)
  try {
    const state = JSON.parse(body.slice(start + prefix.length, end))
    if (
      end < 0 ||
      state.schema !== 1 ||
      !state.destinations ||
      typeof state.destinations !== 'object' ||
      Array.isArray(state.destinations)
    )
      throw new Error()
    for (const [key, entry] of Object.entries(state.destinations)) {
      if (
        !/^(dev|qa|preview|production(?:\/[a-z0-9][a-z0-9-]*)?)$/.test(key) ||
        !entry ||
        typeof entry !== 'object'
      )
        throw new Error()
      for (const field of ['latest_attempt', 'latest_success'])
        if (entry[field]) {
          const item = entry[field]
          const link = new URL(item.entry_url)
          if (
            !['https:', 'http:'].includes(link.protocol) ||
            link.username ||
            link.password
          )
            throw new Error()
          if (
            !validate(item.record) ||
            typeof item.entry_url !== 'string' ||
            !Number.isSafeInteger(item.entry_id) ||
            item.entry_id <= 0 ||
            deploymentEnvironment(
              item.record.environment,
              item.record.production_target
            ) !== key ||
            (field === 'latest_success' && item.record.status !== 'success')
          )
            throw new Error()
        }
    }
    if (state.pending && !validate(state.pending)) throw new Error()
    if (
      state.pending_history &&
      (!state.pending ||
        !Number.isSafeInteger(state.pending_history.issue_number) ||
        state.pending_history.issue_number <= 0 ||
        !state.pending.category)
    )
      throw new Error()
    return state
  } catch {
    throw new Error(
      'Deployment state index is invalid; repair the journal before rebuilding'
    )
  }
}
const addEntry = (state, record, entryUrl, entryId) => {
  const key = deploymentEnvironment(
    record.environment,
    record.production_target
  )
  const destination = state.destinations[key] || {}
  const entry = { record, entry_url: entryUrl, entry_id: entryId }
  const newer = previous =>
    !previous ||
    Date.parse(record.finished_at) > Date.parse(previous.record.finished_at) ||
    (Date.parse(record.finished_at) ===
      Date.parse(previous.record.finished_at) &&
      entryId > previous.entry_id)
  if (newer(destination.latest_attempt)) destination.latest_attempt = entry
  if (record.status === 'success' && newer(destination.latest_success))
    destination.latest_success = entry
  state.destinations[key] = destination
}
const stateBody = (header, state) => {
  const rows = Object.entries(state.destinations)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => {
      const latest = value.latest_attempt,
        success = value.latest_success
      return `| ${key} | ${latest?.record.kind || '—'} | ${latest?.record.status || '—'} | ${success?.record.sha.slice(0, 7) || '—'} | ${success?.record.finished_at || '—'} | ${success ? `[Entry](${success.entry_url.replace(/[()|]/g, character => `%${character.charCodeAt(0).toString(16)}`)})` : '—'} |`
    })
  const body = [
    header,
    '',
    `${prefix}${JSON.stringify(state)} -->`,
    '',
    '## Current deployment state',
    '',
    '| Destination | Attempt type | Latest attempt | Successful SHA | Finished (UTC) | Journal entry |',
    '| --- | --- | --- | --- | --- | --- |',
    ...rows
  ].join('\n')
  if (body.length > 60000)
    throw new Error(
      'Deployment state exceeds the issue body budget; reduce per-app targets'
    )
  return body
}
module.exports = { emptyState, parseState, addEntry, stateBody }
