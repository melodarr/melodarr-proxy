// Resilient per-provider call wrapper.
//
// Responsibilities:
//   - skip the call entirely if the circuit breaker is open
//     (returns null — caller treats as "no contribution")
//   - record latency + outcome to providerMetrics (always, when not
//     skipped)
//   - validate the result's shape; flag invalid shape as failure
//   - record health success/failure so the circuit breaker advances
//   - re-throw provider exceptions so existing partial-failure flows
//     in callers (Promise.allSettled, fallback chains) keep working
//
// Non-responsibilities:
//   - retry / backoff (handled in upstream.service for MB; not at this
//     layer to avoid double-retry semantics)
//   - SkyHook wrapping (controller-layer concern; v0.3.37)
//
// Shape rules (finalized rule 4):
//   - Array result: each item is valid iff it has artistName, albumName,
//     or title. Empty array is SUCCESS (rule 2). Non-empty array with
//     zero valid items is invalid shape → failure.
//   - Object result: valid iff it has artistName/albumName/title OR an
//     `albums` array (the existing aggregateArtist provider contract).
//   - Anything else (null, string, number) is invalid shape → failure.

const health = require('../health/providerHealth')
const metrics = require('../health/providerMetrics')

function isValidItem (item) {
  if (!item || typeof item !== 'object') return false
  return Boolean(item.artistName || item.albumName || item.title)
}

function isValidObject (result) {
  if (!result || typeof result !== 'object') return false
  if (Array.isArray(result)) return false
  return Boolean(
    result.artistName || result.albumName || result.title || Array.isArray(result.albums)
  )
}

async function safeProviderCall (name, fn, query) {
  if (!health.shouldUse(name)) {
    // Skipped — caller decides what "no data from this provider" means
    // for its context. No metrics record, no latency.
    return null
  }

  const start = Date.now()
  try {
    const result = await fn(query)
    const latency = Date.now() - start

    if (Array.isArray(result)) {
      if (result.length === 0) {
        // Empty is a legitimate "no match" — success per finalized rule 2.
        health.recordSuccess(name)
        metrics.record(name, true, latency)
        return result
      }
      const valid = result.filter(isValidItem)
      if (valid.length === 0) {
        // Items present but all malformed → invalid shape.
        health.recordFailure(name, 'all items have invalid shape')
        metrics.record(name, false, latency)
        const e = new Error(`Provider ${name} returned items with invalid shape`)
        e.code = 'INVALID_SHAPE'
        throw e
      }
      health.recordSuccess(name)
      metrics.record(name, true, latency)
      return valid
    }

    if (isValidObject(result)) {
      health.recordSuccess(name)
      metrics.record(name, true, latency)
      return result
    }

    health.recordFailure(name, 'result has invalid shape')
    metrics.record(name, false, latency)
    const e = new Error(`Provider ${name} returned invalid shape`)
    e.code = 'INVALID_SHAPE'
    throw e
  } catch (err) {
    if (err && err.code === 'INVALID_SHAPE') {
      // Already recorded above — re-throw without double-counting.
      throw err
    }
    const latency = Date.now() - start
    health.recordFailure(name, err && err.message)
    metrics.record(name, false, latency)
    throw err
  }
}

module.exports = { safeProviderCall }
