const test = require('node:test')
const assert = require('node:assert')

const { parseRetryAfter, nextRetryDelay } = require('./retry-policy')

test('parseRetryAfter — delta-seconds', async (t) => {
  await t.test('integer seconds → ms', () => {
    assert.strictEqual(parseRetryAfter('30'), 30000)
    assert.strictEqual(parseRetryAfter('0'), 0)
    assert.strictEqual(parseRetryAfter('1'), 1000)
  })

  await t.test('whitespace tolerated', () => {
    assert.strictEqual(parseRetryAfter('  10  '), 10000)
  })

  await t.test('negative or signed values rejected', () => {
    assert.strictEqual(parseRetryAfter('-5'), null)
    assert.strictEqual(parseRetryAfter('+5'), null)
  })

  await t.test('decimals rejected (RFC requires integer delta-seconds)', () => {
    assert.strictEqual(parseRetryAfter('1.5'), null)
    assert.strictEqual(parseRetryAfter('5.0'), null)
  })
})

test('parseRetryAfter — HTTP-date', async (t) => {
  const fixedNow = Date.parse('Fri, 01 May 2026 08:00:00 GMT')

  await t.test('IMF-fixdate (RFC 1123) future → positive ms', () => {
    const result = parseRetryAfter('Fri, 01 May 2026 08:00:30 GMT', fixedNow)
    assert.strictEqual(result, 30000)
  })

  await t.test('past date → 0 (not negative)', () => {
    const result = parseRetryAfter('Fri, 01 May 2026 07:59:30 GMT', fixedNow)
    assert.strictEqual(result, 0)
  })

  await t.test('asctime format', () => {
    const result = parseRetryAfter('Fri May  1 08:00:30 2026', fixedNow)
    // Date.parse treats asctime as local time on some platforms, so just check
    // that it parsed as a number (not null).
    assert.notStrictEqual(result, null)
    assert.strictEqual(typeof result, 'number')
  })
})

test('parseRetryAfter — invalid inputs', async (t) => {
  await t.test('null/undefined/empty → null', () => {
    assert.strictEqual(parseRetryAfter(null), null)
    assert.strictEqual(parseRetryAfter(undefined), null)
    assert.strictEqual(parseRetryAfter(''), null)
    assert.strictEqual(parseRetryAfter('   '), null)
  })

  await t.test('garbage → null', () => {
    assert.strictEqual(parseRetryAfter('not a date'), null)
    assert.strictEqual(parseRetryAfter('???'), null)
  })
})

test('nextRetryDelay — willRetry gating', async (t) => {
  await t.test('attempt >= maxAttempts → willRetry false', () => {
    const r = nextRetryDelay({ attempt: 3, maxAttempts: 3, status: 500 })
    assert.strictEqual(r.willRetry, false)
    assert.strictEqual(r.delayMs, 0)
  })

  await t.test('invalid attempt → willRetry false', () => {
    assert.strictEqual(nextRetryDelay({ attempt: 0, maxAttempts: 3 }).willRetry, false)
    assert.strictEqual(nextRetryDelay({ attempt: -1, maxAttempts: 3 }).willRetry, false)
  })
})

test('nextRetryDelay — Retry-After honoring on 429', async (t) => {
  await t.test('429 with Retry-After=5 → delayMs=5000', () => {
    const r = nextRetryDelay({
      attempt: 1, maxAttempts: 3, status: 429, retryAfterHeader: '5'
    })
    assert.strictEqual(r.willRetry, true)
    assert.strictEqual(r.delayMs, 5000)
    assert.strictEqual(r.retryAfterMs, 5000)
  })

  await t.test('429 with Retry-After=60 but max=30000 → clamped to 30000', () => {
    const r = nextRetryDelay({
      attempt: 1, maxAttempts: 3, maxMs: 30000, status: 429, retryAfterHeader: '60'
    })
    assert.strictEqual(r.delayMs, 30000)
    assert.strictEqual(r.retryAfterMs, 60000) // raw parsed value preserved
  })

  await t.test('429 without Retry-After → falls through to jittered exp', () => {
    const r = nextRetryDelay({
      attempt: 1,
      maxAttempts: 3,
      baseMs: 500,
      status: 429,
      rng: () => 0.5
    })
    assert.strictEqual(r.willRetry, true)
    assert.strictEqual(r.delayMs, 250) // floor(0.5 * 500)
    assert.strictEqual(r.retryAfterMs, null)
  })

  await t.test('429 with garbage Retry-After → falls through to jittered exp', () => {
    const r = nextRetryDelay({
      attempt: 1,
      maxAttempts: 3,
      baseMs: 500,
      status: 429,
      retryAfterHeader: 'garbage',
      rng: () => 0
    })
    assert.strictEqual(r.delayMs, 0)
    assert.strictEqual(r.retryAfterMs, null)
  })
})

