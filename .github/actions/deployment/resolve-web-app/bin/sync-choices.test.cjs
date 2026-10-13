const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const yaml = require('js-yaml')
const { generateChoices, syncChoices } = require('./sync-choices.cjs')

const start =
  '        # vx-bot/INFO: Generated app choices from web-apps.yaml; do not edit.'
const end = '        # vx-bot/INFO: End generated app choices.'
const workflow = `name: Promote\nrun-name: Promote \${{ inputs.APP }}\non:\n  workflow_dispatch:\n    inputs:\n      APP:\n        required: true\n${start}\n        type: choice\n        options:\n          - old-app\n${end}\n      APP_ENV:\n        type: choice\n        options: [dev, qa, preview, production]\njobs:\n  promote:\n    uses: ./.github/workflows/web-app.yml\n`
const catalog = () => ({
  schema: 1,
  defaults: {
    environments: Object.fromEntries(
      ['dev', 'qa', 'preview', 'production'].map(env => [
        env,
        { build_environment: env, release_channel: 'stable', debug: false }
      ])
    )
  },
  apps: Object.fromEntries(
    ['z-app', 'a-app', 'disabled-app'].map(app => [
      app,
      {
        category: 'cdns',
        repository: 'example/apps',
        path: `apps/${app}`,
        ...(app === 'disabled-app' ? { enabled: false } : {}),
        credential_secrets: Object.fromEntries(
          ['dev', 'qa', 'preview', 'production'].map(env => [env, 'SECRET'])
        )
      }
    ])
  )
})

test('sorted enabled IDs populate the dropdown and preserve unrelated workflow bytes', () => {
  const generated = generateChoices(yaml.dump(catalog()), workflow)
  assert(generated.includes('          - a-app\n          - z-app'))
  assert(!generated.includes('disabled-app'))
  assert.equal(
    generated.slice(0, generated.indexOf(start)),
    workflow.slice(0, workflow.indexOf(start))
  )
  assert.equal(
    generated.slice(generated.indexOf(end)),
    workflow.slice(workflow.indexOf(end))
  )
  const parsed = yaml.load(generated)
  assert.equal(parsed.on.workflow_dispatch.inputs.APP.type, 'choice')
  assert.deepEqual(parsed.on.workflow_dispatch.inputs.APP.options, [
    'a-app',
    'z-app'
  ])
})

test('generation is idempotent', () => {
  const registry = yaml.dump(catalog())
  const generated = generateChoices(registry, workflow)
  assert.equal(generateChoices(registry, generated), generated)
})

test('50 apps across categories generate without routing changes', () => {
  const config = catalog()
  const template = config.apps['a-app']
  config.apps = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `app-${i}`,
      { ...template, category: i % 2 ? 'cdns' : 'suites' }
    ])
  )
  assert.equal(
    yaml.load(generateChoices(yaml.dump(config), workflow)).on.workflow_dispatch
      .inputs.APP.options.length,
    50
  )
})

test('empty enabled registry fails instead of emitting an invalid dropdown', () => {
  const config = catalog()
  for (const app of Object.values(config.apps)) app.enabled = false
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /at least one/
  )
})

test('invalid enabled IDs and incomplete promotion profiles fail generation', () => {
  const config = catalog()
  config.apps['bad app'] = config.apps['a-app']
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /Unknown web app/
  )
  delete config.apps['bad app']
  delete config.apps['a-app'].credential_secrets.qa
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /credential secret/
  )
})

for (const content of [
  workflow.replace(start, ''),
  workflow.replace(end, ''),
  workflow + start,
  workflow + end
]) {
  test('missing or duplicate generation markers fail explicitly', () => {
    assert.throws(
      () => generateChoices(yaml.dump(catalog()), content),
      /exactly one/
    )
  })
}

test('check detects drift without writing; write updates once and check then passes', t => {
  const directory = mkdtempSync(join(tmpdir(), 'vx-promote-choices-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const registryPath = join(directory, 'registry.yaml')
  const workflowPath = join(directory, 'promote.yml')
  writeFileSync(registryPath, yaml.dump(catalog()))
  writeFileSync(workflowPath, workflow)
  assert.throws(() => syncChoices({ registryPath, workflowPath }), /stale/)
  assert.equal(readFileSync(workflowPath, 'utf8'), workflow)
  assert.equal(syncChoices({ registryPath, workflowPath, mode: 'write' }), true)
  assert.equal(syncChoices({ registryPath, workflowPath }), false)
  assert.equal(
    syncChoices({ registryPath, workflowPath, mode: 'write' }),
    false
  )
  assert.throws(
    () => syncChoices({ registryPath, workflowPath, mode: 'other' }),
    /MODE/
  )
  const config = catalog()
  delete config.apps['z-app']
  writeFileSync(registryPath, yaml.dump(config))
  assert.throws(() => syncChoices({ registryPath, workflowPath }), /stale/)
})

test('scalar-like IDs stay strings in workflow choices', () => {
  const config = catalog()
  const template = config.apps['a-app']
  const apps = ['true', 'false', 'null', '123', '1e3', '0x12']
  config.apps = Object.fromEntries(apps.map(app => [app, template]))
  const generated = yaml.load(generateChoices(yaml.dump(config), workflow))
  assert.deepEqual(
    generated.on.workflow_dispatch.inputs.APP.options,
    apps.sort()
  )
})
