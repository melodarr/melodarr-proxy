const axios = require('axios')
const https = require('https')
const { getConfigValue } = require('../settings/store')

const musicBrainzAgents = new Map()

function getMusicBrainzHttpsAgent () {
  const configuredFamily = String(getConfigValue('musicbrainzIpFamily') || 'auto').trim()
  const family = configuredFamily === '6' ? 6 : configuredFamily === '4' ? 4 : undefined
  const key = family || 'auto'

  if (!musicBrainzAgents.has(key)) {
    musicBrainzAgents.set(key, new https.Agent({
      keepAlive: true,
      ...(family ? { family } : {})
    }))
  }

  return musicBrainzAgents.get(key)
}

let lastRequestTime = 0
let requestQueue = Promise.resolve()

async function enqueueRequest (fn) {
  const minInterval = getConfigValue('minRequestIntervalMs') || 1100

  const waitPromise = requestQueue.then(async () => {
    const now = Date.now()
    const timeSinceLast = now - lastRequestTime
    if (timeSinceLast < minInterval) {
      await new Promise(resolve => setTimeout(resolve, minInterval - timeSinceLast))
    }
    lastRequestTime = Date.now()
  }).catch(() => {
    lastRequestTime = Date.now()
  })

  requestQueue = waitPromise
  await waitPromise

  return fn()
}

class UpstreamService {
  getUserAgent () {
    const appName = getConfigValue('appName')
    const appVersion = getConfigValue('appVersion')
    const appContact = getConfigValue('appContact')
    return `${appName}/${appVersion} (${appContact})`
  }

  getMusicBrainzHeaders () {
    const headers = { 'User-Agent': this.getUserAgent() }
    const apiKey = getConfigValue('musicbrainzApiKey')

    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`
    }

    return headers
  }

  async probe () {
    const baseUrl = getConfigValue('musicbrainzBaseUrl')
    const configured = getConfigValue('upstreamTimeoutMs') || 8000
    const timeout = Math.min(configured, 5000)

    try {
      const res = await axios.get(`${baseUrl}/artist/?query=test&fmt=json&limit=1`, {
        headers: this.getMusicBrainzHeaders(),
        httpsAgent: getMusicBrainzHttpsAgent(),
        timeout,
        validateStatus: () => true
      })

      if (res.status === 200) {
        return { status: 'healthy', error: null }
      }
      if (res.status === 429) {
        return {
          status: 'rate_limited',
          error: { message: 'Upstream rate limit hit', code: 'HTTP_429', status: 429 }
        }
      }
      if (res.status >= 500) {
        return {
          status: 'degraded',
          error: { message: `Upstream returned ${res.status}`, code: `HTTP_${res.status}`, status: res.status }
        }
      }
      return {
        status: 'degraded',
        error: { message: `Unexpected upstream status ${res.status}`, code: `HTTP_${res.status}`, status: res.status }
      }
    } catch (err) {
      const code = err.code || null
      if (code === 'ECONNABORTED' || /timeout/i.test(err.message || '')) {
        return {
          status: 'timeout',
          error: { message: err.message, code: code || 'TIMEOUT', status: null }
        }
      }
      return {
        status: 'unreachable',
        error: { message: err.message, code, status: err.response?.status || null }
      }
    }
  }

  async checkHealth () {
    const result = await this.probe()
    return result.status === 'healthy' ? 'reachable' : 'unreachable'
  }

  async search (query) {
    const baseUrl = getConfigValue('musicbrainzBaseUrl')
    const timeout = getConfigValue('upstreamTimeoutMs')

    return enqueueRequest(async () => {
      const url = `${baseUrl}/artist/?query=${encodeURIComponent(query)}&fmt=json`
      const res = await axios.get(url, {
        headers: this.getMusicBrainzHeaders(),
        httpsAgent: getMusicBrainzHttpsAgent(),
        timeout
      })
      return res.data
    })
  }

  async musicBrainzGet (path, params) {
    const baseUrl = getConfigValue('musicbrainzBaseUrl')
    const timeout = getConfigValue('upstreamTimeoutMs')

    let lastError

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await enqueueRequest(async () => {
          const response = await axios.get(`${baseUrl}${path}`, {
            headers: this.getMusicBrainzHeaders(),
            httpsAgent: getMusicBrainzHttpsAgent(),
            params: { fmt: 'json', ...params },
            timeout
          })
          return response.data
        })
      } catch (error) {
        lastError = error

        if (error.response?.status && error.response.status < 500 && error.response.status !== 429) {
          throw error
        }

        if (attempt < 3) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 500))
        }
      }
    }

    const logger = require('../utils/logger')
    logger.error(`Upstream request failed after 3 attempts: ${baseUrl}${path}`, { error: lastError })
    throw lastError
  }
}

module.exports = new UpstreamService()
