'use strict'

const { readFileSync, writeFileSync, readdirSync } = require('node:fs')
const { join } = require('node:path')
const yaml = require('js-yaml')
const { getPromotionPath } = require('../../validate-promotion/bin/policy.cjs')
const {
  parseCatalog,
  getCatalogApps,
  resolveWebApp,
  groups
} = require('./main.cjs')

const { getProductionTargets } = require('./config.cjs')

const startMarker =
  '        # vx-bot/INFO: Generated app choices from web-apps.yaml; do not edit.'
const endMarker = '        # vx-bot/INFO: End generated app choices.'

const generateChoices = (registry, workflow, { category = '' } = {}) => {
  if (
    typeof category !== 'string' ||
    (category && !Object.values(groups).includes(category))
  )
    throw new Error('Unknown promotion category: ' + category)
  const catalog = parseCatalog(registry)
  const entries = getCatalogApps(catalog)
  const apps = Object.keys(entries)
    .filter(
      app =>
        entries[app]?.enabled !== false &&
        (!category || entries[app].category === category)
    )
    .sort()
  if (!apps.length)
    throw new Error(
      'The promotion dropdown needs at least one enabled app' +
        (category ? ' in ' + category : '')
    )
  for (const app of apps) {
    for (const environment of getPromotionPath(
      entries[app].promotion_path
    ).slice(1))
      for (const productionTarget of environment === 'production'
        ? getProductionTargets(entries[app])
        : [''])
        resolveWebApp(catalog, { app, environment, productionTarget })
  }
  const start = workflow.indexOf(startMarker)
  const end = workflow.indexOf(endMarker)
  if (
    start < 0 ||
    end < start ||
    workflow.indexOf(startMarker, start + startMarker.length) !== -1 ||
    workflow.indexOf(endMarker, end + endMarker.length) !== -1
  )
    throw new Error(
      'Expected exactly one generated app-choice block in the promotion workflow'
    )
  const block = [
    startMarker,
    '        type: choice',
    '        options:',
    ...yaml
      .dump(apps, { lineWidth: -1 })
      .trimEnd()
      .split('\n')
      .map(line => `          ${line}`),
    endMarker
  ].join('\n')
  return (
    workflow.slice(0, start) + block + workflow.slice(end + endMarker.length)
  )
}

const syncChoices = ({
  registryPath,
  workflowPath,
  mode = 'check',
  category = ''
}) => {
  if (!['check', 'write'].includes(mode))
    throw new Error('MODE must be check or write')
  const workflow = readFileSync(workflowPath, 'utf8')
  const generated = generateChoices(
    readFileSync(registryPath, 'utf8'),
    workflow,
    { category }
  )
  if (generated === workflow) return false
  if (mode === 'check')
    throw new Error(
      'Promotion app choices are stale. Regenerate with sync-promote-choices MODE=write and commit the workflow with the registry change.'
    )
  writeFileSync(workflowPath, generated)
  return true
}

const syncCategoryChoices = ({
  registryPath,
  workflowDirectory,
  mode = 'check'
}) => {
  if (!['check', 'write'].includes(mode))
    throw new Error('MODE must be check or write')
  const registry = readFileSync(registryPath, 'utf8')
  const entries = getCatalogApps(parseCatalog(registry))
  const categories = [
    ...new Set(
      Object.values(entries)
        .filter(app => app.enabled !== false)
        .map(app => app.category)
    )
  ].sort()
  if (!categories.length)
    throw new Error('Category promotion needs at least one enabled app')
  const files = readdirSync(workflowDirectory).filter(
    file =>
      /^promote-[a-z0-9-]+\.yml$/.test(file) &&
      file !== 'promote-check-choices.yml'
  )
  const expected = categories.map(category => `promote-${category}.yml`)
  const missing = expected.filter(file => !files.includes(file)),
    extra = files.filter(file => !expected.includes(file))
  if (missing.length || extra.length)
    throw new Error(
      `Promotion category workflows do not match the registry. Missing: ${missing.join(', ') || 'none'}; remove empty/unknown category workflows: ${extra.join(', ') || 'none'}`
    )
  // vx-bot/NOTE: Validate every category before modifying any generated choice block.
  const updates = categories.map(category => {
    const file = join(workflowDirectory, `promote-${category}.yml`),
      source = readFileSync(file, 'utf8')
    const generated = generateChoices(registry, source, { category })
    const workflow = yaml.load(generated, { schema: yaml.JSON_SCHEMA })
    const call = workflow.jobs?.promote
    if (
      call?.uses !== './.github/workflows/promote.yml' ||
      !call.with ||
      call.with.APP !== '${{ inputs.APP }}'
    )
      throw new Error(
        `Promotion category workflow has incorrect routing: ${file}`
      )
    const defined = workflow.on?.workflow_dispatch?.inputs || {}
    for (const key of ['APP', 'GIT_SHA', 'APP_ENV', 'PRODUCTION_TARGET']) {
      if (!defined[key] || call.with[key] !== '${{ inputs.' + key + ' }}')
        throw new Error(
          `Missing promotion input or forwarding: ${file}: ${key}`
        )
    }
    return { file, source, generated }
  })
  const stale = updates.filter(item => item.source !== item.generated)
  if (mode === 'check' && stale.length)
    throw new Error(
      'Promotion category choices are stale: ' +
        stale.map(item => item.file).join(', ')
    )
  if (mode === 'write')
    for (const item of stale) writeFileSync(item.file, item.generated)
  return stale.length > 0
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    if (args.length && ![3, 4].includes(args.length))
      throw new Error(
        'Usage: node sync-choices.cjs <registry> <workflow> <check|write> [category]'
      )
    const allCategories = process.env.ALL_CATEGORIES || 'false'
    if (!['true', 'false'].includes(allCategories))
      throw new Error('ALL_CATEGORIES must be true or false')
    if (allCategories === 'true' && (args.length || process.env.CATEGORY))
      throw new Error(
        'ALL_CATEGORIES cannot be combined with a single category or workflow argument'
      )
    const changed =
      allCategories === 'true'
        ? syncCategoryChoices({
            registryPath: process.env.REGISTRY_PATH,
            workflowDirectory: process.env.WORKFLOW_DIRECTORY,
            mode: process.env.MODE || 'check'
          })
        : syncChoices({
            registryPath: args[0] || process.env.REGISTRY_PATH,
            workflowPath: args[1] || process.env.WORKFLOW_PATH,
            mode: args[2] || process.env.MODE || 'check',
            category: args[3] || process.env.CATEGORY || ''
          })
    console.log(
      changed
        ? 'Updated promotion app choices'
        : 'Promotion app choices are current'
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}

module.exports = { generateChoices, syncChoices, syncCategoryChoices }
