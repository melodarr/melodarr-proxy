const dns = require('dns').promises
const net = require('net')
const https = require('https')
const { URL } = require('url')
const { getConfigValue } = require('../settings/store')

// MusicBrainz and most well-behaved upstreams expose rate-limit info via these
// headers. We surface them verbatim so operators can see exactly what the
// server told us — instead of inferring "rate limited" from a status code.
const RATE_LIMIT_HEADER_NAMES = [
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-rate-limit-limit',
  'x-rate-limit-remaining',
  'x-rate-limit-reset'
]

const RELEVANT_HEADER_NAMES = [
  'content-type',
  'content-length',
  'date',
  'server',
  'cache-control',
  'x-mb-version'
]

function pickHeaders (headers, allowList) {
  const out = {}
  if (!headers) return out
  for (const name of allowList) {
    if (headers[name] !== undefined) out[name] = headers[name]
  }
  return out
}

function getUserAgent () {
  const appName = getConfigValue('appName')
  const appVersion = getConfigValue('appVersion')
  const appContact = getConfigValue('appContact')
  return `${appName}/${appVersion} (${appContact})`
}

function resolveFamily () {
  const configured = String(getConfigValue('musicbrainzIpFamily') || 'auto').trim()
  if (configured === '4') return 4
  if (configured === '6') return 6
  return undefined
}

async function resolveAddresses (hostname) {
  const result = { v4: [], v6: [], errors: {} }
  const [v4, v6] = await Promise.allSettled([
    dns.resolve4(hostname),
    dns.resolve6(hostname)
  ])
  if (v4.status === 'fulfilled') result.v4 = v4.value
  else result.errors.v4 = v4.reason?.code || v4.reason?.message || 'unknown'
  if (v6.status === 'fulfilled') result.v6 = v6.value
  else result.errors.v6 = v6.reason?.code || v6.reason?.message || 'unknown'
  return result
}

function classifyFailedStep (result) {
  // Order matters: dns → tcp → tls → http → parse.
  // socket.lookup fires even on resolution failure, so check lookupError first.
  if (result.lookupError) return 'dns'
  if (!result.phaseAt.lookup) return 'dns'
  if (!result.phaseAt.connect) return 'tcp'
  if (!result.phaseAt.secure) return 'tls'
  if (result.status === 'http_complete') {
    if (result.httpStatus >= 200 && result.httpStatus < 300) {
      return result.parseError ? 'parse' : null
    }
    return 'http'
  }
  return 'http'
}

function timings (phaseAt) {
  const start = phaseAt.start
  const fallbackEnd = phaseAt.end || phaseAt.response || phaseAt.secure || phaseAt.connect || phaseAt.lookup || Date.now()
  return {
    dns: phaseAt.lookup ? phaseAt.lookup - start : null,
    tcp: phaseAt.connect && phaseAt.lookup ? phaseAt.connect - phaseAt.lookup : null,
    tls: phaseAt.secure && phaseAt.connect ? phaseAt.secure - phaseAt.connect : null,
    http: phaseAt.end && phaseAt.secure ? phaseAt.end - phaseAt.secure : null,
    total: fallbackEnd - start
  }
}

function performRequest ({ url, headers, family, timeout }) {
  return new Promise((resolve) => {
    const phaseAt = { start: Date.now(), lookup: 0, connect: 0, secure: 0, response: 0, end: 0 }
    // If the hostname is already an IP literal, Node skips DNS and never emits
    // socket.lookup. Mark DNS as "completed instantly" so failedStep classification
    // doesn't incorrectly blame DNS for downstream TCP/TLS errors.
    const literalFamily = net.isIP(url.hostname)
    let selectedAddress = literalFamily ? url.hostname : null
    let selectedFamily = literalFamily || null
    let lookupError = null
    if (literalFamily) phaseAt.lookup = phaseAt.start

    const req = https.request({
      hostname: url.hostname,
      port: url.port || 443,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
      // Fresh socket per call: diagnose is cold-path by design so we always
      // measure DNS+TCP+TLS handshake times. The hot path keeps connections
      // alive via getMusicBrainzHttpsAgent() — we deliberately don't reuse it.
      agent: false,
      family,
      timeout
    })

    req.on('socket', (socket) => {
      socket.on('lookup', (err, addr, fam) => {
        phaseAt.lookup = Date.now()
        if (err) {
          lookupError = err
        } else {
          selectedAddress = addr
          selectedFamily = fam || null
        }
      })
      socket.on('connect', () => { phaseAt.connect = Date.now() })
      socket.on('secureConnect', () => { phaseAt.secure = Date.now() })
    })

    req.on('response', (res) => {
      phaseAt.response = Date.now()
      const chunks = []
      let bytes = 0
      res.on('data', (c) => { chunks.push(c); bytes += c.length })
      res.on('end', () => {
        phaseAt.end = Date.now()
        let bodyText = ''
        try { bodyText = Buffer.concat(chunks).toString('utf8') } catch (_e) {}

        let parsed = null
        let parseError = null
        try { parsed = bodyText ? JSON.parse(bodyText) : null } catch (e) { parseError = e.message }

        resolve({
          status: 'http_complete',
          httpStatus: res.statusCode,
          httpStatusText: res.statusMessage,
          headers: res.headers || {},
          bodyBytes: bytes,
          parsed,
          parseError,
          selectedAddress,
          selectedFamily,
          lookupError,
          phaseAt
        })
      })
      res.on('error', (err) => {
        resolve({ status: 'response_error', error: err, selectedAddress, selectedFamily, lookupError, phaseAt })
      })
    })

    req.on('timeout', () => {
      const err = new Error('Request timed out')
      err.code = 'ETIMEDOUT'
      req.destroy(err)
    })

    req.on('error', (err) => {
      resolve({
        status: 'request_error',
        error: err,
        selectedAddress,
        selectedFamily,
        lookupError,
        phaseAt
      })
    })

    req.end()
  })
}

