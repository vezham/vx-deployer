const assert = require('node:assert/strict')
const { test } = require('node:test')
const { parseCatalog, resolveWebApp, listWebApps, main } = require('./main.cjs')
const yaml = require('js-yaml')
const { resolveSource } = require('../../prepare-web-deployment/bin/main.cjs')

const sha = 'a'.repeat(40)
const catalog = () => ({
  schema: 2,
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
  'apps-cdns': {
    'test-app': {
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
  assert.equal(parsed.schema, 2)
  assert.equal(parsed.defaults.environments.qa.debug, false)
  const app = resolveWebApp(parsed, { app: 'test-app', environment: 'qa' })
  assert.equal(app.debug, 'false')
  assert.equal(Object.hasOwn(app, 'node_version'), false)
})

test('50 YAML app entries resolve through the same shared registry', () => {
  const config = catalog()
  const template = config['apps-cdns']['test-app']
  config['apps-cdns'] = Object.fromEntries(
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
schema: 2
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
    'schema: 2\ndefaults: {}\napps:\n  test-app: {}\n  test-app: {}\n'
  ],
  [
    'duplicate credential mappings',
    'schema: 2\ndefaults: {}\napps:\n  test-app:\n    credential_secrets:\n      qa: FIRST_KEY\n      qa: SECOND_KEY\n'
  ],
  ['malformed YAML', 'schema: 2\ndefaults: [\n'],
  ['multiple documents', 'schema: 2\ndefaults: {}\napps: {}\n---\nschema: 2\n'],
  [
    'custom executable tags',
    'schema: 2\ndefaults: {}\napps: !!js/function function(){}\n'
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
  const app = resolveWebApp(catalog(), {
    app: 'test-app',
    caller: 'timeline',
    callerRepository: 'example/apps'
  })
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
    resolveWebApp(catalog(), {
      app: 'test-app',
      caller: '-scheduler',
      callerRepository: 'example/apps'
    }).git_ref,
    'timeline'
  )
})

test('app overrides preserve false booleans and other inherited defaults', () => {
  const config = catalog()
  config['apps-cdns']['test-app'].environments = { dev: { debug: false } }
  const app = resolveWebApp(config, { app: 'test-app', environment: 'dev' })
  assert.equal(app.debug, 'false')
  assert.equal(app.release_channel, 'beta')
})

test('category discovery supports 50 apps without app-specific workflow routing', () => {
  const config = catalog()
  const template = config['apps-cdns']['test-app']
  config['apps-cdns'] = Object.fromEntries(
    Array.from({ length: 50 }, (_, i) => [
      `app-${String(i).padStart(2, '0')}`,
      structuredClone(template)
    ])
  )
  config['apps-cdns'].disabled = { ...template, enabled: false }
  config['apps-pods'] = { other: { ...template } }
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
    config['apps-cdns']['test-app'].path = path
    assert.throws(
      () => resolveWebApp(config, { app: 'test-app', environment: 'dev' }),
      /Invalid relative app path/
    )
  })
}

test('malformed registry and missing destination credential names fail explicitly', () => {
  assert.throws(
    () => resolveWebApp({ schema: 2 }, { app: 'test-app', environment: 'dev' }),
    /schema-2/
  )
  const config = catalog()
  delete config['apps-cdns']['test-app'].credential_secrets.production
  assert.throws(
    () => resolveWebApp(config, { app: 'test-app', environment: 'production' }),
    /credential secret name/
  )
})

test('disabled apps cannot be promoted manually', () => {
  const config = catalog()
  config['apps-cdns']['test-app'].enabled = false
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

const groupedCatalog = () => catalog()

test('unsupported registry versions are rejected', () => {
  for (const schema of [1, 3, '2', null]) {
    const config = catalog()
    config.schema = schema
    assert.throws(() => parseCatalog(yaml.dump(config)), /schema-2/)
  }
})

test('grouped registry derives categories and indexes IDs globally without mutation', () => {
  const config = groupedCatalog()
  const template = config['apps-cdns']['test-app']
  config.apps = { books: structuredClone(template) }
  config['apps-internals'] = { demo: structuredClone(template) }
  config['apps-platforms'] = { academy: structuredClone(template) }
  config['apps-pods'] = { accounts: structuredClone(template) }
  config['apps-suites'] = { one: structuredClone(template) }
  config['apps-widgets'] = { chat: structuredClone(template) }
  config['apps-cdns'].disabled = { ...template, enabled: false }
  const before = structuredClone(config)
  for (const [category, expected] of [
    ['apps', 'books'],
    ['cdns', 'test-app'],
    ['internals', 'demo'],
    ['platforms', 'academy'],
    ['pods', 'accounts'],
    ['suites', 'one'],
    ['widgets', 'chat']
  ])
    assert.deepEqual(listWebApps(config, category), [expected])
  assert.deepEqual(config, before)
})

test('grouped registry supports 50 apps across categories', () => {
  const config = groupedCatalog()
  const template = config['apps-cdns']['test-app']
  config['apps-cdns'] = {}
  config['apps-internals'] = {}
  for (let i = 0; i < 50; i++)
    config[i % 2 ? 'apps-cdns' : 'apps-internals'][`app-${i}`] =
      structuredClone(template)
  assert.equal(listWebApps(parseCatalog(yaml.dump(config)), 'cdns').length, 25)
  assert.equal(listWebApps(config, 'internals').length, 25)
})

test('duplicate IDs across groups fail even when one entry is disabled', () => {
  const config = groupedCatalog()
  config['apps-pods'] = {
    'test-app': { ...config['apps-cdns']['test-app'], enabled: false }
  }
  assert.throws(() => parseCatalog(yaml.dump(config)), /Duplicate web app ID/)
  assert.throws(() => listWebApps(config, 'cdns'), /Duplicate web app ID/)
  assert.throws(
    () => resolveWebApp(config, { app: 'test-app', environment: 'dev' }),
    /Duplicate web app ID/
  )
})

for (const [name, mutate, error] of [
  [
    'unknown group',
    config => {
      config.cdns = {}
    },
    /Unknown or invalid/
  ],
  [
    'non-map group',
    config => {
      config['apps-pods'] = []
    },
    /Unknown or invalid/
  ],
  [
    'non-map app',
    config => {
      config['apps-cdns']['test-app'] = null
    },
    /Invalid web app entry/
  ],
  [
    'invalid app ID',
    config => {
      config['apps-cdns']['Bad App'] = {}
    },
    /Invalid web app entry/
  ],
  [
    'redundant category',
    config => {
      config['apps-cdns']['test-app'].category = 'pods'
    },
    /Remove category/
  ],
  [
    'missing groups',
    config => {
      delete config['apps-cdns']
    },
    /at least one/
  ]
]) {
  test(`grouped registry rejects ${name}`, () => {
    const config = groupedCatalog()
    mutate(config)
    assert.throws(() => parseCatalog(yaml.dump(config)), error)
  })
}

test('empty grouped categories are valid and discover no apps', () => {
  const config = groupedCatalog()
  config['apps-cdns'] = {}
  assert.deepEqual(listWebApps(parseCatalog(yaml.dump(config)), 'cdns'), [])
})

for (const request of [
  { CATEGORY: 'cdns' },
  { APP: 'test-app', APP_ENV: 'production' }
]) {
  test(`grouped registry API resolves ${request.CATEGORY ? 'category matrix' : 'promotion app'}`, async () => {
    const outputs = {}
    await main({
      env: {
        CONFIG_REPO: 'example/deployer',
        CONFIG_REF: 'timeline',
        CONFIG_PATH: '.github/config/web-apps.yaml',
        ...request
      },
      github: {
        rest: {
          repos: {
            getContent: async () => ({
              data: {
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(yaml.dump(groupedCatalog())).toString(
                  'base64'
                )
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
    if (request.CATEGORY)
      assert.deepEqual(JSON.parse(outputs.apps), ['test-app'])
    else {
      assert.equal(outputs.app, 'test-app')
      assert.equal(outputs.credential_secret, 'TEST_PRODUCTION_GCP_SA_KEY')
    }
  })
}

test('apps without promotion_path emit the full order', () => {
  const app = resolveWebApp(groupedCatalog(), {
    app: 'test-app',
    environment: 'production'
  })
  assert.deepEqual(JSON.parse(app.promotion_path), [
    'tva',
    'dev',
    'qa',
    'preview',
    'production'
  ])
})

for (const path of [
  ['tva', 'preview', 'production'],
  ['tva', 'production']
]) {
  test(`app path ${path.join(' → ')} works independently of category`, () => {
    const config = groupedCatalog()
    config['apps-cdns']['test-app'].promotion_path = path
    const template = structuredClone(config['apps-cdns']['test-app'])
    config['apps-platforms'] = { academy: template }
    for (const app of ['test-app', 'academy']) {
      assert.deepEqual(
        JSON.parse(
          resolveWebApp(config, {
            app,
            caller: 'timeline',
            callerRepository: 'example/apps'
          }).promotion_path
        ),
        path
      )
      for (const environment of path.slice(1))
        assert.equal(
          resolveWebApp(config, { app, environment }).track_environment,
          environment
        )
      for (const environment of ['dev', 'qa', 'preview'].filter(
        env => !path.includes(env)
      ))
        assert.throws(
          () => resolveWebApp(config, { app, environment }),
          /not in the app promotion_path/
        )
    }
  })
}

test('invalid registry promotion paths fail explicitly', () => {
  const config = groupedCatalog()
  config['apps-cdns']['test-app'].promotion_path = [
    'tva',
    'preview',
    'qa',
    'production'
  ]
  assert.throws(() => listWebApps(config, 'cdns'), /promotion_path/)
})

const { listProductionDeployments } = require('./main.cjs')
test('single Production remains default and app/environment configuration is merged without changing the registry', () => {
  const config = catalog(),
    app = config['apps-cdns']['test-app']
  config.defaults.values = { API_URL: 'global', GLOBAL: true }
  app.values = { API_URL: 'app', APP_VALUE: 42 }
  config.defaults.environments.production.values = {
    API_URL: 'environment-default'
  }
  app.environments = {
    production: {
      values: { API_URL: 'production' },
      secret_values: { API_KEY: 'TEST_API_KEY' }
    }
  }
  const before = structuredClone(config)
  const result = resolveWebApp(config, {
    app: 'test-app',
    environment: 'production'
  })
  assert.equal(result.production_target, 'default')
  assert.deepEqual(JSON.parse(result.values), {
    API_URL: 'production',
    GLOBAL: true,
    APP_VALUE: 42
  })
  assert.deepEqual(JSON.parse(result.secret_values), {
    API_KEY: 'TEST_API_KEY'
  })
  assert.deepEqual(config, before)
})
test('app-specific destinations override profile, values, secrets and credentials', () => {
  const config = catalog(),
    app = config['apps-cdns']['test-app']
  app.values = { API: 'app', FROM_APP: true }
  app.secret_values = { TOKEN: 'APP_TOKEN', PUBLIC_TOKEN: 'APP_PUBLIC_TOKEN' }
  app.environments = {
    production: {
      values: { API: 'production' },
      secret_values: { SAME_KEY: 'ENV_KEY' }
    }
  }
  app.production_targets = {
    us: {
      credential_secret: 'US_KEY',
      values: { API: 'us', PUBLIC_TOKEN: 'public' },
      secret_values: { SAME_KEY: 'US_API_KEY', TOKEN: 'US_TOKEN' },
      debug: true
    },
    'customer-east': { credential_secret: 'CUSTOMER_KEY' }
  }
  delete app.credential_secrets.production
  const result = resolveWebApp(config, {
    app: 'test-app',
    environment: 'production',
    productionTarget: 'us'
  })
  assert.equal(result.credential_secret, 'US_KEY')
  assert.equal(result.debug, 'true')
  assert.deepEqual(JSON.parse(result.values), {
    API: 'us',
    FROM_APP: true,
    PUBLIC_TOKEN: 'public'
  })
  assert.deepEqual(JSON.parse(result.secret_values), {
    TOKEN: 'US_TOKEN',
    SAME_KEY: 'US_API_KEY'
  })
  assert.deepEqual(listProductionDeployments(config, 'cdns'), [
    { app: 'test-app', target: 'customer-east', category: 'cdns' },
    { app: 'test-app', target: 'us', category: 'cdns' }
  ])
  assert.throws(
    () => resolveWebApp(config, { app: 'test-app', environment: 'production' }),
    /Select a Production target/
  )
  assert.throws(
    () =>
      resolveWebApp(config, {
        app: 'test-app',
        environment: 'production',
        productionTarget: 'eu'
      }),
    /Unknown Production target/
  )
  assert.throws(
    () =>
      resolveWebApp(config, {
        app: 'test-app',
        environment: 'dev',
        productionTarget: 'us'
      }),
    /only valid for Production/
  )
})
for (const fields of [
  { values: { V_APP_ENV: 'other' } },
  { secret_values: { KEY: 'actual secret' } },
  { values: { KEY: {} } },
  { values: { KEY: null } },
  { values: { KEY: 'public' }, secret_values: { KEY: 'SECRET_NAME' } },
  { production_targets: {} },
  { production_targets: { us: {} } },
  { production_targets: { 'US East': { credential_secret: 'US_KEY' } } }
])
  test(`invalid app configuration fails: ${JSON.stringify(fields)}`, () => {
    const config = catalog()
    Object.assign(config['apps-cdns']['test-app'], fields)
    assert.throws(() => listProductionDeployments(config, 'cdns'))
  })
test('different apps discover their own target sets, including an explicit default target', () => {
  const config = catalog(),
    template = config['apps-cdns']['test-app']
  config['apps-cdns'].second = {
    ...template,
    production_targets: {
      default: { credential_secret: 'DEFAULT_KEY' },
      eu: { credential_secret: 'EU_KEY' }
    }
  }
  assert.deepEqual(listProductionDeployments(config, 'cdns'), [
    { app: 'second', target: 'default', category: 'cdns' },
    { app: 'second', target: 'eu', category: 'cdns' },
    { app: 'test-app', target: 'default', category: 'cdns' }
  ])
  assert.equal(
    resolveWebApp(config, { app: 'second', environment: 'production' })
      .credential_secret,
    'DEFAULT_KEY'
  )
})

test('the same app ID deploys TVA from each calling repository using the existing app profile', () => {
  const config = catalog(),
    before = structuredClone(config)
  for (const repository of ['example/apps', 'example-lab/fork-b']) {
    const app = resolveWebApp(config, {
      app: 'test-app',
      caller: 'timeline',
      callerRepository: repository
    })
    assert.equal(app.repository, repository)
    assert.equal(app.path, 'apps/test-app')
    assert.equal(app.git_ref, 'timeline')
    assert.equal(app.track_environment, 'tva')
    assert.equal(app.credential_secret, 'TEST_TVA_GCP_SA_KEY')
    assert.equal(app.build_environment, 'dev')
  }
  assert.deepEqual(config, before)
})
for (const callerRepository of [
  '',
  'missing-owner',
  'https://github.com/example/fork',
  '../example/fork',
  'example/fork\nnext'
])
  test(
    'TVA rejects missing or malformed calling repository: ' +
      JSON.stringify(callerRepository),
    () => {
      assert.throws(
        () =>
          resolveWebApp(catalog(), {
            app: 'test-app',
            caller: 'timeline',
            callerRepository
          }),
        /calling repository/
      )
    }
  )
test('a caller repository cannot redirect a manual promotion', () => {
  assert.throws(
    () =>
      resolveWebApp(catalog(), {
        app: 'test-app',
        environment: 'dev',
        callerRepository: 'example-lab/fork-b'
      }),
    /only used for TVA/
  )
  assert.equal(
    resolveWebApp(catalog(), { app: 'test-app', environment: 'production' })
      .repository,
    'example/apps'
  )
})
test('registry action forwards the TVA repository context to checkout and source tracking', async () => {
  const outputs = {}
  await main({
    env: {
      CONFIG_REPO: 'example/deployer',
      CONFIG_REF: 'timeline',
      CONFIG_PATH: '.github/config/web-apps.yaml',
      APP: 'test-app',
      CALLER: 'timeline',
      CALLER_REPO: 'example-lab/fork-b'
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
  assert.equal(outputs.repository, 'example-lab/fork-b')
  assert.equal(outputs.git_ref, 'timeline')
  assert.equal(outputs.credential_secret, 'TEST_TVA_GCP_SA_KEY')
})

test('all-app discovery spans categories and expands only enabled app Production targets', () => {
  const config = catalog(),
    template = config['apps-cdns']['test-app']
  config.apps = { books: structuredClone(template) }
  config['apps-widgets'] = {
    chat: {
      ...structuredClone(template),
      production_targets: {
        us: { credential_secret: 'US_KEY' },
        eu: { credential_secret: 'EU_KEY' }
      }
    }
  }
  config['apps-pods'] = {
    disabled: {
      ...structuredClone(template),
      enabled: false,
      credential_secrets: {}
    }
  }
  assert.deepEqual(listProductionDeployments(config), [
    { app: 'books', target: 'default', category: 'apps' },
    { app: 'chat', target: 'eu', category: 'widgets' },
    { app: 'chat', target: 'us', category: 'widgets' },
    { app: 'test-app', target: 'default', category: 'cdns' }
  ])
  assert.deepEqual(listWebApps(config, 'widgets'), ['chat'])
})
const discoveryApi = (config, request) => {
  const outputs = {},
    requests = []
  return {
    env: {
      CONFIG_REPO: 'example/deployer',
      CONFIG_REF: 'b'.repeat(40),
      CONFIG_PATH: '.github/config/web-apps.yaml',
      ...request
    },
    github: {
      rest: {
        repos: {
          getContent: async args => {
            requests.push(args)
            return {
              data: {
                type: 'file',
                encoding: 'base64',
                content: Buffer.from(yaml.dump(config)).toString('base64')
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
    },
    outputs,
    requests
  }
}
test('ALL_APPS action returns every target once with category labels and reads a pinned registry ref', async () => {
  const config = catalog()
  config.apps = { books: structuredClone(config['apps-cdns']['test-app']) }
  const input = discoveryApi(config, { ALL_APPS: 'true' })
  await main(input)
  assert.deepEqual(JSON.parse(input.outputs.apps), ['books', 'test-app'])
  assert.deepEqual(JSON.parse(input.outputs.deployments), [
    { app: 'books', target: 'default', category: 'apps' },
    { app: 'test-app', target: 'default', category: 'cdns' }
  ])
  assert.equal(input.requests[0].ref, 'b'.repeat(40))
})
test('ALL_APPS returns an empty matrix when no apps are enabled', async () => {
  const config = catalog()
  config['apps-cdns']['test-app'].enabled = false
  const input = discoveryApi(config, { ALL_APPS: 'true' })
  await main(input)
  assert.equal(input.outputs.deployments, '[]')
  assert.equal(input.outputs.apps, '[]')
})
for (const request of [
  {},
  { APP: 'test-app', CATEGORY: 'cdns' },
  { APP: 'test-app', ALL_APPS: 'true' },
  { CATEGORY: 'cdns', ALL_APPS: 'true' },
  { ALL_APPS: 'yes' }
])
  test(
    'ambiguous discovery selectors fail before registry access: ' +
      JSON.stringify(request),
    async () => {
      const input = discoveryApi(catalog(), request)
      await assert.rejects(main(input), /exactly one|ALL_APPS must/)
      assert.deepEqual(input.requests, [])
      assert.deepEqual(input.outputs, {})
    }
  )
test('all-app discovery validates enabled entries before publishing a matrix', async () => {
  const config = catalog()
  delete config['apps-cdns']['test-app'].credential_secrets.production
  const input = discoveryApi(config, { ALL_APPS: 'true' })
  await assert.rejects(main(input), /credential secret/)
  assert.deepEqual(input.outputs, {})
})
