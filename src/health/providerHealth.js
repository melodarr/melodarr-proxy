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

const FAILURE_THRESHOLD = 3
const COOLDOWN_MS = 10 * 60 * 1000

const state = new Map()

function get (name) {
  if (!state.has(name)) {
    state.set(name, {
      failures: 0,
      status: 'healthy',
      lastFailure: null,
      lastSuccess: null,
      lastErrorMessage: null
    })
  }
  return state.get(name)
}

function recordSuccess (name) {
  const p = get(name)
  const wasDisabled = p.status === 'disabled'
  p.failures = 0
  p.status = 'healthy'
  p.lastSuccess = Date.now()
  p.lastErrorMessage = null
  if (wasDisabled) {
    logger.info('Provider restored via canary', { provider: name })
  }
}

function recordFailure (name, errorMessage) {
  const p = get(name)
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

module.exports = {
  get,
  recordSuccess,
  recordFailure,
  shouldUse,
  reset,
  FAILURE_THRESHOLD,
  COOLDOWN_MS
}