async function diagnoseMusicBrainz () {
  const baseUrl = getConfigValue('musicbrainzBaseUrl')
  const timeout = Math.min(getConfigValue('upstreamTimeoutMs') || 8000, 5000)
  const family = resolveFamily()
  const ipFamilyConfig = String(getConfigValue('musicbrainzIpFamily') || 'auto').trim()
  const startedAt = Date.now()

  const url = new URL(`${baseUrl}/artist/?query=test&fmt=json&limit=1`)

  const headers = { 'User-Agent': getUserAgent() }
  const apiKey = getConfigValue('musicbrainzApiKey')
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`

  let resolved
  try {
    resolved = await resolveAddresses(url.hostname)
  } catch (err) {
    return {
      provider: 'musicbrainz',
      ok: false,
      failedStep: 'dns',
      error: { code: err.code || 'EDNS', message: err.message },
      target: { url: url.toString(), hostname: url.hostname, configuredIpFamily: ipFamilyConfig },
      dns: { addresses: [], errors: { all: err.message } },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt }
    }
  }

  const dnsAddresses = [
    ...resolved.v4.map((a) => ({ address: a, family: 4 })),
    ...resolved.v6.map((a) => ({ address: a, family: 6 }))
  ]

  if (dnsAddresses.length === 0) {
    return {
      provider: 'musicbrainz',
      ok: false,
      failedStep: 'dns',
      error: { code: 'ENOTFOUND', message: 'No A or AAAA records resolved' },
      target: { url: url.toString(), hostname: url.hostname, configuredIpFamily: ipFamilyConfig },
      dns: { addresses: [], errors: resolved.errors },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt }
    }
  }

  const result = await performRequest({ url, headers, family, timeout })
  const t = timings(result.phaseAt)

  const dnsBlock = {
    addresses: dnsAddresses,
    selectedAddress: result.selectedAddress,
    selectedFamily: result.selectedFamily,
    configuredFamily: ipFamilyConfig,
    errors: resolved.errors
  }

  if (result.status === 'http_complete') {
    const failedStep = classifyFailedStep(result)
    const ok = !failedStep
    const httpHeaders = pickHeaders(result.headers, RELEVANT_HEADER_NAMES)
    const rateLimit = pickHeaders(result.headers, RATE_LIMIT_HEADER_NAMES)
    return {
      provider: 'musicbrainz',
      ok,
      failedStep,
      error: ok
        ? null
        : failedStep === 'parse'
          ? { code: 'JSON_PARSE_ERROR', message: result.parseError }
          : { code: `HTTP_${result.httpStatus}`, message: `HTTP ${result.httpStatus} ${result.httpStatusText || ''}`.trim() },
      target: { url: url.toString(), hostname: url.hostname, configuredIpFamily: ipFamilyConfig },
      dns: dnsBlock,
      http: {
        status: result.httpStatus,
        statusText: result.httpStatusText,
        bodyBytes: result.bodyBytes,
        headers: httpHeaders,
        rateLimit,
        parsedKeys: result.parsed && typeof result.parsed === 'object' && !Array.isArray(result.parsed)
          ? Object.keys(result.parsed).slice(0, 10)
          : null
      },
      timingsMs: t
    }
  }

  const err = result.error || new Error('Unknown error')
  const failedStep = classifyFailedStep(result)
  return {
    provider: 'musicbrainz',
    ok: false,
    failedStep,
    error: {
      code: err.code || result.lookupError?.code || 'UNKNOWN',
      message: err.message || result.lookupError?.message || String(err)
    },
    target: { url: url.toString(), hostname: url.hostname, configuredIpFamily: ipFamilyConfig },
    dns: dnsBlock,
    timingsMs: t
  }
}

module.exports = {
  diagnoseMusicBrainz,
  // Exported for unit tests:
  classifyFailedStep,
  timings,
  pickHeaders,
  RATE_LIMIT_HEADER_NAMES,
  RELEVANT_HEADER_NAMES
}
