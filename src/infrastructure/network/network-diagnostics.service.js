const { diagnoseMusicBrainz } = require('../../services/diagnose.service')
const {
  MUSICBRAINZ_STATES,
  buildMusicBrainzNetworkState,
  buildMusicBrainzSummary
} = require('./network-state')

const DEFAULT_REFRESH_INTERVAL_MS = 15 * 60 * 1000

const state = {
  current: null,
  lastSuccessAt: null,
  consecutiveFailures: 0,
  inFlight: null
}

function buildPayload (musicbrainz, checkedAt = new Date().toISOString()) {
  const status = musicbrainz.ok ? 'ok' : (musicbrainz.state === MUSICBRAINZ_STATES.UNKNOWN ? 'unknown' : 'degraded')

  return {
    status,
    checkedAt,
    providers: {
      musicbrainz
    },
    summary: {
      musicbrainz: buildMusicBrainzSummary(musicbrainz)
    }
  }
}

async function refreshNetworkDiagnostics ({ probeMusicBrainz = diagnoseMusicBrainz } = {}) {
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

    const wasOk = Boolean(report.ok)
    if (wasOk) {
      state.consecutiveFailures = 0
      state.lastSuccessAt = report.checkedAt || checkedAt
    } else {
      state.consecutiveFailures += 1
    }

    const musicbrainz = buildMusicBrainzNetworkState(
      { ...report, checkedAt: report.checkedAt || checkedAt },
      state.consecutiveFailures,
      state.lastSuccessAt
    )

    state.current = buildPayload(musicbrainz, checkedAt)
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
  return buildPayload(musicbrainz, null)
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
