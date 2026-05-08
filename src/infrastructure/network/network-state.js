const MUSICBRAINZ_STATES = Object.freeze({
  HEALTHY: 'MUSICBRAINZ_IPV6_HEALTHY',
  DNS_FAILED: 'MUSICBRAINZ_IPV6_DNS_FAILED',
  NO_ROUTE: 'MUSICBRAINZ_IPV6_NO_ROUTE',
  TCP_FAILED: 'MUSICBRAINZ_IPV6_TCP_FAILED',
  TLS_FAILED: 'MUSICBRAINZ_IPV6_TLS_FAILED',
  HTTP_FAILED: 'MUSICBRAINZ_IPV6_HTTP_FAILED',
  UNAVAILABLE: 'MUSICBRAINZ_UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
})

const MUSICBRAINZ_POLICY = Object.freeze({
  provider: 'musicbrainz',
  policy: 'ipv6_only',
  family: 6,
  fallbackAllowed: false
})

const GENERIC_PROVIDER_STATES = Object.freeze({
  HEALTHY: 'HEALTHY',
  DNS_FAILED: 'DNS_FAILED',
  TCP_FAILED: 'TCP_FAILED',
  TLS_FAILED: 'TLS_FAILED',
  HTTP_FAILED: 'HTTP_FAILED',
  UNAVAILABLE: 'UNAVAILABLE',
  UNKNOWN: 'UNKNOWN'
})

function classifyMusicBrainzReport (report = {}) {
  if (!report || Object.keys(report).length === 0) return MUSICBRAINZ_STATES.UNKNOWN
  if (report.ok) return MUSICBRAINZ_STATES.HEALTHY

  const failedStep = report.failedStep || 'unknown'
  const code = report.error?.code || ''

  if (failedStep === 'dns') return MUSICBRAINZ_STATES.DNS_FAILED
  if (failedStep === 'tcp') {
    if (code === 'ENETUNREACH' || code === 'EHOSTUNREACH') return MUSICBRAINZ_STATES.NO_ROUTE
    return MUSICBRAINZ_STATES.TCP_FAILED
  }
  if (failedStep === 'tls') return MUSICBRAINZ_STATES.TLS_FAILED
  if (failedStep === 'http') return MUSICBRAINZ_STATES.HTTP_FAILED
  if (failedStep === 'parse') return MUSICBRAINZ_STATES.HTTP_FAILED

  return MUSICBRAINZ_STATES.UNAVAILABLE
}

function classifyGenericProviderReport (report = {}) {
  if (!report || Object.keys(report).length === 0) return GENERIC_PROVIDER_STATES.UNKNOWN
  if (report.ok) return GENERIC_PROVIDER_STATES.HEALTHY

  const failedStep = report.failedStep || 'unknown'

  if (failedStep === 'dns') return GENERIC_PROVIDER_STATES.DNS_FAILED
  if (failedStep === 'tcp') return GENERIC_PROVIDER_STATES.TCP_FAILED
  if (failedStep === 'tls') return GENERIC_PROVIDER_STATES.TLS_FAILED
  if (failedStep === 'http') return GENERIC_PROVIDER_STATES.HTTP_FAILED
  if (failedStep === 'parse') return GENERIC_PROVIDER_STATES.HTTP_FAILED

  return GENERIC_PROVIDER_STATES.UNAVAILABLE
}

function recommendationsForMusicBrainzState (state) {
  if (state === MUSICBRAINZ_STATES.HEALTHY) return []

  if (state === MUSICBRAINZ_STATES.DNS_FAILED) {
    return [
      'Verify DNS inside the proxy container can resolve the MusicBrainz AAAA record.',
      'Compare DNS from the Proxmox host, the LXC, and the proxy container.',
      'Check container/LXC DNS servers and outbound DNS policy.'
    ]
  }

  if (state === MUSICBRAINZ_STATES.NO_ROUTE) {
    return [
      'MusicBrainz requires IPv6 for this proxy; verify a usable IPv6 default route exists inside the proxy container.',
      'Check Proxmox bridge router advertisements, LXC ip6 configuration, and Docker IPv6 routing.',
      'Run curl -6 https://musicbrainz.org/ from the host, LXC, and proxy container.'
    ]
  }

  if (state === MUSICBRAINZ_STATES.TCP_FAILED) {
    return [
      'Check outbound TCP/443 over IPv6 from the proxy container.',
      'Verify firewall, bridge, Docker network, and LXC rules allow IPv6 egress.',
      'Run curl -6 https://musicbrainz.org/ from each network layer.'
    ]
  }

  if (state === MUSICBRAINZ_STATES.TLS_FAILED) {
    return [
      'IPv6 TCP connected, but TLS did not complete; check MTU, PMTUD, firewall inspection, and upstream resets.',
      'Compare curl -6 https://musicbrainz.org/ from the Proxmox host, LXC, and proxy container.',
      'Try another IPv6 path, tunnel, or VPN to isolate ISP/router behavior.'
    ]
  }

  if (state === MUSICBRAINZ_STATES.HTTP_FAILED) {
    return [
      'Inspect HTTP status, rate-limit headers, and MusicBrainz User-Agent configuration.',
      'Verify APP_NAME, APP_VERSION, and APP_CONTACT produce a valid MusicBrainz User-Agent.'
    ]
  }

  return [
    'Inspect /debug/diagnose?provider=musicbrainz and /debug/upstream for the raw failure details.',
    'Validate IPv6 connectivity from the host, LXC, and proxy container.'
  ]
}

