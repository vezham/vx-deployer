const conventional = require('@commitlint/config-conventional')

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-function-rules'],
  helpUrl:
    'https://storybook.vezham.com/?path=/docs/guidelines-contribution--overview#commit-convention',
  rules: {
    ...conventional.rules,
    'body-max-length': [2, 'always', 500],
    'body-max-line-length': [2, 'always', 1000],
    'type-enum': [
      2,
      'always',
      [
        'feat',
        'fix',
        'refactor',
        'mocks',
        // 'stories',
        'test',
        'docs',
        'i18n',
        'ci',
        'chore',
        'build'
      ]
    ],
    'function-rules/header-max-length': [0]
  }
}
