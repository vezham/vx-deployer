'use strict'

const { appendFileSync } = require('node:fs')
const { relative, resolve } = require('node:path')

const resolvePackagePath = workspace => {
  if (!workspace) throw new Error('GITHUB_WORKSPACE is required')
  return relative(workspace, resolve(__dirname, '../package.json'))
}

if (require.main === module) {
  const packagePath = resolvePackagePath(process.env.GITHUB_WORKSPACE)
  if (/[\r\n]/.test(packagePath)) throw new Error('Invalid action package path')
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `package_json_file=${packagePath}\n`
  )
}

module.exports = { resolvePackagePath }
