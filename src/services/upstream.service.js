const axios = require('axios')
const crypto = require('crypto')
const dns = require('dns').promises
const https = require('https')
const net = require('net')
const { URL } = require('url')
const { getConfigValue } = require('../settings/store')
const upstreamBuffer = require('../diagnostics/upstream-buffer')
const { nextRetryDelay, parseRetryAfter } = require('./retry-policy')

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

async function lookupForRecord (hostname, family) {
  if (!hostname) return null
  const literalFamily = net.isIP(hostname)
  if (literalFamily) return { address: hostname, family: literalFamily }
  try {
    const opts = family ? { family } : {}
    const result = await dns.lookup(hostname, opts)
    return { address: result.address, family: result.family }
  } catch (_e) {
    return null
  }
}

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
    const ipFamilyConfig = String(getConfigValue('musicbrainzIpFamily') || 'auto').trim()
    const family = ipFamilyConfig === '4' ? 4 : ipFamilyConfig === '6' ? 6 : undefined
    const maxAttempts = Math.max(1, Number(getConfigValue('upstreamMaxAttempts')) || 3)
    const retryBaseMs = Math.max(1, Number(getConfigValue('upstreamRetryBaseMs')) || 500)
    const retryMaxMs = Math.max(retryBaseMs, Number(getConfigValue('upstreamRetryMaxMs')) || 30000)

    let hostname = null
    try { hostname = new URL(baseUrl).hostname } catch (_e) {}

    // One requestId per musicBrainzGet call — shared across all retry
    // attempts so operators can group attempts in /debug/upstream by request.
    const requestId = crypto.randomBytes(8).toString('hex')

    const logger = require('../utils/logger')
    let lastError

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const startedAt = Date.now()
      // Pre-lookup so we can record what IP/family the agent would resolve.
      // Keep-alive may reuse a socket and skip resolution; this is a best-
      // effort hint, not authoritative. lookupForRecord is wrapped in try/
      // catch so a DNS failure here never blocks the actual request.
      const ipInfo = await lookupForRecord(hostname, family)

      let response = null
      let error = null
      try {
        response = await enqueueRequest(async () => {
          return await axios.get(`${baseUrl}${path}`, {
            headers: this.getMusicBrainzHeaders(),
            httpsAgent: getMusicBrainzHttpsAgent(),
            params: { fmt: 'json', ...params },
            timeout
          })
        })
      } catch (err) {
        error = err
      }

      const status = error ? (error.response?.status || null) : (response?.status ?? 200)
      const retryAfterHeader = error ? error.response?.headers?.['retry-after'] : null

      // Decide retry policy *before* recording the entry so nextWaitMs and
      // retryAfterMs can be captured in the ring buffer for this attempt.
      const isRetryEligible = !!error && (
        !status ||
        status >= 500 ||
        status === 429
      )

      let decision = { willRetry: false, delayMs: 0, retryAfterMs: null }
      if (isRetryEligible) {
        decision = nextRetryDelay({
          attempt,
          maxAttempts,
          baseMs: retryBaseMs,
          maxMs: retryMaxMs,
          status,
          retryAfterHeader
        })
      } else if ((status === 429 || status === 503) && retryAfterHeader) {
        // Capture Retry-After even when we won't retry (e.g. final attempt),
        // so operators see what the server told us.
        decision.retryAfterMs = parseRetryAfter(retryAfterHeader)
      }

      upstreamBuffer.record({
        ts: new Date().toISOString(),
        requestId,
        provider: 'musicbrainz',
        path,
        attempt,
        selectedAddress: ipInfo?.address || null,
        selectedFamily: ipInfo?.family || null,
        failedStep: error ? upstreamBuffer.classifyFailedStep({ error, status }) : null,
        error: error ? { code: error.code || null, message: error.message || null } : null,
        httpStatus: status,
        durationMs: Date.now() - startedAt,
        retryAfterMs: decision.retryAfterMs,
        nextWaitMs: decision.willRetry ? decision.delayMs : null
      })

      if (!error) {
        return response.data
      }

      // 4xx (non-429): throw immediately. Preserves prior behavior.
      if (!isRetryEligible) {
        throw error
      }

      lastError = error

      if (!decision.willRetry) {
        // Out of attempts.
        break
      }

      logger.warn('Upstream retry', {
        provider: 'musicbrainz',
        path,
        requestId,
        attempt,
        nextAttempt: attempt + 1,
        reason: error.code || (status ? `HTTP_${status}` : 'UNKNOWN'),
        nextWaitMs: decision.delayMs,
        retryAfterMs: decision.retryAfterMs
      })

      await new Promise((resolve) => setTimeout(resolve, decision.delayMs))
    }

    logger.error(`Upstream request failed after ${maxAttempts} attempts: ${baseUrl}${path}`, { error: lastError })
    throw lastError
  }
}

module.exports = new UpstreamService()
