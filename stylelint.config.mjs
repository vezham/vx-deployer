/** @type {import('stylelint').Config} */
export default {
  defaultSeverity: 'error',
  extends: [
    'stylelint-config-standard',
    'stylelint-config-recommended',
    'stylelint-prettier/recommended'
  ],
  rules: {
    'declaration-property-unit-allowed-list': {
      'font-size': ['rem'],
      '/^padding|^gap/': ['rem'],
      '/^animation/': ['ms']
    },
    'unit-allowed-list': ['rem', 'oklch', 'deg', '%', 'ms'],
    'color-no-hex': true,
    'color-no-invalid-hex': true,
    'at-rule-no-unknown': [
      true,
      { ignoreAtRules: ['/^tailwind/', 'plugin', 'source', 'custom-variant'] }
    ],
    'hue-degree-notation': 'number',
    'color-function-notation': ['legacy'],
    'no-descending-specificity': null,
    'import-notation': null
  }
}
