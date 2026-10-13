const assert = require('node:assert/strict')
const { test } = require('node:test')
const { parseCatalog, resolveWebApp, listWebApps, main } = require('./main.cjs')
const yaml = require('js-yaml')
const { resolveSource } = require('../../prepare-web-deployment/bin/main.cjs')

const sha = 'a'.repeat(40)
const catalog = () => ({
  schema: 1,
  defaults: {
    environments: {
      tva: { build_environment: 'dev', release_channel: 'beta', debug: true },
      dev: { build_environment: 'dev', release_channel: 'beta', debug: true },
      qa: { build_environment: 'qa', release_channel: 'beta', debug: false },
      preview: {
        build_environment: 'preview',
        release_channel: 'stable',
        debug: false
      },
      production: {
        build_environment: 'production',
        release_channel: 'stable',
        debug: false
      }
    }
  },
  apps: {
    'test-app': {
      category: 'cdns',
      repository: 'example/apps',
      path: 'apps/test-app',
      credential_secrets: Object.fromEntries(
        ['tva', 'dev', 'qa', 'preview', 'production'].map(env => [
          env,
          `TEST_${env.toUpperCase()}_GCP_SA_KEY`
        ])
      )
    }
  }
})

test('YAML registry supports comments and preserves boolean and schema version types', () => {
  const source = '# Common settings for all apps\n' + yaml.dump(catalog())
  const parsed = parseCatalog(source)
  assert.deepEqual(parsed, catalog())
  assert.equal(parsed.schema, 1)
  assert.equal(parsed.defaults.environments.qa.debug, false)
  const app = resolveWebApp(parsed, { app: 'test-app', environment: 'qa' })
  assert.equal(app.debug, 'false')
  assert.equal(Object.hasOwn(app, 'node_version'), false)
})

test('50 YAML app entries resolve through the same shared registry', () => {
  const config = catalog()
  const template = config.apps['test-app']
  config.apps = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `app-${String(i).padStart(2, '0')}`,
      structuredClone(template)
    ])
  )
  const parsed = parseCatalog(yaml.dump(config))
  assert.equal(listWebApps(parsed, 'cdns').length, 50)
  assert.equal(
    resolveWebApp(parsed, { app: 'app-49', environment: 'production' })
      .credential_secret,
    'TEST_PRODUCTION_GCP_SA_KEY'
  )
})

test('YAML aliases can share a build profile', () => {
  const parsed = parseCatalog(`
schema: 1
defaults:
  environments:
    tva: &beta
      build_environment: dev
      release_channel: beta
      debug: true
    dev: *beta
apps: {}
`)
  assert.deepEqual(
    parsed.defaults.environments.dev,
    parsed.defaults.environments.tva
  )
})

for (const [name, source] of [
  [
    'duplicate app IDs',
    'schema: 1\ndefaults: {}\napps:\n  test-app: {}\n  test-app: {}\n'
  ],
  [
    'duplicate credential mappings',
    'schema: 1\ndefaults: {}\napps:\n  test-app:\n    credential_secrets:\n      qa: FIRST_KEY\n      qa: SECOND_KEY\n'
  ],
  ['malformed YAML', 'schema: 1\ndefaults: [\n'],
  ['multiple documents', 'schema: 1\ndefaults: {}\napps: {}\n---\nschema: 1\n'],
  [
    'custom executable tags',
    'schema: 1\ndefaults: {}\napps: !!js/function function(){}\n'
  ],
  ['empty document', ''],
  ['scalar document', 'hello'],
  ['sequence document', '- schema\n- defaults\n']
]) {
  test(`YAML registry rejects ${name}`, () =>
    assert.throws(() => parseCatalog(source)))
}

test('malformed YAML fails before publishing any registry outputs', async () => {
  await assert.rejects(
    main({
      env: {
        CONFIG_REPO: 'example/deployer',
        CONFIG_REF: 'timeline',
        CONFIG_PATH: '.github/config/web-apps.yaml',
        CATEGORY: 'cdns'
      },
      github: {
        rest: {
          repos: {
            getContent: async () => ({
              data: {
                type: 'file',
                encoding: 'base64',
                content: Buffer.from('apps: [').toString('base64')
              }
            })
          }
        }
      },
      core: {
        setOutput: () => {
          throw new Error('Unexpected output')
        }
      }
    }),
    /unexpected end|flow collection/
  )
})