test('nextRetryDelay — Retry-After also honored on 503 (CDN behavior)', async (t) => {
  await t.test('503 with Retry-After=10 → delayMs=10000', () => {
    const r = nextRetryDelay({
      attempt: 1, maxAttempts: 3, status: 503, retryAfterHeader: '10'
    })
    assert.strictEqual(r.delayMs, 10000)
    assert.strictEqual(r.retryAfterMs, 10000)
  })

  await t.test('500 with Retry-After IGNORED (not 429/503) → exponential', () => {
    const r = nextRetryDelay({
      attempt: 1,
      maxAttempts: 3,
      baseMs: 500,
      status: 500,
      retryAfterHeader: '99',
      rng: () => 0.999
    })
    // Full jitter on attempt 1 with base 500: floor(0.999 * 500) = 499.
    // Critically: retryAfterMs is null because Retry-After is only honored
    // for 429/503, not generic 5xx.
    assert.strictEqual(r.delayMs, 499)
    assert.strictEqual(r.retryAfterMs, null)
  })
})

test('nextRetryDelay — full jitter exponential', async (t) => {
  await t.test('rng=0 → delayMs=0 regardless of attempt', () => {
    assert.strictEqual(nextRetryDelay({ attempt: 1, maxAttempts: 3, baseMs: 500, status: 500, rng: () => 0 }).delayMs, 0)
    assert.strictEqual(nextRetryDelay({ attempt: 2, maxAttempts: 3, baseMs: 500, status: 500, rng: () => 0 }).delayMs, 0)
  })

  await t.test('rng=0.5 grows exponentially with attempt', () => {
    const a1 = nextRetryDelay({ attempt: 1, maxAttempts: 5, baseMs: 500, status: 500, rng: () => 0.5 })
    const a2 = nextRetryDelay({ attempt: 2, maxAttempts: 5, baseMs: 500, status: 500, rng: () => 0.5 })
    const a3 = nextRetryDelay({ attempt: 3, maxAttempts: 5, baseMs: 500, status: 500, rng: () => 0.5 })
    // base * 2^(attempt-1) → 500, 1000, 2000. floor(0.5 * cap) → 250, 500, 1000.
    assert.strictEqual(a1.delayMs, 250)
    assert.strictEqual(a2.delayMs, 500)
    assert.strictEqual(a3.delayMs, 1000)
  })

  await t.test('exponential capped at maxMs', () => {
    // base=500, attempt=10, 2^9 = 512000ms requested. Capped at maxMs.
    const r = nextRetryDelay({ attempt: 10, maxAttempts: 20, baseMs: 500, maxMs: 30000, status: 500, rng: () => 1 - 1e-9 })
    assert.ok(r.delayMs <= 30000)
    assert.ok(r.delayMs >= 29000)
  })
})

test('nextRetryDelay — network error path (no status)', async (t) => {
  await t.test('no status → exponential, no Retry-After', () => {
    const r = nextRetryDelay({
      attempt: 1, maxAttempts: 3, baseMs: 500, rng: () => 0.5
    })
    assert.strictEqual(r.willRetry, true)
    assert.strictEqual(r.delayMs, 250)
    assert.strictEqual(r.retryAfterMs, null)
  })
})
