const conventional = require('@commitlint/config-conventional')

module.exports = {
  extends: ['@commitlint/config-conventional'],
  plugins: ['commitlint-plugin-function-rules'],
  helpUrl:
    'https://storybook.vezham.com/?path=/docs/guidelines-contribution--overview#commit-convention',
  rules: {
    ...conventional.rules,
    'function-rules/header-max-length': [0],
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
    'subject-case': [2, 'always', ['sentence-case', 'lower-case']],
    'body-max-length': [2, 'always', 500],
    'body-max-line-length': [2, 'always', 1000]
  }
}
