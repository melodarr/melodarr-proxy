const upstreamService = require('../services/upstream.service')
const logger = require('../utils/logger')
const { getConfigValue } = require('../settings/store')

const DEFAULT_INTERVAL_MS = 45000

const state = {
  status: 'unknown',
  lastCheckedAt: null,
  lastError: null,
  consecutiveFailures: 0,
  probedProvider: null
}

let timer = null
let inFlight = null

function activeProviders () {
  const raw = getConfigValue('metadataProviders') || ''
  return String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
}

function isMusicBrainzActive () {
  return activeProviders().includes('musicbrainz')
}

async function runCheck () {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      // Only probe MusicBrainz when it is part of the active provider set.
      // Other providers don't have dedicated probes yet; their health is
      // visible through real-traffic per-provider stats. If MB is disabled
      // the upstream layer is treated as not-applicable rather than failed,
      // so /api/ready doesn't report degraded for an upstream the operator
      // has intentionally turned off.
      if (!isMusicBrainzActive()) {
        state.status = 'not_applicable'
        state.lastError = null
        state.lastCheckedAt = new Date().toISOString()
        state.consecutiveFailures = 0
        state.probedProvider = null
        return getStatus()
      }

      const result = await upstreamService.probe()
      state.status = result.status
      state.lastError = result.error
      state.lastCheckedAt = new Date().toISOString()
      state.probedProvider = 'musicbrainz'

      if (result.status === 'healthy') {
        state.consecutiveFailures = 0
      } else {
        state.consecutiveFailures += 1
        logger.warn('Upstream probe non-healthy', {
          status: result.status,
          error: result.error,
          consecutiveFailures: state.consecutiveFailures
        })
      }
      return getStatus()
    } catch (err) {
      state.status = 'unreachable'
      state.lastError = { message: err.message, code: err.code || null, status: null }
      state.lastCheckedAt = new Date().toISOString()
      state.consecutiveFailures += 1
      return getStatus()
    } finally {
      inFlight = null
    }
  })()

  return inFlight
}

function getStatus () {
  return {
    status: state.status,
    lastCheckedAt: state.lastCheckedAt,
    lastError: state.lastError,
    consecutiveFailures: state.consecutiveFailures,
    probedProvider: state.probedProvider,
    activeProviders: activeProviders()
  }
}

function start (intervalMs = DEFAULT_INTERVAL_MS) {
  if (timer) return
  timer = setInterval(() => {
    runCheck().catch(() => {})
  }, intervalMs)
  if (timer.unref) timer.unref()
}

function stop () {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
}

module.exports = { runCheck, getStatus, start, stop }
