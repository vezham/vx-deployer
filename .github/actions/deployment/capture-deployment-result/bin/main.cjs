'use strict'
const { createHash } = require('node:crypto')
const { mkdtempSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')
const { buildRecord } = require('../../deployment-journal/bin/journal.cjs')
const captureResult = ({ context, core, env = process.env }) => {
  const record = buildRecord({ context, env })
  const directory = mkdtempSync(join(env.RUNNER_TEMP, 'web-deployment-result-'))
  const file = join(directory, 'result.json')
  writeFileSync(file, JSON.stringify(record) + '\n', { mode: 0o600 })
  const suffix = createHash('sha256')
    .update(record.event_id)
    .digest('hex')
    .slice(0, 20)
  core.setOutput('path', directory)
  core.setOutput('name', `result-${record.app.slice(0, 40)}-${suffix}`)
}
module.exports = { captureResult }
