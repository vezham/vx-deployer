'use strict'

const resolveSource = ({
  environment,
  ref = '',
  sha = '',
  latest = 'false'
}) => {
  if (!['tva', 'dev', 'qa', 'preview', 'production'].includes(environment)) {
    throw new Error('TRACK_ENV must be tva, dev, qa, preview or production')
  }
  if (!['true', 'false'].includes(latest))
    throw new Error('USE_LATEST_PRODUCTION must be true or false')
  if (environment === 'tva') {
    if (sha || latest === 'true')
      throw new Error(
        'TVA builds cannot specify GIT_SHA or USE_LATEST_PRODUCTION'
      )
    if (ref !== 'timeline')
      throw new Error('TVA builds require the timeline source branch')
    return { git_ref: ref, needs_validation: 'false' }
  }
  if (ref) throw new Error('Promotions require GIT_SHA, not a source branch')
  if (latest === 'true') {
    if (environment !== 'production' || sha) {
      throw new Error(
        'USE_LATEST_PRODUCTION requires Production and no GIT_SHA'
      )
    }
  } else if (!/^[a-f0-9]{40}$/i.test(sha)) {
    throw new Error('Manual promotion requires a full 40-character GIT_SHA')
  }
  return { git_ref: '', needs_validation: 'true' }
}

module.exports = { resolveSource }
