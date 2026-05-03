function getAppVersion () {
  const envVersion = process.env.APP_VERSION
  if (envVersion) {
    const trimmedEnvVersion = envVersion.trim()
    const normalizedForCheck = trimmedEnvVersion.replace(/^v/i, '').toLowerCase()
    if (normalizedForCheck !== 'latest' && normalizedForCheck !== 'unknown') {
      return trimmedEnvVersion
    }
  }
  try {
    return require('../../package.json').version
  } catch (err) {
    return 'unknown'
  }
}

module.exports = { getAppVersion }
