const https = require('https')
const { getConfigValue } = require('../settings/store')

const providerAgents = new Map()

function normalizeProviderIpFamily (familyValue = 'auto') {
  const normalized = String(familyValue || 'auto').trim().toLowerCase()
  if (normalized === '4') return 4
  if (normalized === '6') return 6
  return 'auto'
}

function getProviderHttpsAgent (familyValue = 'auto') {
  const family = normalizeProviderIpFamily(familyValue)
  const key = String(family)

  if (!providerAgents.has(key)) {
    const agentOpts = { keepAlive: true }
    if (family !== 'auto') {
      agentOpts.family = family
    }
    providerAgents.set(key, new https.Agent(agentOpts))
  }

  return providerAgents.get(key)
}

const httpsAgent = getProviderHttpsAgent('auto')

function pickLargestImage (images) {
  if (!Array.isArray(images)) {
    return ''
  }

  const image = [...images].reverse().find((item) => item?.['#text'])
  return image?.['#text'] || ''
}

function getProviderUserAgent () {
  const appName = getConfigValue('appName') || 'melodarr-proxy'
  const appVersion = getConfigValue('appVersion') || 'unknown'
  const appContact = getConfigValue('appContact') || ''
  return `${appName.trim()}/${appVersion.trim()} (${appContact.trim()})`
}

module.exports = {
  httpsAgent,
  getProviderHttpsAgent,
  normalizeProviderIpFamily,
  pickLargestImage,
  getProviderUserAgent
}
