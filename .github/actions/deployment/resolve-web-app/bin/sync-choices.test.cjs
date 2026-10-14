const assert = require('node:assert/strict')
const { mkdtempSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { test } = require('node:test')
const yaml = require('js-yaml')
const {
  generateChoices,
  syncChoices,
  syncCategoryChoices
} = require('./sync-choices.cjs')

const start =
  '        # vx-bot/INFO: Generated app choices from web-apps.yaml; do not edit.'
const end = '        # vx-bot/INFO: End generated app choices.'
const workflow = `name: Promote\nrun-name: Promote \${{ inputs.APP }}\non:\n  workflow_dispatch:\n    inputs:\n      APP:\n        required: true\n${start}\n        type: choice\n        options:\n          - old-app\n${end}\n      APP_ENV:\n        type: choice\n        options: [dev, qa, preview, production]\njobs:\n  promote:\n    uses: ./.github/workflows/web-app.yml\n`
const catalog = () => ({
  schema: 2,
  defaults: {
    environments: Object.fromEntries(
      ['dev', 'qa', 'preview', 'production'].map(env => [
        env,
        { build_environment: env, release_channel: 'stable', debug: false }
      ])
    )
  },
  'apps-cdns': Object.fromEntries(
    ['z-app', 'a-app', 'disabled-app'].map(app => [
      app,
      {
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
  const template = config['apps-cdns']['a-app']
  config['apps-cdns'] = {}
  config['apps-suites'] = {}
  for (let i = 0; i < 50; i++)
    config[i % 2 ? 'apps-cdns' : 'apps-suites'][`app-${i}`] = { ...template }
  assert.equal(
    yaml.load(generateChoices(yaml.dump(config), workflow)).on.workflow_dispatch
      .inputs.APP.options.length,
    50
  )
})

test('empty enabled registry fails instead of emitting an invalid dropdown', () => {
  const config = catalog()
  for (const app of Object.values(config['apps-cdns'])) app.enabled = false
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /at least one/
  )
})

test('invalid enabled IDs and incomplete promotion profiles fail generation', () => {
  const config = catalog()
  config['apps-cdns']['bad app'] = config['apps-cdns']['a-app']
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /Invalid web app entry/
  )
  delete config['apps-cdns']['bad app']
  delete config['apps-cdns']['a-app'].credential_secrets.qa
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
  delete config['apps-cdns']['z-app']
  writeFileSync(registryPath, yaml.dump(config))
  assert.throws(() => syncChoices({ registryPath, workflowPath }), /stale/)
})

test('scalar-like IDs stay strings in workflow choices', () => {
  const config = catalog()
  const template = config['apps-cdns']['a-app']
  const apps = ['true', 'false', 'null', '123', '1e3', '0x12']
  config['apps-cdns'] = Object.fromEntries(apps.map(app => [app, template]))
  const generated = yaml.load(generateChoices(yaml.dump(config), workflow))
  assert.deepEqual(
    generated.on.workflow_dispatch.inputs.APP.options,
    apps.sort()
  )
})

const groupedCatalog = () => {
  const config = catalog()
  config['apps-internals'] = { 'a-app': config['apps-cdns']['a-app'] }
  delete config['apps-cdns']['a-app']
  return config
}

test('promotion choices span all groups and exclude disabled entries', () => {
  const config = groupedCatalog()
  const result = yaml.load(generateChoices(yaml.dump(config), workflow))
  assert.deepEqual(result.on.workflow_dispatch.inputs.APP.options, [
    'a-app',
    'z-app'
  ])
})

test('promotion generation rejects duplicate app IDs across categories', () => {
  const config = groupedCatalog()
  config['apps-pods'] = { 'a-app': config['apps-internals']['a-app'] }
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /Duplicate web app ID/
  )
})

test('dropdown validates only the promotion stages enabled for each app', () => {
  const config = groupedCatalog()
  config['apps-internals']['a-app'].promotion_path = ['tva', 'production']
  config['apps-cdns']['z-app'].promotion_path = ['tva', 'preview', 'production']
  const result = yaml.load(generateChoices(yaml.dump(config), workflow))
  assert.deepEqual(result.on.workflow_dispatch.inputs.APP.options, [
    'a-app',
    'z-app'
  ])
})

test('dropdown rejects invalid promotion paths', () => {
  const config = groupedCatalog()
  config['apps-internals']['a-app'].promotion_path = ['production']
  assert.throws(
    () => generateChoices(yaml.dump(config), workflow),
    /promotion_path/
  )
})

test('dropdown validates app-specific Production targets', () => {
  const config = catalog()
  config['apps-cdns']['a-app'].production_targets = {
    'custom-region': { credential_secret: 'CUSTOM_KEY' }
  }
  delete config['apps-cdns']['a-app'].credential_secrets.production
  assert.doesNotThrow(() => generateChoices(yaml.dump(config), workflow))
  config['apps-cdns']['a-app'].production_targets['custom-region'].values = {
    V_APP_NAME: 'override'
  }
  assert.throws(() => generateChoices(yaml.dump(config), workflow), /reserved/)
})

test('category choices include only matching enabled apps and preserve workflow bytes', () => {
  const config = groupedCatalog(),
    registry = yaml.dump(config)
  const result = generateChoices(registry, workflow, { category: 'internals' })
  assert.deepEqual(yaml.load(result).on.workflow_dispatch.inputs.APP.options, [
    'a-app'
  ])
  assert.equal(
    result.slice(0, result.indexOf(start)),
    workflow.slice(0, workflow.indexOf(start))
  )
  assert.deepEqual(
    yaml.load(generateChoices(registry, workflow, { category: 'cdns' })).on
      .workflow_dispatch.inputs.APP.options,
    ['z-app']
  )
  assert.throws(
    () => generateChoices(registry, workflow, { category: 'unknown' }),
    /Unknown promotion category/
  )
  assert.throws(
    () => generateChoices(registry, workflow, { category: 'widgets' }),
    /at least one enabled app/
  )
})
const categoryWorkflow = category =>
  workflow
    .replace('name: Promote', 'name: Promote | ' + category)
    .replace(
      '      APP_ENV:',
      '      GIT_SHA:\n        type: string\n      PRODUCTION_TARGET:\n        type: string\n      APP_ENV:'
    )
    .replace(
      '    uses: ./.github/workflows/web-app.yml',
      '    uses: ./.github/workflows/promote.yml\n    secrets: inherit\n    with:\n      APP: ${{ inputs.APP }}\n      GIT_SHA: ${{ inputs.GIT_SHA }}\n      APP_ENV: ${{ inputs.APP_ENV }}\n      PRODUCTION_TARGET: ${{ inputs.PRODUCTION_TARGET }}'
    )
const categoryFiles = t => {
  const directory = mkdtempSync(join(tmpdir(), 'vx-category-choices-'))
  t.after(() => rmSync(directory, { recursive: true, force: true }))
  const registryPath = join(directory, 'registry.yaml')
  writeFileSync(registryPath, yaml.dump(groupedCatalog()))
  for (const category of ['cdns', 'internals'])
    writeFileSync(
      join(directory, 'promote-' + category + '.yml'),
      categoryWorkflow(category)
    )
  return { directory, registryPath, workflowDirectory: directory }
}
test('all-category check detects drift without writes, write updates every category and then passes', t => {
  const f = categoryFiles(t),
    file = join(f.directory, 'promote-cdns.yml'),
    before = readFileSync(file, 'utf8')
  assert.throws(() => syncCategoryChoices(f), /choices are stale/)
  assert.equal(readFileSync(file, 'utf8'), before)
  assert.equal(syncCategoryChoices({ ...f, mode: 'write' }), true)
  assert.equal(syncCategoryChoices(f), false)
  assert.deepEqual(
    yaml.load(readFileSync(file, 'utf8')).on.workflow_dispatch.inputs.APP
      .options,
    ['z-app']
  )
  assert.deepEqual(
    yaml.load(readFileSync(join(f.directory, 'promote-internals.yml'), 'utf8'))
      .on.workflow_dispatch.inputs.APP.options,
    ['a-app']
  )
})
test('all-category generation refuses wrong routing before writing any dropdown', t => {
  const f = categoryFiles(t),
    cdns = join(f.directory, 'promote-cdns.yml'),
    internals = join(f.directory, 'promote-internals.yml')
  const before = readFileSync(cdns, 'utf8')
  writeFileSync(
    internals,
    categoryWorkflow('internals').replace(
      './.github/workflows/promote.yml',
      './.github/workflows/other.yml'
    )
  )
  assert.throws(
    () => syncCategoryChoices({ ...f, mode: 'write' }),
    /incorrect routing/
  )
  assert.equal(readFileSync(cdns, 'utf8'), before)
})
test('all-category guard detects missing category workflows and obsolete empty categories', t => {
  const f = categoryFiles(t),
    config = groupedCatalog()
  config['apps-widgets'] = { chat: config['apps-cdns']['z-app'] }
  writeFileSync(f.registryPath, yaml.dump(config))
  assert.throws(() => syncCategoryChoices(f), /Missing: promote-widgets.yml/)
  delete config['apps-widgets']
  delete config['apps-internals']
  writeFileSync(f.registryPath, yaml.dump(config))
  assert.throws(
    () => syncCategoryChoices(f),
    /remove empty.*promote-internals.yml/
  )
})
test('single-category write and check forward the category filter', t => {
  const f = categoryFiles(t),
    workflowPath = join(f.directory, 'promote-cdns.yml')
  assert.equal(
    syncChoices({
      registryPath: f.registryPath,
      workflowPath,
      category: 'cdns',
      mode: 'write'
    }),
    true
  )
  assert.equal(
    syncChoices({
      registryPath: f.registryPath,
      workflowPath,
      category: 'cdns'
    }),
    false
  )
  assert.deepEqual(
    yaml.load(readFileSync(workflowPath, 'utf8')).on.workflow_dispatch.inputs
      .APP.options,
    ['z-app']
  )
})
