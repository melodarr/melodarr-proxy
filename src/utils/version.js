function getAppVersion () {
  const envVersion = process.env.APP_VERSION
  if (envVersion) {
    const normalized = envVersion.trim().replace(/^v/i, '')
    if (normalized !== 'latest' && normalized !== 'unknown') {
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
