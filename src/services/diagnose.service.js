const dns = require('dns').promises
const net = require('net')
const https = require('https')
const { URL } = require('url')
const { getConfigValue } = require('../settings/store')
const { getProviderTransport } = require('../infrastructure/network/provider-registry')

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

function errorDetails (err, fallback = {}) {
  if (!err && !fallback) return null

  return {
    code: err?.code || fallback.code || 'UNKNOWN',
    message: err?.message || fallback.message || String(err || fallback),
    syscall: err?.syscall || null,
    errno: err?.errno || null,
    address: err?.address || fallback.address || null,
    port: err?.port || fallback.port || null,
    hostname: err?.hostname || err?.host || fallback.hostname || null,
    reason: err?.reason || null,
    library: err?.library || null,
    function: err?.function || null
  }
}

function summarizeFailure ({ failedStep, error, selectedFamily }) {
  if (!failedStep) {
    return {
      summary: 'MusicBrainz responded successfully.',
      likelyCause: null,
      recommendations: []
    }
  }

  const code = error?.code || 'UNKNOWN'

  if (failedStep === 'dns') {
    return {
      summary: 'DNS resolution failed before any socket connection was attempted.',
      likelyCause: 'The runtime cannot resolve MusicBrainz host records from its current DNS configuration.',
      recommendations: [
        'Check container/LXC DNS servers and outbound DNS policy.',
        'Compare host DNS resolution with container DNS resolution.'
      ]
    }
  }

  if (failedStep === 'tcp') {
    const familyHint = selectedFamily ? `IPv${selectedFamily}` : 'IPv6'
    const recommendations = [
      `Check outbound TCP/443 routing for ${familyHint} from the proxy container.`,
      'MusicBrainz is IPv6-only for this proxy; do not attempt IPv4 fallback.'
    ]

    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') {
      recommendations.unshift('This is usually a routing problem, not a MusicBrainz application response.')
    }

    return {
      summary: `TCP connection failed before TLS completed (${code}).`,
      likelyCause: 'The selected address is unreachable or blocked from the proxy runtime.',
      recommendations
    }
  }

  if (failedStep === 'tls') {
    return {
      summary: `TCP connected, but TLS did not complete (${code}).`,
      likelyCause: 'The connection is being reset or interrupted during the TLS handshake.',
      recommendations: [
        'Check whether another host on the same Docker/LXC network can complete `curl -6 -v https://musicbrainz.org/`.',
        'Compare Proxmox host, LXC, and proxy container IPv6 behavior.',
        'Check MTU, PMTUD, firewall inspection, and upstream reset behavior on the IPv6 path.'
      ]
    }
  }

  if (failedStep === 'http') {
    return {
      summary: `MusicBrainz returned an HTTP error (${code}).`,
      likelyCause: 'The socket and TLS path worked, but MusicBrainz rejected or rate-limited the request.',
      recommendations: [
        'Inspect the returned HTTP status and rate-limit headers.',
        'Verify APP_NAME, APP_VERSION, and APP_CONTACT produce a valid MusicBrainz User-Agent.'
      ]
    }
  }

  if (failedStep === 'parse') {
    return {
      summary: 'MusicBrainz returned HTTP 2xx, but the body was not valid JSON.',
      likelyCause: 'The upstream response body is not the expected MusicBrainz JSON payload.',
      recommendations: [
        'Inspect content-type, body byte count, and any proxy/CDN response headers.'
      ]
    }
  }

  return {
    summary: `MusicBrainz probe failed at ${failedStep}.`,
    likelyCause: 'Unknown diagnostic state.',
    recommendations: ['Inspect the raw error object and recent /debug/upstream entries.']
  }
}

