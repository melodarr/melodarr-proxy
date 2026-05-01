// Retry policy helpers — pure functions, no side effects, RNG-injectable for
// deterministic tests. The retry loop in upstream.service.js calls these.

// RFC 9110 Retry-After: either delta-seconds (integer) or HTTP-date (RFC 1123,
// RFC 850, or asctime — Date.parse handles all three). Returns delay in ms,
// or null if the header is missing/malformed/negative. The current wall clock
// is injectable for deterministic tests.
function parseRetryAfter (headerValue, now = Date.now()) {
  if (headerValue === undefined || headerValue === null) return null
  const trimmed = String(headerValue).trim()
  if (!trimmed) return null

  // delta-seconds: digits only, no sign, no decimal.
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number(trimmed)
    if (!Number.isFinite(seconds) || seconds < 0) return null
    return seconds * 1000
  }

  // HTTP-date: require at least one letter (weekday/month/GMT). Date.parse is
  // too permissive on bare numerics — "+5" / "-5" / "1.5" would otherwise be
  // interpreted as years.
  if (!/[a-zA-Z]/.test(trimmed)) return null
  const epochMs = Date.parse(trimmed)
  if (Number.isNaN(epochMs)) return null
  // If the server-provided date is in the past, treat as "retry now" (0ms),
  // not negative — negative ms makes no sense for a sleep.
  return Math.max(0, epochMs - now)
}

// Decides what to do after a failed attempt:
//   - willRetry: false when at maxAttempts (caller throws)
//   - delayMs:   how long to sleep before the next attempt
//   - retryAfterMs: parsed Retry-After header (null if absent/unparseable)
//
// On 429 or 503: if Retry-After parses, use it (clamped to maxMs); otherwise
// fall through to jittered exponential. On any other retryable failure (5xx,
// network errors): full-jitter exponential. Caller decides whether to retry
// at all (4xx non-429 throws immediately upstream).
//
// Full jitter (AWS Architecture Blog, "Exponential Backoff and Jitter"):
//   wait = random(0, base * 2^(attempt-1))
// Best burst-collapse property of the standard jitter strategies.
function nextRetryDelay ({
  attempt,
  maxAttempts = 3,
  baseMs = 500,
  maxMs = 30000,
  status,
  retryAfterHeader,
  rng = Math.random,
  now = Date.now()
} = {}) {
  if (typeof attempt !== 'number' || attempt < 1) {
    return { willRetry: false, delayMs: 0, retryAfterMs: null }
  }

  if (attempt >= maxAttempts) {
    return { willRetry: false, delayMs: 0, retryAfterMs: null }
  }

  let parsedRetryAfter = null
  if (status === 429 || status === 503) {
    parsedRetryAfter = parseRetryAfter(retryAfterHeader, now)
    if (parsedRetryAfter !== null) {
      return {
        willRetry: true,
        delayMs: Math.min(parsedRetryAfter, maxMs),
        retryAfterMs: parsedRetryAfter
      }
    }
  }

  const exp = Math.min(baseMs * Math.pow(2, attempt - 1), maxMs)
  const delayMs = Math.floor(rng() * exp)
  return { willRetry: true, delayMs, retryAfterMs: parsedRetryAfter }
}

module.exports = { parseRetryAfter, nextRetryDelay }
