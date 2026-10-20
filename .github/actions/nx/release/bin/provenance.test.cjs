const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const actionRoot = path.resolve(__dirname, '..')
const yaml = readFileSync(path.join(actionRoot, 'action.yml'), 'utf8')

function runAction({
  provenance = 'true',
  args = '--dryRun',
  publishExit = 0
} = {}) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'vx-release-action-'))
  const bin = path.join(directory, 'bin')
  const log = path.join(directory, 'commands.jsonl')
  mkdirSync(bin)
  const stub = path.join(bin, 'pnpm')
  writeFileSync(
    stub,
    `#!/usr/bin/env node
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.VX_TEST_LOG, JSON.stringify({args, npm:process.env.NPM_CONFIG_PROVENANCE, pnpm:process.env.PNPM_CONFIG_PROVENANCE}) + '\\n');
if (args[0] === 'nx') {
  const result = spawnSync('pnpm', ['publish', 'package with spaces', '--dry-run', '--tag=alpha'], { stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
process.exit(Number(process.env.VX_TEST_PUBLISH_EXIT));
`
  )
  chmodSync(stub, 0o755)
  const shell = yaml
    .match(/      run: \|\n([\s\S]*?)\n      env:/)[1]
    .replace(/^        /gm, '')
  const provenanceEnv = {}
  for (const match of yaml.matchAll(
    /^        (\w+): \$\{\{ inputs\.NPM_PROVENANCE \}\}$/gm
  )) {
    provenanceEnv[match[1]] = provenance
  }
  try {
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
      encoding: 'utf8',
      env: {
        ...process.env,
        NPM_CONFIG_PROVENANCE: '',
        PNPM_CONFIG_PROVENANCE: '',
        ...provenanceEnv,
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        RELEASE_VERSION: '26.0.0-alpha.4',
        RELEASE_ARGS: args,
        VX_TEST_LOG: log,
        VX_TEST_PUBLISH_EXIT: String(publishExit)
      }
    })
    const commands = require('node:fs').existsSync(log)
      ? readFileSync(log, 'utf8')
          .trim()
          .split('\n')
          .map(line => JSON.parse(line))
      : []
    return { result, commands }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const provenance of ['true', 'false']) {
  test(`the action forwards provenance=${provenance} to nested npm and pnpm publishers`, () => {
    const { result, commands } = runAction({ provenance })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(commands.length, 2)
    assert.deepEqual(commands[0].args, [
      'nx',
      'run',
      '@vx:@vx-ws/release',
      '--',
      '--version=26.0.0-alpha.4',
      '--dryRun'
    ])
    assert.deepEqual(commands[1].args, [
      'publish',
      'package with spaces',
      '--dry-run',
      '--tag=alpha'
    ])
    for (const command of commands) {
      assert.equal(command.npm, provenance)
      assert.equal(command.pnpm, provenance)
    }
  })
}

test('a signing or publishing failure fails the action', () => {
  assert.equal(runAction({ publishExit: 7 }).result.status, 7)
})

test('unsupported release options fail before invoking pnpm', () => {
  const { result, commands } = runAction({ args: '--dryRun; echo unsafe' })
  assert.notEqual(result.status, 0)
  assert.deepEqual(commands, [])
})
