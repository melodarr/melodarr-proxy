// Per-provider circuit breaker.
//
// Three states: healthy → degraded (1–2 consecutive failures) → disabled
// (3+ consecutive failures). Disabled providers are skipped by
// safeProviderCall until the cooldown elapses, at which point a single
// canary attempt is allowed; success restores healthy, failure keeps the
// breaker open.
//
// State is in-memory only. Process restart resets every provider to
// healthy — that's intentional, since the underlying network condition
// that disabled a provider may have been transient and a fresh process
// should re-probe rather than carry stale circuit state forward.

const logger = require('../utils/logger')

// v0.3.39: thresholds are env-configurable. Defaults preserve v0.3.38
// behavior (3 failures, 10-minute cooldown) so existing deployments are
// unaffected if neither var is set.
//
// Read at module load time — change requires a process restart.
const FAILURE_THRESHOLD = parseInt(process.env.PROVIDER_FAILURE_THRESHOLD || '3', 10)
const COOLDOWN_MS = parseInt(process.env.PROVIDER_COOLDOWN_MS || String(10 * 60 * 1000), 10)
const REENABLE_THRESHOLD = parseInt(process.env.PROVIDER_REENABLE_SUCCESS_THRESHOLD || '3', 10)
const REENABLE_WINDOW_MS = parseInt(process.env.PROVIDER_REENABLE_WINDOW_MS || '300000', 10)

if (!Number.isFinite(FAILURE_THRESHOLD) || FAILURE_THRESHOLD < 1) {
  throw new Error(`Invalid PROVIDER_FAILURE_THRESHOLD: ${process.env.PROVIDER_FAILURE_THRESHOLD} (must be a positive integer)`)
}
if (!Number.isFinite(COOLDOWN_MS) || COOLDOWN_MS < 0) {
  throw new Error(`Invalid PROVIDER_COOLDOWN_MS: ${process.env.PROVIDER_COOLDOWN_MS} (must be a non-negative integer)`)
}
if (!Number.isFinite(REENABLE_THRESHOLD) || REENABLE_THRESHOLD < 1) {
  throw new Error(`Invalid PROVIDER_REENABLE_SUCCESS_THRESHOLD: ${process.env.PROVIDER_REENABLE_SUCCESS_THRESHOLD} (must be a positive integer)`)
}
if (!Number.isFinite(REENABLE_WINDOW_MS) || REENABLE_WINDOW_MS < 0) {
  throw new Error(`Invalid PROVIDER_REENABLE_WINDOW_MS: ${process.env.PROVIDER_REENABLE_WINDOW_MS} (must be a non-negative integer)`)
}

const state = new Map()

function get (name) {
  if (!state.has(name)) {
    state.set(name, {
      failures: 0,
      status: 'healthy',
      lastFailure: null,
      lastSuccess: null,
      lastErrorMessage: null,
      successStreak: 0,
      lastSuccessTimes: []
    })
  }
  return state.get(name)
}

function recordSuccess (name) {
  const p = get(name)
  p.successStreak = p.successStreak || 0
  p.lastSuccessTimes = p.lastSuccessTimes || []

  const now = Date.now()
  p.successStreak += 1
  p.lastSuccess = now
  p.lastSuccessTimes.push(now)
  p.lastSuccessTimes = p.lastSuccessTimes.filter(t => now - t < REENABLE_WINDOW_MS)
  p.lastErrorMessage = null

  if (p.status === 'disabled') {
    if (p.lastSuccessTimes.length >= REENABLE_THRESHOLD) {
      const windowOk = (p.lastSuccessTimes[p.lastSuccessTimes.length - 1] - p.lastSuccessTimes[0]) <= REENABLE_WINDOW_MS

      if (windowOk) {
        p.status = 'degraded'
        p.failures = 0
        logger.info('Provider auto-reenabled after success streak', {
          provider: name,
          streak: p.lastSuccessTimes.length
        })
      }
    }
    return
  }

  p.failures = 0
  p.status = 'healthy'
}

function recordFailure (name, errorMessage) {
  const p = get(name)
  p.successStreak = 0
  p.lastSuccessTimes = []
  p.failures += 1
  p.lastFailure = Date.now()
  if (errorMessage) p.lastErrorMessage = errorMessage

  if (p.failures >= FAILURE_THRESHOLD) {
    const wasNotDisabled = p.status !== 'disabled'
    p.status = 'disabled'
    if (wasNotDisabled) {
      // Single WARN on transition only — failures continuing while
      // already-disabled would spam logs during a sustained outage.
      logger.warn('Provider disabled (circuit breaker)', {
        provider: name,
        failures: p.failures,
        lastError: p.lastErrorMessage
      })
    }
  } else {
    p.status = 'degraded'
  }
}

function shouldUse (name) {
  const p = get(name)
  if (p.status !== 'disabled') return true
  // Canary: after cooldown elapses, allow exactly one attempt. The next
  // recordSuccess restores; the next recordFailure leaves status
  // disabled and resets the cooldown clock via lastFailure.
  return p.lastFailure !== null && (Date.now() - p.lastFailure) > COOLDOWN_MS
}

// Test helper. Not exported as part of the public API consumers use.
function reset () {
  state.clear()
}

// Internal: enumerate every provider name that has been recorded against,
// for /debug/providers/health to report on. Underscore-prefixed to mark
// it as not part of the consumer-facing API.
function _getAllNames () {
  return Array.from(state.keys())
}

module.exports = {
  get,
  recordSuccess,
  recordFailure,
  shouldUse,
  reset,
  _getAllNames,
  FAILURE_THRESHOLD,
  COOLDOWN_MS,
  REENABLE_THRESHOLD,
  REENABLE_WINDOW_MS
}
