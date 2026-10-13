'use strict'

const defaultPath = ['tva', 'dev', 'qa', 'preview', 'production']

const getPromotionPath = (path = defaultPath) => {
  if (
    !Array.isArray(path) ||
    path.length < 2 ||
    path[0] !== 'tva' ||
    path.at(-1) !== 'production' ||
    path.some((stage, index) => {
      const position = defaultPath.indexOf(stage)
      return (
        position === -1 ||
        (index > 0 && position <= defaultPath.indexOf(path[index - 1]))
      )
    })
  )
    throw new Error(
      'promotion_path must start with tva, end with production and follow TVA → Dev → QA → Preview → Production without duplicates'
    )
  return [...path]
}

const getPreviousEnvironment = (environment, path) => {
  const stages = getPromotionPath(path)
  const index = stages.indexOf(environment)
  if (index < 1)
    throw new Error(
      `Cannot promote to ${environment}: destination is not in the app promotion_path (${stages.join(' → ')})`
    )
  return stages[index - 1]
}

module.exports = { getPromotionPath, getPreviousEnvironment }
