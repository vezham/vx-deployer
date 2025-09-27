import nx from '@nx/eslint-plugin'
import tanstackQuery from '@tanstack/eslint-plugin-query'

// import react from 'eslint-plugin-react'
// import reactHooks from 'eslint-plugin-react-hooks'
const ignores = [
  '**/dist',
  '**/node_modules',
  '**/coverage',
  '**/vite.config.*.timestamp*',
  '**/vitest.config.*.timestamp*',
  '**/test-output',
  '**/.vezham',
  '**/.nx',
  '**/.lintstagedrc.js',
  '**/routeTree.gen.ts'
]

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tanstackQuery.configs['flat/recommended'],
  {
    ignores
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*']
            }
          ]
        }
      ]
    }
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs'
    ],
    // Override or add rules here
    rules: {}
  },
  // --- wjdlz/NOTE(v): skipped for internal tools
  // wjdlz/TODO: set workspace config
  {
    ignores: ['**/vite.config.*.timestamp*', '**/vitest.config.*.timestamp*']
  }
]
