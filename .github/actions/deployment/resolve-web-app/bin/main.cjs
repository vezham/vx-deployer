'use strict'

const yaml = require('js-yaml')
const {
  resolveSchedule,
  selectDueDeployments,
  readRunTimestamp
} = require('./calendar.cjs')
const { respectRateLimits } = require('../../deployment-journal/bin/api.cjs')
const { buildBatches, discoverJournalIssues } = require('./schedule.cjs')
const { getPromotionPath } = require('../../validate-promotion/bin/policy.cjs')

const {
  getProductionTargets,
  normalizeProductionTarget,
  mergeBuildConfig
} = require('./config.cjs')

const environments = ['tva', 'dev', 'qa', 'preview', 'production']
const isObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const groups = {
  apps: 'apps',
  'apps-cdns': 'cdns',
  'apps-internals': 'internals',
  'apps-platforms': 'platforms',
  'apps-pods': 'pods',
  'apps-suites': 'suites',
  'apps-widgets': 'widgets'
}

const getCatalogApps = catalog => {
  if (!isObject(catalog) || catalog.schema !== 2 || !isObject(catalog.defaults))
    throw new Error(
      'Expected a grouped schema-2 web app registry with defaults'
    )

  if (catalog.defaults.schedule !== undefined)
    resolveSchedule(catalog.defaults.schedule)
  const apps = Object.create(null)
  let groupCount = 0
  for (const [group, entries] of Object.entries(catalog)) {
    if (group === 'schema' || group === 'defaults') continue
    if (!Object.hasOwn(groups, group) || !isObject(entries))
      throw new Error(`Unknown or invalid web app group: ${group}`)
    groupCount++
    for (const [app, config] of Object.entries(entries)) {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(app) || !isObject(config))
        throw new Error(`Invalid web app entry: ${group}/${app}`)
      if (Object.hasOwn(apps, app))
        throw new Error(`Duplicate web app ID across groups: ${app}`)
      if (Object.hasOwn(config, 'category'))
        throw new Error(
          `Remove category from ${app}; it is derived from ${group}`
        )
      if (config.schedule !== undefined)
        resolveSchedule(catalog.defaults.schedule, config.schedule)
      apps[app] = { ...config, category: groups[group] }
    }
  }
  if (!groupCount) throw new Error('Expected at least one web app group')
  return apps
}

const resolveWebApp = (
  catalog,
  {
    app,
    caller = '',
    callerRepository = '',
    environment = '',
    productionTarget = ''
  }
) => {
  const apps = getCatalogApps(catalog)
  if (!/^[a-z0-9][a-z0-9-]*$/.test(app) || !Object.hasOwn(apps, app)) {
    throw new Error(`Unknown web app: ${app}`)
  }
  if (caller && !['timeline', '-scheduler'].includes(caller)) {
    throw new Error(
      'Automatic TVA builds require CALLER=timeline or -scheduler'
    )
  }
  if (caller && environment)
    throw new Error('Do not combine CALLER with a promotion APP_ENV')
  if (
    caller &&
    (typeof callerRepository !== 'string' ||
      !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(callerRepository))
  )
    throw new Error(
      'TVA requires the calling repository in owner/repository form'
    )
  if (!caller && callerRepository)
    throw new Error('Caller repository is only used for TVA builds')
  const trackEnvironment = caller ? 'tva' : environment
  if (
    !environments.includes(trackEnvironment) ||
    (!caller && trackEnvironment === 'tva')
  ) {
    throw new Error('Promotion APP_ENV must be dev, qa, preview or production')
  }
  const config = apps[app]
  if (!isObject(config) || config.enabled === false)
    throw new Error(`Web app is disabled or invalid: ${app}`)
  const promotionPath = getPromotionPath(config.promotion_path)
  if (!promotionPath.includes(trackEnvironment))
    throw new Error(
      `Cannot promote ${app} to ${trackEnvironment}: destination is not in the app promotion_path (${promotionPath.join(' → ')})`
    )
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
  const target = normalizeProductionTarget(productionTarget, trackEnvironment)
  let targetSettings
  if (trackEnvironment === 'production') {
    const targets = getProductionTargets(config)
    if (!productionTarget && !targets.includes('default'))
      throw new Error(
        `Select a Production target for ${app}: ${targets.join(', ')}`
      )
    if (!targets.includes(target))
      throw new Error(`Unknown Production target for ${app}: ${target}`)
    targetSettings = config.production_targets?.[target]
  }
  const settings = {
    ...catalog.defaults.environments?.[trackEnvironment],
    ...config.environments?.[trackEnvironment],
    ...targetSettings
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
  const credential =
    targetSettings?.credential_secret ||
    config.credential_secrets?.[trackEnvironment]
  const build = mergeBuildConfig([
    catalog.defaults,
    config,
    catalog.defaults.environments?.[trackEnvironment],
    config.environments?.[trackEnvironment],
    targetSettings
  ])
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
    category: config.category,
    repository: caller ? callerRepository : config.repository,
    path: config.path,
    track_environment: trackEnvironment,
    build_environment: settings.build_environment,
    release_channel: settings.release_channel,
    debug: String(settings.debug),
    credential_secret: credential,
    production_target: target,
    values: JSON.stringify(build.values),
    secret_values: JSON.stringify(build.secret_values),
    promotion_path: JSON.stringify(promotionPath),
    git_ref: caller === '-scheduler' ? 'timeline' : caller
  }
}

