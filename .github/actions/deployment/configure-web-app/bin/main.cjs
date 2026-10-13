'use strict'

const { createHash } = require('node:crypto')
const {
  chmodSync,
  existsSync,
  readFileSync,
  realpathSync,
  writeFileSync
} = require('node:fs')
const { resolve, sep } = require('node:path')
const {
  mergeBuildConfig,
  normalizeProductionTarget,
  validateRelativePath
} = require('../../resolve-web-app/bin/config.cjs')

const envLine = (key, input) => {
  const value = String(input)
  if (value.includes('\0'))
    throw new Error(`Build variable ${key} contains an invalid character`)
  const quote = ["'", '"', '`'].find(candidate => !value.includes(candidate))
  if (!quote)
    throw new Error(
      `Build variable ${key} cannot be represented safely in an env file`
    )
  return `${key}=${quote}${value}${quote}`
}

const configureWebApp = ({ core, env = process.env }) => {
  const appPath = validateRelativePath(env.APP_PATH)
  const workspace = realpathSync(env.GITHUB_WORKSPACE)
  const directory = realpathSync(resolve(workspace, appPath))
  if (!directory.startsWith(workspace + sep))
    throw new Error('App directory must remain inside the source repository')
  if (
    !/^[a-z0-9][a-z0-9-]*$/.test(env.APP_NAME) ||
    !/^[a-f0-9]{40}$/i.test(env.SOURCE_SHA)
  )
    throw new Error('Invalid app ID or source SHA')
  const target = normalizeProductionTarget(
    env.PRODUCTION_TARGET || '',
    env.TRACK_ENV
  )
  const config = mergeBuildConfig([
    {
      values: JSON.parse(env.BUILD_VALUES || '{}'),
      secret_values: JSON.parse(env.BUILD_SECRET_VALUES || '{}')
    }
  ])
  const available = JSON.parse(env.AVAILABLE_SECRETS || '{}')
  const variables = { ...config.values }
  for (const [key, name] of Object.entries(config.secret_values)) {
    const value = available[name]
    if (typeof value !== 'string' || !value)
      throw new Error(`Required build secret is missing: ${name}`)
    core.setSecret(value)
    variables[key] = value
  }
  Object.assign(variables, {
    V_APP_NAME: env.APP_NAME,
    V_APP_ENV: env.APP_ENV,
    V_RELEASE_CHANNEL: env.RELEASE_CHANNEL,
    V_IS_DEBUG: env.IS_DEBUG,
    V_PRODUCTION_TARGET: target
  })
  const lines = Object.entries(variables).map(([key, value]) =>
    envLine(key, value)
  )
  const file = resolve(directory, '.env')
  if (existsSync(file) && realpathSync(file) !== file)
    throw new Error('Refusing to replace a symlinked env file')
  const original = existsSync(file) ? readFileSync(file, 'utf8').trimEnd() : ''
  writeFileSync(
    file,
    (original ? original + '\n' : '') + lines.join('\n') + '\n',
    { mode: 0o600 }
  )
  chmodSync(file, 0o600)
  for (const [key, value] of Object.entries(variables))
    core.exportVariable(key, String(value))
  const identity = `${env.APP_NAME}-${env.TRACK_ENV}-${target && target !== 'default' ? target + '-' : ''}${env.SOURCE_SHA.slice(0, 7)}`
  const channel =
    identity.length <= 63
      ? identity
      : `${identity.slice(0, 48)}-${createHash('sha256').update(identity).digest('hex').slice(0, 14)}`
  core.exportVariable('DX_APP_URL', channel)
}

module.exports = { configureWebApp, envLine }
