'use strict'

const { readFileSync, writeFileSync } = require('node:fs')
const yaml = require('js-yaml')
const { getPromotionPath } = require('../../validate-promotion/bin/policy.cjs')
const { parseCatalog, getCatalogApps, resolveWebApp } = require('./main.cjs')

const { getProductionTargets } = require('./config.cjs')

const startMarker =
  '        # vx-bot/INFO: Generated app choices from web-apps.yaml; do not edit.'
const endMarker = '        # vx-bot/INFO: End generated app choices.'

const generateChoices = (registry, workflow) => {
  const catalog = parseCatalog(registry)
  const entries = getCatalogApps(catalog)
  const apps = Object.keys(entries)
    .filter(app => entries[app]?.enabled !== false)
    .sort()
  if (!apps.length)
    throw new Error('The promotion dropdown needs at least one enabled app')
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

const syncChoices = ({ registryPath, workflowPath, mode = 'check' }) => {
  if (!['check', 'write'].includes(mode))
    throw new Error('MODE must be check or write')
  const workflow = readFileSync(workflowPath, 'utf8')
  const generated = generateChoices(
    readFileSync(registryPath, 'utf8'),
    workflow
  )
  if (generated === workflow) return false
  if (mode === 'check')
    throw new Error(
      'Promotion app choices are stale. Regenerate with sync-promote-choices MODE=write and commit the workflow with the registry change.'
    )
  writeFileSync(workflowPath, generated)
  return true
}

if (require.main === module) {
  try {
    const args = process.argv.slice(2)
    if (args.length && args.length !== 3)
      throw new Error(
        'Usage: node sync-choices.cjs <registry> <workflow> <check|write>'
      )
    const changed = syncChoices({
      registryPath: args[0] || process.env.REGISTRY_PATH,
      workflowPath: args[1] || process.env.WORKFLOW_PATH,
      mode: args[2] || process.env.MODE || 'check'
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

module.exports = { generateChoices, syncChoices }