const planPromotionTargets = (
  catalog,
  { app, environment, productionTarget = '' }
) => {
  const apps = getCatalogApps(catalog)
  if (typeof app !== 'string' || !Object.hasOwn(apps, app))
    throw new Error(`Unknown web app: ${app}`)
  const selected = normalizeProductionTarget(productionTarget, environment)
  const targets =
    environment === 'production' && productionTarget === ''
      ? getProductionTargets(apps[app])
      : [selected]
  if (targets.length > 256)
    throw new Error('Promotion targets exceed the 256-job matrix limit')
  // vx-bot/NOTE: Validate every target before publishing; workers still enforce SHA and promotion order.
  for (const target of targets)
    resolveWebApp(catalog, { app, environment, productionTarget: target })
  return targets
}

const listWebApps = (catalog, category = '') => {
  const apps = getCatalogApps(catalog)
  if (
    typeof category !== 'string' ||
    (category !== '' && !/^[a-z0-9][a-z0-9-]*$/.test(category))
  )
    throw new Error('Invalid web app category')
  return Object.keys(apps)
    .filter(app => {
      const config = apps[app]
      if (
        config?.enabled === false ||
        (category && config?.category !== category)
      )
        return false
      for (const productionTarget of getProductionTargets(config))
        resolveWebApp(catalog, {
          app,
          environment: 'production',
          productionTarget
        })
      return true
    })
    .sort()
}

const listProductionDeployments = (catalog, category) => {
  const entries = getCatalogApps(catalog)
  return listWebApps(catalog, category).flatMap(app =>
    getProductionTargets(entries[app]).map(target => ({
      app,
      target,
      category: entries[app].category
    }))
  )
}

const parseCatalog = source => {
  const catalog = yaml.load(source, { schema: yaml.JSON_SCHEMA })
  getCatalogApps(catalog)
  return catalog
}

const main = async ({ github, core, env = process.env }) => {
  respectRateLimits({ github, core })
  const repository = env.CONFIG_REPO
  if (
    !/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(repository) ||
    !env.CONFIG_REF
  ) {
    throw new Error('CONFIG_REPO and CONFIG_REF are required')
  }
  const allApps = env.ALL_APPS || 'false'
  if (!['true', 'false'].includes(allApps))
    throw new Error('ALL_APPS must be true or false')
  if (
    [Boolean(env.APP), Boolean(env.CATEGORY), allApps === 'true'].filter(
      Boolean
    ).length !== 1
  )
    throw new Error('Provide exactly one of APP, CATEGORY or ALL_APPS=true')
  const scheduledOnly = env.SCHEDULED_ONLY || 'false'
  if (!['true', 'false'].includes(scheduledOnly))
    throw new Error('SCHEDULED_ONLY must be true or false')
  if (scheduledOnly === 'true' && env.APP)
    throw new Error('SCHEDULED_ONLY requires discovery, not APP')
  const expandPromotionTargets = env.EXPAND_PROMOTION_TARGETS || 'false'
  if (!['true', 'false'].includes(expandPromotionTargets))
    throw new Error('EXPAND_PROMOTION_TARGETS must be true or false')
  if (
    expandPromotionTargets === 'true' &&
    (!env.APP || env.CALLER || scheduledOnly === 'true')
  )
    throw new Error(
      'EXPAND_PROMOTION_TARGETS requires APP promotion discovery without CALLER or SCHEDULED_ONLY'
    )
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
  if (expandPromotionTargets === 'true') {
    const targets = planPromotionTargets(catalog, {
      app: env.APP,
      environment: env.APP_ENV,
      productionTarget: env.PRODUCTION_TARGET || ''
    })
    core.setOutput('promotion_targets', JSON.stringify(targets))
    return
  }
  if (env.CATEGORY || allApps === 'true') {
    let deployments = listProductionDeployments(catalog, env.CATEGORY || '')
    if (scheduledOnly === 'true') {
      if (catalog.defaults.schedule === undefined)
        throw new Error('Scheduled discovery requires defaults.schedule')
      const timestamp = await readRunTimestamp({ github, env })
      const selection = selectDueDeployments({
        defaults: catalog.defaults.schedule,
        apps: getCatalogApps(catalog),
        deployments,
        timestamp
      })
      deployments = selection.deployments
      core.info?.(
        `Schedule date ${selection.date} (Asia/Kolkata): ${deployments.length} targets due`
      )
    }
    const scheduled =
      env.JOURNAL_REPO && deployments.length
        ? await discoverJournalIssues({
            github,
            journalRepository: env.JOURNAL_REPO,
            deployments,
            apps: getCatalogApps(catalog)
          })
        : deployments
    const batches = buildBatches(scheduled)
    core.setOutput(
      'apps',
      JSON.stringify([...new Set(deployments.map(item => item.app))])
    )
    core.setOutput('deployments', JSON.stringify(deployments))
    core.setOutput('batches', JSON.stringify(batches))
    return
  }
  const resolved = resolveWebApp(catalog, {
    app: env.APP,
    caller: env.CALLER,
    callerRepository: env.CALLER_REPO || '',
    environment: env.APP_ENV,
    productionTarget: env.PRODUCTION_TARGET || ''
  })
  for (const [name, value] of Object.entries(resolved))
    core.setOutput(name, value)
}

module.exports = {
  parseCatalog,
  getCatalogApps,
  groups,
  resolveWebApp,
  listWebApps,
  listProductionDeployments,
  planPromotionTargets,
  main
}