function hasAaaa (report = {}) {
  return Boolean((report.dns?.addresses || []).some((item) => item.family === 6))
}

function hasA (report = {}) {
  return Boolean((report.dns?.addresses || []).some((item) => item.family === 4))
}

function recommendationsForGenericProviderState (state, provider = 'provider') {
  if (state === GENERIC_PROVIDER_STATES.HEALTHY) return []

  if (state === GENERIC_PROVIDER_STATES.DNS_FAILED) {
    return [
      `Verify DNS inside the proxy container can resolve ${provider}.`,
      'Compare DNS from the Proxmox host, the LXC, and the proxy container.'
    ]
  }

  if (state === GENERIC_PROVIDER_STATES.TCP_FAILED) {
    return [
      `Check outbound TCP/443 from the proxy container to ${provider}.`,
      'Verify firewall, bridge, Docker network, and LXC egress rules.'
    ]
  }

  if (state === GENERIC_PROVIDER_STATES.TLS_FAILED) {
    return [
      `TCP connected to ${provider}, but TLS did not complete.`,
      'Check TLS inspection, MTU/PMTUD, firewall resets, and proxy/container CA configuration.'
    ]
  }

  if (state === GENERIC_PROVIDER_STATES.HTTP_FAILED) {
    return [
      `${provider} is reachable at the network layer but returned an HTTP error.`,
      'Inspect HTTP status, authentication settings, quota/rate-limit headers, and provider configuration.'
    ]
  }

  return [
    `Inspect /debug/diagnose?provider=${provider} for raw failure details.`
  ]
}

function buildMusicBrainzNetworkState (report = {}, consecutiveFailures = 0, lastSuccessAt = null) {
  const state = classifyMusicBrainzReport(report)
  const recommendations = recommendationsForMusicBrainzState(state)
  if (report.userAgent && !report.userAgent.valid && report.userAgent.recommendation) {
    recommendations.push(report.userAgent.recommendation)
  }

  return {
    provider: 'musicbrainz',
    ...MUSICBRAINZ_POLICY,
    state,
    ok: state === MUSICBRAINZ_STATES.HEALTHY,
    failedStep: report.failedStep || null,
    checkedAt: report.checkedAt || null,
    lastSuccessAt,
    consecutiveFailures,
    dns: {
      aaaaAvailable: hasAaaa(report),
      addresses: report.dns?.addresses || [],
      errors: report.dns?.errors || {}
    },
    tcp: report.tcp || null,
    tls: report.tls || null,
    http: report.http || null,
    timingsMs: report.timingsMs || null,
    error: report.error || null,
    userAgent: report.userAgent || null,
    recommendations: Array.from(new Set(recommendations))
  }
}

function buildGenericProviderNetworkState (report = {}, config = {}, consecutiveFailures = 0, lastSuccessAt = null) {
  const state = classifyGenericProviderReport(report)
  const provider = config.provider || report.provider || 'unknown'
  const family = report.target?.configuredIpFamily || (report.tcp?.selectedFamily ? String(report.tcp.selectedFamily) : null) || config.requiredFamily || 'auto'

  return {
    provider,
    label: config.label || provider,
    policy: config.policy || 'auto',
    family,
    fallbackAllowed: config.fallbackAllowed !== false,
    state,
    ok: state === GENERIC_PROVIDER_STATES.HEALTHY,
    failedStep: report.failedStep || null,
    checkedAt: report.checkedAt || null,
    lastSuccessAt,
    consecutiveFailures,
    target: report.target || { url: config.url || null, hostname: null },
    dns: {
      aAvailable: hasA(report),
      aaaaAvailable: hasAaaa(report),
      addresses: report.dns?.addresses || [],
      errors: report.dns?.errors || {}
    },
    tcp: report.tcp || null,
    tls: report.tls || null,
    http: report.http || null,
    timingsMs: report.timingsMs || null,
    error: report.error || null,
    recommendations: recommendationsForGenericProviderState(state, provider)
  }
}

function buildMusicBrainzSummary (details = {}) {
  return {
    policy: MUSICBRAINZ_POLICY.policy,
    family: MUSICBRAINZ_POLICY.family,
    fallbackAllowed: false,
    state: details.state || MUSICBRAINZ_STATES.UNKNOWN,
    ok: Boolean(details.ok),
    failedStep: details.failedStep || null,
    userAgentValid: details.userAgent?.valid ?? null,
    lastCheckedAt: details.checkedAt || null,
    lastSuccessAt: details.lastSuccessAt || null,
    consecutiveFailures: details.consecutiveFailures || 0
  }
}

function buildGenericProviderSummary (details = {}) {
  return {
    policy: details.policy || 'auto',
    family: details.family || 'auto',
    fallbackAllowed: details.fallbackAllowed !== false,
    state: details.state || GENERIC_PROVIDER_STATES.UNKNOWN,
    ok: Boolean(details.ok),
    failedStep: details.failedStep || null,
    lastCheckedAt: details.checkedAt || null,
    lastSuccessAt: details.lastSuccessAt || null,
    consecutiveFailures: details.consecutiveFailures || 0
  }
}

module.exports = {
  MUSICBRAINZ_STATES,
  MUSICBRAINZ_POLICY,
  GENERIC_PROVIDER_STATES,
  classifyMusicBrainzReport,
  classifyGenericProviderReport,
  recommendationsForMusicBrainzState,
  recommendationsForGenericProviderState,
  buildMusicBrainzNetworkState,
  buildGenericProviderNetworkState,
  buildMusicBrainzSummary,
  buildGenericProviderSummary
}
