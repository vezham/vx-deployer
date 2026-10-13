'use strict'

const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
const idPattern = /^[a-z0-9][a-z0-9-]*$/
const keyPattern = /^[A-Z_][A-Z0-9_]*$/
const reservedKeys = [
  'V_APP_NAME',
  'V_APP_ENV',
  'V_RELEASE_CHANNEL',
  'V_IS_DEBUG',
  'V_PRODUCTION_TARGET'
]

const validateRelativePath = value => {
  if (
    typeof value !== 'string' ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(value) ||
    value.split('/').some(part => part === '.' || part === '..')
  )
    throw new Error('App path must be relative to the source repository')
  return value
}

const normalizeProductionTarget = (target = '', environment) => {
  if (typeof target !== 'string')
    throw new Error('PRODUCTION_TARGET must be a string')
  if (environment !== 'production') {
    if (target)
      throw new Error('PRODUCTION_TARGET is only valid for Production')
    return ''
  }
  const normalized = target || 'default'
  if (!idPattern.test(normalized))
    throw new Error('Invalid Production target ID')
  return normalized
}

const deploymentEnvironment = (environment, target = '') => {
  const normalized = normalizeProductionTarget(target, environment)
  return environment === 'production' && normalized !== 'default'
    ? `production/${normalized}`
    : environment
}

const getProductionTargets = config => {
  if (config.production_targets === undefined) return ['default']
  if (
    !isObject(config.production_targets) ||
    !Object.keys(config.production_targets).length
  )
    throw new Error('production_targets must contain at least one target')
  for (const [target, settings] of Object.entries(config.production_targets)) {
    if (!idPattern.test(target) || !isObject(settings))
      throw new Error('Invalid Production target configuration')
    if (
      typeof settings.credential_secret !== 'string' ||
      !keyPattern.test(settings.credential_secret)
    )
      throw new Error(
        `Production target ${target} requires a credential_secret name`
      )
  }
  return Object.keys(config.production_targets).sort()
}

const mergeBuildConfig = layers => {
  const values = {},
    secretValues = {}
  for (const layer of layers.filter(layer => layer !== undefined)) {
    if (!isObject(layer))
      throw new Error('Expected an app configuration object')
    for (const field of ['values', 'secret_values']) {
      if (layer[field] === undefined) continue
      if (!isObject(layer[field])) throw new Error(`${field} must be a mapping`)
      for (const [key, value] of Object.entries(layer[field])) {
        if (!keyPattern.test(key) || reservedKeys.includes(key))
          throw new Error(`Invalid or reserved build variable: ${key}`)
        if (
          Object.hasOwn(layer.values || {}, key) &&
          Object.hasOwn(layer.secret_values || {}, key)
        )
          throw new Error(
            `Build variable ${key} cannot be both a value and a secret reference`
          )
        if (field === 'secret_values') {
          if (typeof value !== 'string' || !keyPattern.test(value))
            throw new Error(`Invalid secret name for ${key}`)
          secretValues[key] = value
          delete values[key]
        } else {
          if (
            !['string', 'boolean', 'number'].includes(typeof value) ||
            (typeof value === 'number' && !Number.isFinite(value))
          )
            throw new Error(
              `Build variable ${key} must be a string, number or boolean`
            )
          values[key] = value
          delete secretValues[key]
        }
      }
    }
  }
  return {
    values,
    secret_values: secretValues
  }
}

module.exports = {
  normalizeProductionTarget,
  deploymentEnvironment,
  getProductionTargets,
  mergeBuildConfig,
  validateRelativePath
}
