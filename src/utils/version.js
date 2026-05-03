function getAppVersion () {
  const envVersion = process.env.APP_VERSION
  if (envVersion) {
    const normalizedForCheck = envVersion.trim().replace(/^v/i, '')
    if (normalizedForCheck !== 'latest' && normalizedForCheck !== 'unknown') {
      return envVersion
    }
  }
  try {
    return require('../../package.json').version
  } catch (err) {
    return 'unknown'
  }
}

module.exports = { getAppVersion }
