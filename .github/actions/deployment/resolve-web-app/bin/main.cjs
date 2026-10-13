'use strict'

const yaml = require('js-yaml')

const environments = ['tva', 'dev', 'qa', 'preview', 'production']
const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const validateCatalog = catalog => {
  if (
    !isObject(catalog) ||
    catalog.schema !== 1 ||
    !isObject(catalog.apps) ||
    !isObject(catalog.defaults)
  ) {
    throw new Error(
      'Expected a schema-1 web app registry with apps and defaults'
    )
  }
}

const resolveWebApp = (catalog, { app, caller = '', environment = '' }) => {
  validateCatalog(catalog)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app) || !Object.hasOwn(catalog.apps, app)) {
    throw new Error(`Unknown web app: ${app}`)
  }
  if (caller && !['timeline', '-scheduler'].includes(caller)) {
    throw new Error(
      'Automatic TVA builds require CALLER=timeline or -scheduler'
    )
  }
  if (caller && environment)
    throw new Error('Do not combine CALLER with a promotion APP_ENV')
  const trackEnvironment = caller ? 'tva' : environment
  if (
    !environments.includes(trackEnvironment) ||
    (!caller && trackEnvironment === 'tva')
  ) {
    throw new Error('Promotion APP_ENV must be dev, qa, preview or production')
  }
  const config = catalog.apps[app]
  if (!isObject(config) || config.enabled === false)
    throw new Error(`Web app is disabled or invalid: ${app}`)
  if (
    typeof config.category !== 'string' ||
    !/^[a-z0-9][a-z0-9-]*$/.test(config.category)
  )
    throw new Error(`Invalid category for ${app}`)
  if (!/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(config.repository)) {
    throw new Error(`Invalid repository for ${app}`)
  }
  if (
    typeof config.path !== 'string' ||
    !/^[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)*$/.test(config.path) ||
    config.path.split('/').some(part => part === '.' || part === '..')
  ) {
    throw new Error(`Invalid relative app path for ${app}`)
  }
  const settings = {
    ...catalog.defaults.environments?.[trackEnvironment],
    ...config.environments?.[trackEnvironment]
  }
  if (
    !['dev', 'qa', 'preview', 'production'].includes(
      settings.build_environment
    ) ||
    !['canary', 'beta', 'stable'].includes(settings.release_channel) ||
    typeof settings.debug !== 'boolean'
  ) {
    throw new Error(`Invalid ${trackEnvironment} build settings for ${app}`)
  }
  const credential = config.credential_secrets?.[trackEnvironment]
  if (
    typeof credential !== 'string' ||
    !/^[A-Z_][A-Z0-9_]*$/.test(credential)
  ) {
    throw new Error(
      `Missing or invalid ${trackEnvironment} credential secret name for ${app}`
    )
  }
  return {
    app,
    repository: config.repository,
    path: config.path,
    track_environment: trackEnvironment,
    build_environment: settings.build_environment,
    release_channel: settings.release_channel,
    debug: String(settings.debug),
    credential_secret: credential,
    git_ref: caller === '-scheduler' ? 'timeline' : caller
  }
}

const listWebApps = (catalog, category) => {
  validateCatalog(catalog)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(category))
    throw new Error('Invalid web app category')
  return Object.keys(catalog.apps)
    .filter(app => {
      const config = catalog.apps[app]
      if (config?.enabled === false || config?.category !== category)
        return false
      resolveWebApp(catalog, { app, environment: 'production' })
      return true
    })
    .sort()
}

const parseCatalog = source => {
  const catalog = yaml.load(source, { schema: yaml.JSON_SCHEMA })
  validateCatalog(catalog)
  return catalog
}

const main = async ({ github, core, env = process.env }) => {
  const repository = env.CONFIG_REPO
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
    !env.CONFIG_REF
  ) {
    throw new Error('CONFIG_REPO and CONFIG_REF are required')
  }
  if (Boolean(env.APP) === Boolean(env.CATEGORY))
    throw new Error('Provide exactly one of APP or CATEGORY')
  const [owner, repo] = repository.split('/')
  const { data } = await github.rest.repos.getContent({
    owner,
    repo,
    path: env.CONFIG_PATH,
    ref: env.CONFIG_REF
  })
  if (
    data.type !== 'file' ||
    data.encoding !== 'base64' ||
    typeof data.content !== 'string'
  ) {
    throw new Error('The web app registry must be a YAML file')
  }
  const catalog = parseCatalog(
    Buffer.from(data.content, 'base64').toString('utf8')
  )
  if (env.CATEGORY) {
    core.setOutput('apps', JSON.stringify(listWebApps(catalog, env.CATEGORY)))
    return
  }
  const resolved = resolveWebApp(catalog, {
    app: env.APP,
    caller: env.CALLER,
    environment: env.APP_ENV
  })
  for (const [name, value] of Object.entries(resolved))
    core.setOutput(name, value)
}

module.exports = { parseCatalog, resolveWebApp, listWebApps, main }