function summarizeGenericFailure ({ provider, failedStep, error, selectedFamily }) {
  const providerLabel = provider || 'provider'
  if (!failedStep) {
    return {
      summary: `${providerLabel} responded successfully.`,
      likelyCause: null,
      recommendations: []
    }
  }

  const code = error?.code || 'UNKNOWN'
  const familyHint = selectedFamily ? `IPv${selectedFamily}` : 'the selected network family'

  if (failedStep === 'dns') {
    return {
      summary: `DNS resolution failed before connecting to ${providerLabel}.`,
      likelyCause: 'The runtime cannot resolve the provider host from its current DNS configuration.',
      recommendations: [
        'Check container/LXC DNS servers and outbound DNS policy.',
        'Compare host DNS resolution with container DNS resolution.'
      ]
    }
  }

  if (failedStep === 'tcp') {
    return {
      summary: `TCP connection to ${providerLabel} failed before TLS completed (${code}).`,
      likelyCause: `The selected address is unreachable or blocked over ${familyHint}.`,
      recommendations: [
        `Check outbound TCP/443 routing for ${familyHint} from the proxy container.`,
        'Verify firewall, bridge, Docker network, and LXC egress rules.'
      ]
    }
  }

  if (failedStep === 'tls') {
    return {
      summary: `TCP connected to ${providerLabel}, but TLS did not complete (${code}).`,
      likelyCause: 'The connection is being reset or interrupted during the TLS handshake.',
      recommendations: [
        'Check TLS inspection, CA configuration, MTU/PMTUD, and provider-side resets.',
        'Compare curl behavior from the Proxmox host, LXC, and proxy container.'
      ]
    }
  }

  if (failedStep === 'http') {
    return {
      summary: `${providerLabel} returned an HTTP error (${code}).`,
      likelyCause: 'The network path worked, but the provider rejected or rate-limited the request.',
      recommendations: [
        'Inspect HTTP status, authentication settings, provider quota, and rate-limit headers.'
      ]
    }
  }

  if (failedStep === 'parse') {
    return {
      summary: `${providerLabel} returned HTTP 2xx, but the body was not valid JSON.`,
      likelyCause: 'The upstream response body is not the expected JSON payload.',
      recommendations: ['Inspect content-type, body byte count, and response headers.']
    }
  }

  return {
    summary: `${providerLabel} probe failed at ${failedStep}.`,
    likelyCause: 'Unknown diagnostic state.',
    recommendations: ['Inspect the raw error object and recent provider metrics.']
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
    const resultTls = {
      authorized: null,
      authorizationError: null,
      protocol: null,
      cipher: null,
      servername: null
    }
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
      socket.on('secureConnect', () => {
        phaseAt.secure = Date.now()
        resultTls.authorized = socket.authorized
        resultTls.authorizationError = socket.authorizationError || null
        resultTls.protocol = socket.getProtocol ? socket.getProtocol() : null
        resultTls.cipher = socket.getCipher ? socket.getCipher() : null
        resultTls.servername = socket.servername || null
      })
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
          tls: resultTls,
          phaseAt
        })
      })
      res.on('error', (err) => {
        resolve({ status: 'response_error', error: err, selectedAddress, selectedFamily, lookupError, tls: resultTls, phaseAt })
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
        tls: resultTls,
        phaseAt
      })
    })

    req.end()
  })
}

