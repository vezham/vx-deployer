const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { mkdtempSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const action = readFileSync(path.join(__dirname, 'action.yml'), 'utf8')

const render = ({
  published = '',
  total = '',
  result = 'success',
  args = ''
} = {}) => {
  const directory = mkdtempSync(path.join(tmpdir(), 'vx-release-summary-'))
  const expressions = {
    'inputs.release_result': result,
    'inputs.actor': 'release-test',
    'github.server_url': 'https://github.com',
    'github.repository': 'vezham/example',
    'github.run_id': '123',
    'github.run_attempt': '1'
  }
  const shell = action
    .match(/      run: \|\n([\s\S]*?)\n    - name:/)[1]
    .replace(/^        /gm, '')
    .replace(
      /\$\{\{\s*([^}]+?)\s*\}\}/g,
      (_, key) => expressions[key.trim()] ?? ''
    )
  try {
    const execution = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
      cwd: directory,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_OUTPUT: path.join(directory, 'outputs'),
        SUMMARY_VERSION: '',
        SUMMARY_RESOLVED_VERSION: '26.0.0-alpha.7',
        SUMMARY_PUBLISHED_COUNT: published,
        SUMMARY_PUBLISHABLE_COUNT: total,
        SUMMARY_ARGS: args
      }
    })
    assert.equal(execution.status, 0, execution.stderr)
    return {
      markdown: readFileSync(
        path.join(directory, 'summary-release.md'),
        'utf8'
      ),
      outputs: readFileSync(path.join(directory, 'outputs'), 'utf8')
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

for (const [published, total] of [
  ['5', '8'],
  ['8', '8'],
  ['0', '8'],
  ['0', '0']
]) {
  test(`renders published/total publishable as ${published}/${total}`, () => {
    const { markdown } = render({ published, total })
    assert.ok(
      markdown.includes(`| 📦 Packages published | ${published}/${total} |`)
    )
    assert.match(markdown, /26\.0\.0-alpha\.7 \(auto \/ detected\)/)
  })
}

test('older callers without count outputs keep their summary without a package row', () => {
  const { markdown } = render()
  assert.doesNotMatch(markdown, /Packages published/)
  assert.match(markdown, /Release Successful/)
})

test('unknown publish results do not imply zero successful packages', () => {
  assert.match(
    render({ total: '8', result: 'failure' }).markdown,
    /Packages published \| —\/8/
  )
})

test('dry runs display zero publishes and retain their arguments', () => {
  const { markdown } = render({ published: '0', total: '8', args: '--dryRun' })
  assert.match(markdown, /Packages published \| 0\/8/)
  assert.match(markdown, /Args \| --dryRun/)
})

test('partial counts retain the failed release status', () => {
  const { markdown, outputs } = render({
    published: '5',
    total: '8',
    result: 'failure'
  })
  assert.match(markdown, /Packages published \| 5\/8/)
  assert.match(markdown, /Release Failed/)
  assert.match(outputs, /overall=failure/)
})

test('invalid count inputs are not rendered as reported publication counts', () => {
  assert.doesNotMatch(
    render({ published: '5', total: 'invalid' }).markdown,
    /Packages published/
  )
  assert.match(
    render({ published: 'invalid', total: '8' }).markdown,
    /Packages published \| —\/8/
  )
})
