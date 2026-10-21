'use strict'

const { appendFileSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const resolveNodeVersionFile = ({ workspace, appPath = '' }) => {
  if (
    typeof appPath !== 'string' ||
    (appPath !== '' &&
      (!/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(appPath) ||
        appPath.split('/').some(part => part === '.' || part === '..')))
  )
    throw new Error('APP_PATH must be a relative source app directory')

  const files = appPath
    ? [`${appPath}/package.json`, 'package.json']
    : ['package.json']
  for (const file of files) {
    const manifest = JSON.parse(readFileSync(join(workspace, file), 'utf8'))
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      throw new Error(`Expected a package.json object in ${file}`)
    const requirement =
      manifest.volta?.node !== undefined
        ? manifest.volta.node
        : manifest.engines?.node
    if (requirement === undefined) continue
    if (
      typeof requirement !== 'string' ||
      !requirement.trim() ||
      /[\r\n]/.test(requirement)
    )
      throw new Error(`Invalid Node runtime declaration in ${file}`)
    return file
  }

  return ''
}

if (require.main === module) {
  const file = resolveNodeVersionFile({
    workspace: process.env.GITHUB_WORKSPACE,
    appPath: process.env.SOURCE_APP_PATH
  })
  appendFileSync(process.env.GITHUB_OUTPUT, `node_version_file=${file}\n`)
  console.log(
    file
      ? `Node runtime selected from ${file}`
      : 'No Node runtime declaration; using the Node 24 compatibility fallback'
  )
}

module.exports = { resolveNodeVersionFile }
