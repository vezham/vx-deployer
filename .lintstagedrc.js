const { relative } = require('path')
const { ESLint } = require('eslint')

const removeIgnoredFiles = async files => {
  const cwd = process.cwd()
  const eslint = new ESLint()
  const relativePaths = files.map(file => relative(cwd, file))
  const isIgnored = await Promise.all(
    relativePaths.map(file => eslint.isPathIgnored(file))
  )
  const filteredFiles = files.filter((_, i) => !isIgnored[i])

  return filteredFiles.join(' ')
}

const formatCommand = async files => {
  const filesToLint = await removeIgnoredFiles(files)
  return [
    `prettier --config .prettierrc.mjs --ignore-path --write ${filesToLint}`
  ]
}

const eslintCommand = async files => {
  const filesToLint = await removeIgnoredFiles(files)
  return [`eslint -c eslint.config.mjs --max-warnings=0 --fix ${filesToLint}`]
}

const stylelintCommand = async files => {
  const filesToLint = await removeIgnoredFiles(files)
  return [
    `stylelint --allow-empty-input "**/*.{css,module.css}" --ignore-path ${filesToLint}`
  ]
}

module.exports = {
  //   'package.json': ['pnpm format:pkg'],
  //   '**/*.{js,jsx,ts,tsx}': [formatCommand, eslintCommand],
  //   '**/*.{css,module.css}': [formatCommand, stylelintCommand],
  //   '!*.{js,jsx,ts,tsx,css,module.css,package.json}': [formatCommand]
  '*': async files => {
    return ['pnpm @vx/ws:format'] // wjdlz/TODO: need to add lint fix as well
  }
}