function buildProbeReport ({ label, configuredIpFamily, target, dnsBlock, result, provider = 'musicbrainz', summarize = summarizeFailure }) {
  const t = timings(result.phaseAt)
  const failedStep = classifyFailedStep(result)
  const ok = !failedStep

  const common = {
    label,
    ok,
    failedStep,
    target,
    dns: {
      ...dnsBlock,
      selectedAddress: result.selectedAddress,
      selectedFamily: result.selectedFamily
    },
    tcp: {
      connected: Boolean(result.phaseAt.connect),
      selectedAddress: result.selectedAddress,
      selectedFamily: result.selectedFamily
    },
    tls: result.tls || {
      authorized: null,
      authorizationError: null,
      protocol: null,
      cipher: null,
      servername: null
    },
    timingsMs: t
  }

  if (result.status === 'http_complete') {
    const httpHeaders = pickHeaders(result.headers, RELEVANT_HEADER_NAMES)
    const rateLimit = pickHeaders(result.headers, RATE_LIMIT_HEADER_NAMES)
    const error = ok
      ? null
      : failedStep === 'parse'
        ? errorDetails(null, { code: 'JSON_PARSE_ERROR', message: result.parseError })
        : errorDetails(null, { code: `HTTP_${result.httpStatus}`, message: `HTTP ${result.httpStatus} ${result.httpStatusText || ''}`.trim() })

    return {
      ...common,
      error,
      diagnosis: summarize({ provider, failedStep, error, selectedFamily: result.selectedFamily, configuredFamily: configuredIpFamily }),
      http: {
        status: result.httpStatus,
        statusText: result.httpStatusText,
        bodyBytes: result.bodyBytes,
        headers: httpHeaders,
        rateLimit,
        parsedKeys: result.parsed && typeof result.parsed === 'object' && !Array.isArray(result.parsed)
          ? Object.keys(result.parsed).slice(0, 10)
          : null
      }
    }
  }

  const err = result.error || result.lookupError || new Error('Unknown error')
  const error = errorDetails(err, {
    code: result.lookupError?.code,
    message: result.lookupError?.message,
    address: result.selectedAddress,
    hostname: target.hostname
  })

  return {
    ...common,
    error,
    diagnosis: summarize({ provider, failedStep, error, selectedFamily: result.selectedFamily, configuredFamily: configuredIpFamily })
  }
}

async function diagnoseMusicBrainz () {
  const baseUrl = getConfigValue('musicbrainzBaseUrl')
  const timeout = Math.min(getConfigValue('upstreamTimeoutMs') || 8000, 5000)
  const family = 6
  const ipFamilyConfig = '6'
  const startedAt = Date.now()

  const url = new URL(`${baseUrl}/artist/?query=test&fmt=json&limit=1`)
  const target = {
    url: url.toString(),
    hostname: url.hostname,
    configuredIpFamily: ipFamilyConfig,
    policy: 'ipv6_only',
    fallbackAllowed: false
  }

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
      error: errorDetails(err, { code: 'EDNS', message: err.message, hostname: url.hostname }),
      diagnosis: summarizeFailure({ failedStep: 'dns', error: errorDetails(err, { code: 'EDNS', message: err.message }), configuredFamily: ipFamilyConfig }),
      target,
      dns: { addresses: [], errors: { all: err.message } },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt }
    }
  }

  const dnsAddresses = [
    ...resolved.v4.map((a) => ({ address: a, family: 4 })),
    ...resolved.v6.map((a) => ({ address: a, family: 6 }))
  ]

  if (dnsAddresses.length === 0 || resolved.v6.length === 0) {
    const message = dnsAddresses.length === 0 ? 'No A or AAAA records resolved' : 'No AAAA records resolved for MusicBrainz IPv6-only policy'
    const code = dnsAddresses.length === 0 ? 'ENOTFOUND' : 'ENODATA'
    return {
      provider: 'musicbrainz',
      ok: false,
      failedStep: 'dns',
      error: errorDetails(null, { code, message, hostname: url.hostname }),
      diagnosis: summarizeFailure({ failedStep: 'dns', error: { code }, configuredFamily: ipFamilyConfig }),
      target,
      dns: { addresses: dnsAddresses, configuredFamily: ipFamilyConfig, errors: resolved.errors },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt },
      checkedAt: new Date().toISOString(),
      probes: []
    }
  }

  const dnsBlock = {
    addresses: dnsAddresses,
    configuredFamily: ipFamilyConfig,
    errors: resolved.errors
  }

  const probeDefinitions = [{ label: '6', family }]

  const reports = await Promise.all(probeDefinitions.map(async (probe) => {
    // Retry the probe up to 3 times for transient TLS failures (ECONNRESET).
    // Docker Desktop's IPv6 path through the Linux VM can intermittently drop
    // TLS handshake packets due to MTU/PMTUD issues; a single failure is not
    // conclusive. The retry is diagnostic-only and does not affect the hot path.
    const maxProbeAttempts = 3
    let lastResult
    for (let attempt = 1; attempt <= maxProbeAttempts; attempt++) {
      lastResult = await performRequest({ url, headers, family: probe.family, timeout })
      const step = classifyFailedStep(lastResult)
      if (!step || step === 'http' || step === 'parse') break // success or non-transient
      if (attempt < maxProbeAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt))
      }
    }
    return buildProbeReport({
      label: probe.label,
      configuredIpFamily: ipFamilyConfig,
      target: { ...target, probeFamily: probe.label },
      dnsBlock,
      result: lastResult
    })
  }))

  const primary = reports[0]

  return {
    ...primary,
    provider: 'musicbrainz',
    checkedAt: new Date().toISOString(),
    probes: reports
  }
}

