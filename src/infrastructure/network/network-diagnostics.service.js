const { diagnoseMusicBrainz, diagnoseGenericProvider } = require('../../services/diagnose.service')
const { GENERIC_PROVIDER_NAMES, getProviderTransport } = require('./provider-registry')
const {
  MUSICBRAINZ_STATES,
  buildMusicBrainzNetworkState,
  buildGenericProviderNetworkState,
  buildMusicBrainzSummary,
  buildGenericProviderSummary
} = require('./network-state')

const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000

const state = {
  current: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  providers: new Map(),
  inFlight: null
}

function providerRuntime (name) {
  if (!state.providers.has(name)) {
    state.providers.set(name, { lastSuccessAt: null, consecutiveFailures: 0 })
  }
  return state.providers.get(name)
}

function updateRuntimeFromReport (name, report) {
  const runtime = providerRuntime(name)
  if (report?.ok) {
    runtime.consecutiveFailures = 0
    runtime.lastSuccessAt = report.checkedAt || new Date().toISOString()
  } else {
    runtime.consecutiveFailures += 1
  }
  return runtime
}

function buildPayload (providers, checkedAt = new Date().toISOString()) {
  const values = Object.values(providers)
  const allUnknown = values.every((provider) => provider.state === MUSICBRAINZ_STATES.UNKNOWN || provider.state === 'UNKNOWN')
  const status = allUnknown
    ? 'unknown'
    : values.every((provider) => provider.ok) ? 'ok' : 'degraded'

  const summary = {}
  for (const [name, details] of Object.entries(providers)) {
    summary[name] = name === 'musicbrainz'
      ? buildMusicBrainzSummary(details)
      : buildGenericProviderSummary(details)
  }

  return {
    status,
    checkedAt,
    providers,
    summary
  }
}

async function refreshNetworkDiagnostics ({ probeMusicBrainz = diagnoseMusicBrainz, probeProvider = diagnoseGenericProvider } = {}) {
  if (state.inFlight) return state.inFlight

  state.inFlight = (async () => {
    const checkedAt = new Date().toISOString()
    let report

    try {
      report = await probeMusicBrainz()
    } catch (err) {
      report = {
        provider: 'musicbrainz',
        ok: false,
        failedStep: 'internal',
        checkedAt,
        error: {
          code: err.code || 'INTERNAL',
          message: err.message
        },
        dns: { addresses: [], errors: {} }
      }
    }

    const runtime = updateRuntimeFromReport('musicbrainz', report)
    state.consecutiveFailures = runtime.consecutiveFailures
    state.lastSuccessAt = runtime.lastSuccessAt

    const musicbrainz = buildMusicBrainzNetworkState(
      { ...report, checkedAt: report.checkedAt || checkedAt },
      runtime.consecutiveFailures,
      runtime.lastSuccessAt
    )

    const genericReports = await Promise.all(GENERIC_PROVIDER_NAMES.map(async (name) => {
      try {
        return await probeProvider(name)
      } catch (err) {
        return {
          provider: name,
          ok: false,
          failedStep: 'internal',
          checkedAt,
          error: {
            code: err.code || 'INTERNAL',
            message: err.message
          },
          dns: { addresses: [], errors: {} }
        }
      }
    }))

    const providers = { musicbrainz }
    for (const genericReport of genericReports) {
      const name = genericReport.provider
      const config = getProviderTransport(name)
      const genericRuntime = updateRuntimeFromReport(name, genericReport)
      providers[name] = buildGenericProviderNetworkState(
        { ...genericReport, checkedAt: genericReport.checkedAt || checkedAt },
        config || { provider: name },
        genericRuntime.consecutiveFailures,
        genericRuntime.lastSuccessAt
      )
    }

    state.current = buildPayload(providers, checkedAt)
    return state.current
  })()

  try {
    return await state.inFlight
  } finally {
    state.inFlight = null
  }
}

function getCachedNetworkDiagnostics () {
  if (state.current) return state.current

  const musicbrainz = buildMusicBrainzNetworkState({}, 0, null)
  const providers = { musicbrainz }
  for (const name of GENERIC_PROVIDER_NAMES) {
    providers[name] = buildGenericProviderNetworkState({}, getProviderTransport(name), 0, null)
  }
  return buildPayload(providers, null)
}

async function getNetworkDiagnostics ({ refresh = false } = {}) {
  if (refresh || !state.current) return refreshNetworkDiagnostics()
  return state.current
}

function buildNetworkHealthSummary () {
  return getCachedNetworkDiagnostics().summary
}

function resetNetworkDiagnosticsForTest () {
  state.current = null
  state.lastSuccessAt = null
  state.consecutiveFailures = 0
  state.providers = new Map()
  state.inFlight = null
}

module.exports = {
  DEFAULT_REFRESH_INTERVAL_MS,
  refreshNetworkDiagnostics,
  getNetworkDiagnostics,
  getCachedNetworkDiagnostics,
  buildNetworkHealthSummary,
  resetNetworkDiagnosticsForTest
}
