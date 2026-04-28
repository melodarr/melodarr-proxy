const upstreamService = require('../services/upstream.service')
const logger = require('../utils/logger')

const DEFAULT_INTERVAL_MS = 45000

const state = {
  status: 'unknown',
  lastCheckedAt: null,
  lastError: null,
  consecutiveFailures: 0
}

let timer = null
let inFlight = null

async function runCheck () {
  if (inFlight) return inFlight

  inFlight = (async () => {
    try {
      const result = await upstreamService.probe()
      state.status = result.status
      state.lastError = result.error
      state.lastCheckedAt = new Date().toISOString()

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
    consecutiveFailures: state.consecutiveFailures
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