async function diagnoseGenericProvider (providerName) {
  const config = getProviderTransport(providerName)
  if (!config || config.provider === 'musicbrainz') {
    const provider = String(providerName || '').trim().toLowerCase()
    const supported = ['itunes', 'theaudiodb', 'discogs', 'lastfm'].join(', ')
    return {
      provider,
      ok: false,
      failedStep: 'unsupported',
      error: {
        code: 'UNSUPPORTED_PROVIDER',
        message: `No generic diagnose pipeline for provider: ${provider}. Supported generic providers: ${supported}.`
      }
    }
  }

  const timeout = Math.min(getConfigValue('upstreamTimeoutMs') || 8000, 5000)
  const startedAt = Date.now()
  const url = new URL(config.url)
  const family = config.requiredFamily === 6 || config.requiredFamily === 4 ? config.requiredFamily : undefined
  const configuredIpFamily = family ? String(family) : 'auto'
  const target = {
    url: url.toString(),
    hostname: url.hostname,
    configuredIpFamily,
    policy: config.policy || 'auto',
    fallbackAllowed: config.fallbackAllowed !== false
  }

  let resolved
  try {
    resolved = await resolveAddresses(url.hostname)
  } catch (err) {
    const error = errorDetails(err, { code: 'EDNS', message: err.message, hostname: url.hostname })
    return {
      provider: config.provider,
      ok: false,
      failedStep: 'dns',
      error,
      diagnosis: summarizeGenericFailure({ provider: config.provider, failedStep: 'dns', error }),
      target,
      dns: { addresses: [], errors: { all: err.message } },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt },
      checkedAt: new Date().toISOString()
    }
  }

  const dnsAddresses = [
    ...resolved.v4.map((a) => ({ address: a, family: 4 })),
    ...resolved.v6.map((a) => ({ address: a, family: 6 }))
  ]

  if (dnsAddresses.length === 0) {
    const error = errorDetails(null, { code: 'ENOTFOUND', message: 'No A or AAAA records resolved', hostname: url.hostname })
    return {
      provider: config.provider,
      ok: false,
      failedStep: 'dns',
      error,
      diagnosis: summarizeGenericFailure({ provider: config.provider, failedStep: 'dns', error }),
      target,
      dns: { addresses: [], configuredFamily: configuredIpFamily, errors: resolved.errors },
      timingsMs: { dns: Date.now() - startedAt, tcp: null, tls: null, http: null, total: Date.now() - startedAt },
      checkedAt: new Date().toISOString()
    }
  }

  const dnsBlock = {
    addresses: dnsAddresses,
    configuredFamily: configuredIpFamily,
    errors: resolved.errors
  }

  const headers = { 'User-Agent': getUserAgent() }
  const result = await performRequest({ url, headers, family, timeout })
  const report = buildProbeReport({
    label: configuredIpFamily,
    configuredIpFamily,
    target: { ...target, probeFamily: configuredIpFamily },
    dnsBlock,
    result,
    provider: config.provider,
    summarize: summarizeGenericFailure
  })

  return {
    ...report,
    provider: config.provider,
    checkedAt: new Date().toISOString(),
    probes: [report]
  }
}

module.exports = {
  diagnoseMusicBrainz,
  diagnoseGenericProvider,
  // Exported for unit tests:
  classifyFailedStep,
  timings,
  pickHeaders,
  errorDetails,
  summarizeFailure,
  summarizeGenericFailure,
  RATE_LIMIT_HEADER_NAMES,
  RELEVANT_HEADER_NAMES
}