test('TVA retains Dev/Beta/debug settings while tracking TVA', () => {
  const app = resolveWebApp(catalog(), { app: 'test-app', caller: 'timeline' })
  assert.equal(app.track_environment, 'tva')
  assert.equal(app.build_environment, 'dev')
  assert.equal(app.release_channel, 'beta')
  assert.equal(app.debug, 'true')
  assert.equal(app.credential_secret, 'TEST_TVA_GCP_SA_KEY')
  assert.equal(app.git_ref, 'timeline')
})

for (const [environment, channel, debug] of [
  ['dev', 'beta', 'true'],
  ['qa', 'beta', 'false'],
  ['preview', 'stable', 'false'],
  ['production', 'stable', 'false']
]) {
  test(`${environment} selects its own credentials and build profile`, () => {
    const app = resolveWebApp(catalog(), { app: 'test-app', environment })
    assert.equal(app.track_environment, environment)
    assert.equal(app.build_environment, environment)
    assert.equal(app.release_channel, channel)
    assert.equal(app.debug, debug)
    assert.equal(
      app.credential_secret,
      `TEST_${environment.toUpperCase()}_GCP_SA_KEY`
    )
    assert.equal(app.git_ref, '')
  })
}

test('legacy scheduler caller resolves timeline rather than a nonexistent scheduler branch', () => {
  assert.equal(
    resolveWebApp(catalog(), { app: 'test-app', caller: '-scheduler' }).git_ref,
    'timeline'
  )
})

test('app overrides preserve false booleans and other inherited defaults', () => {
  const config = catalog()
  config.apps['test-app'].environments = { dev: { debug: false } }
  const app = resolveWebApp(config, { app: 'test-app', environment: 'dev' })
  assert.equal(app.debug, 'false')
  assert.equal(app.release_channel, 'beta')
})

test('category discovery supports 50 apps without app-specific workflow routing', () => {
  const config = catalog()
  const template = config.apps['test-app']
  config.apps = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `app-${String(i).padStart(2, '0')}`,
      structuredClone(template)
    ])
  )
  config.apps.disabled = { ...template, enabled: false }
  config.apps.other = { ...template, category: 'pods' }
  const apps = listWebApps(config, 'cdns')
  assert.equal(apps.length, 50)
  assert.equal(apps[0], 'app-00')
  assert.equal(apps.at(-1), 'app-49')
  assert.deepEqual(listWebApps(config, 'widgets'), [])
})

for (const app of ['missing', 'constructor', '__proto__', 'test-app;echo']) {
  test(`unknown or unsafe app ID is rejected: ${app}`, () => {
    assert.throws(
      () => resolveWebApp(catalog(), { app, environment: 'dev' }),
      /Unknown web app/
    )
  })
}

for (const path of [
  '../apps/test',
  'apps/../test',
  '/apps/test',
  'apps/test\nnext',
  'apps/./test'
]) {
  test(`unsafe app path is rejected: ${JSON.stringify(path)}`, () => {
    const config = catalog()
    config.apps['test-app'].path = path
    assert.throws(
      () => resolveWebApp(config, { app: 'test-app', environment: 'dev' }),
      /Invalid relative app path/
    )
  })
}

test('malformed registry and missing destination credential names fail explicitly', () => {
  assert.throws(
    () => resolveWebApp({ schema: 2 }, { app: 'test-app', environment: 'dev' }),
    /schema-1/
  )
  const config = catalog()
  delete config.apps['test-app'].credential_secrets.production
  assert.throws(
    () => resolveWebApp(config, { app: 'test-app', environment: 'production' }),
    /credential secret name/
  )
})

test('disabled apps cannot be promoted manually', () => {
  const config = catalog()
  config.apps['test-app'].enabled = false
  assert.throws(
    () => resolveWebApp(config, { app: 'test-app', environment: 'dev' }),
    /disabled/
  )
})

