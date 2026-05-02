function getAppVersion () {
  const envVersion = process.env.APP_VERSION
  if (envVersion && envVersion !== 'latest' && envVersion !== 'unknown') {
    return envVersion
  }
  try {
    return require('../../package.json').version
  } catch (err) {
    return 'unknown'
  }
}

module.exports = { getAppVersion }
