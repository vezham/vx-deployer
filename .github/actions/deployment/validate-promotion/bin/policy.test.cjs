const assert = require('node:assert/strict')
const { test } = require('node:test')
const { getPromotionPath, getPreviousEnvironment } = require('./policy.cjs')

const full = ['tva', 'dev', 'qa', 'preview', 'production']

test('omitting the path keeps the full order and returns an independent array', () => {
  const path = getPromotionPath()
  assert.deepEqual(path, full)
  path.pop()
  assert.deepEqual(getPromotionPath(), full)
})

for (let mask = 0; mask < 8; mask++) {
  const path = [
    'tva',
    ...['dev', 'qa', 'preview'].filter((_, i) => mask & (1 << i)),
    'production'
  ]
  test(`valid path ${path.join(' → ')} requires the preceding included stage`, () => {
    assert.deepEqual(getPromotionPath(path), path)
    for (let i = 1; i < path.length; i++)
      assert.equal(getPreviousEnvironment(path[i], path), path[i - 1])
    for (const omitted of full.filter(stage => !path.includes(stage)))
      assert.throws(
        () => getPreviousEnvironment(omitted, path),
        /not in the app promotion_path/
      )
  })
}

for (const path of [
  null,
  'tva,production',
  [],
  ['production'],
  ['dev', 'production'],
  ['tva', 'preview'],
  ['tva', 'dev', 'dev', 'production'],
  ['tva', 'preview', 'qa', 'production'],
  ['tva', 'other', 'production'],
  ['tva', 24, 'production'],
  ['tva', 'production', 'preview']
]) {
  test(`reject invalid path ${JSON.stringify(path)}`, () =>
    assert.throws(() => getPromotionPath(path), /promotion_path/))
}

test('TVA is a build entrypoint, not a promotion destination', () =>
  assert.throws(() => getPreviousEnvironment('tva', full), /Cannot promote/))