test('ambiguous or unsupported automatic destinations are rejected', () => {
  assert.throws(
    () =>
      resolveWebApp(catalog(), {
        app: 'test-app',
        caller: 'timeline',
        environment: 'production'
      }),
    /combine CALLER/
  )
  assert.throws(
    () => resolveWebApp(catalog(), { app: 'test-app', caller: 'next' }),
    /CALLER/
  )
  assert.throws(
    () => resolveWebApp(catalog(), { app: 'test-app', environment: 'tva' }),
    /Promotion APP_ENV/
  )
})

test('registry API receives an explicit config ref and outputs only secret names', async () => {
  const outputs = {}
  let request
  await main({
    env: {
      CONFIG_REPO: 'example/deployer',
      CONFIG_REF: 'b'.repeat(40),
      CONFIG_PATH: '.github/config/web-apps.yaml',
      APP: 'test-app',
      APP_ENV: 'production'
    },
    github: {
      rest: {
        repos: {
          getContent: async args => {
            request = args
            return {
              data: {
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(yaml.dump(catalog())).toString('base64')
              }
            }
          }
        }
      }
    },
    core: {
      setOutput: (key, value) => {
        outputs[key] = value
      }
    }
  })
  assert.equal(request.ref, 'b'.repeat(40))
  assert.equal(outputs.repository, 'example/apps')
  assert.equal(outputs.credential_secret, 'TEST_PRODUCTION_GCP_SA_KEY')
  assert.equal(Object.hasOwn(outputs, 'token'), false)
})

test('category API outputs a JSON matrix', async () => {
  const outputs = {}
  await main({
    env: {
      CONFIG_REPO: 'example/deployer',
      CONFIG_REF: 'timeline',
      CONFIG_PATH: '.github/config/web-apps.yaml',
      CATEGORY: 'cdns'
    },
    github: {
      rest: {
        repos: {
          getContent: async () => ({
            data: {
              type: 'file',
              encoding: 'base64',
              content: Buffer.from(yaml.dump(catalog())).toString('base64')
            }
          })
        }
      }
    },
    core: {
      setOutput: (key, value) => {
        outputs[key] = value
      }
    }
  })
  assert.deepEqual(JSON.parse(outputs.apps), ['test-app'])
})

test('registry read failures do not fall back to default app or branch settings', async () => {
  await assert.rejects(
    main({
      env: {
        CONFIG_REPO: 'example/deployer',
        CONFIG_REF: 'timeline',
        APP: 'test-app'
      },
      github: {
        rest: {
          repos: {
            getContent: async () => {
              throw new Error('HTTP 403')
            }
          }
        }
      },
      core: {
        setOutput: () => {
          throw new Error('Unexpected output')
        }
      }
    }),
    /HTTP 403/
  )
})

test('TVA selects a branch without promotion validation', () => {
  assert.deepEqual(resolveSource({ environment: 'tva', ref: 'timeline' }), {
    git_ref: 'timeline',
    needs_validation: 'false'
  })
})

for (const environment of ['dev', 'qa', 'preview', 'production']) {
  test(`manual ${environment} source requires subsequent promotion-order validation`, () => {
    assert.deepEqual(resolveSource({ environment, sha }), {
      git_ref: '',
      needs_validation: 'true'
    })
  })
}

test('scheduled Production awaits journal resolution and never substitutes timeline', () => {
  assert.deepEqual(
    resolveSource({ environment: 'production', latest: 'true' }),
    { git_ref: '', needs_validation: 'true' }
  )
})

for (const [name, request] of [
  ['missing manual SHA', { environment: 'dev' }],
  ['short manual SHA', { environment: 'dev', sha: 'abcdef1' }],
  ['branch in manual promotion', { environment: 'qa', ref: 'timeline', sha }],
  ['latest Dev', { environment: 'dev', latest: 'true' }],
  [
    'latest Production with explicit SHA',
    { environment: 'production', latest: 'true', sha }
  ],
  ['TVA with explicit SHA', { environment: 'tva', ref: 'timeline', sha }],
  [
    'TVA with latest flag',
    { environment: 'tva', ref: 'timeline', latest: 'true' }
  ],
  ['TVA with arbitrary branch', { environment: 'tva', ref: 'next' }],
  ['invalid destination', { environment: 'live', sha }]
]) {
  test(`source selection rejects ${name}`, () =>
    assert.throws(() => resolveSource(request)))
}
