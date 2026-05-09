const { test } = require('node:test')
const assert = require('node:assert/strict')
const rateLimit = require('./rateLimit.middleware')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    headers: {},
    setHeader (name, value) { this.headers[name] = value; return this },
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }
  }
}

// ── Requests under limit ──────────────────────────────────────────

test('rateLimit allows requests under the limit', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 3 })
  const ip = '10.0.1.1'

  for (let i = 0; i < 3; i++) {
    let called = false
    middleware({ ip }, makeRes(), () => { called = true })
    assert.ok(called, `request ${i + 1} should be allowed`)
  }
})

// ── Requests at limit ─────────────────────────────────────────────

test('rateLimit blocks with 429 once limit is reached', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 2 })
  const ip = '10.0.1.2'

  // Use up the quota
  middleware({ ip }, makeRes(), () => {})
  middleware({ ip }, makeRes(), () => {})

  // Next request should be rate-limited
  const res = makeRes()
  let nextCalled = false
  middleware({ ip, path: '/api/test' }, res, () => { nextCalled = true })

  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 429)
  assert.ok(Number(res.headers['Retry-After']) > 0)
})

test('rateLimit response includes retryAfter field', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 1 })
  const ip = '10.0.1.3'

  // Use up the quota
  middleware({ ip }, makeRes(), () => {})

  // Second request should be blocked with retryAfter
  const res = makeRes()
  middleware({ ip, path: '/api/test' }, res, () => {})

  assert.equal(res.statusCode, 429)
  assert.ok(typeof res.body.retryAfter === 'number')
  assert.ok(res.body.retryAfter > 0)
})

test('rateLimit response includes custom message', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 1, message: 'Custom limit message' })
  const ip = '10.0.1.4'

  middleware({ ip }, makeRes(), () => {})
  const res = makeRes()
  middleware({ ip, path: '/api/test' }, res, () => {})

  assert.equal(res.body.error, 'Custom limit message')
})

// ── Default options ───────────────────────────────────────────────

test('rateLimit defaults to 60 requests per minute', () => {
  const middleware = rateLimit()
  const ip = '10.0.1.5'
  let allowed = 0

  for (let i = 0; i < 60; i++) {
    middleware({ ip }, makeRes(), () => { allowed++ })
  }

  assert.equal(allowed, 60)

  const res = makeRes()
  let blockedNext = false
  middleware({ ip, path: '/api/test' }, res, () => { blockedNext = true })
  assert.equal(blockedNext, false)
  assert.equal(res.statusCode, 429)
})

// ── Sliding window expiry ─────────────────────────────────────────

test('rateLimit allows new requests after the window expires', async () => {
  const middleware = rateLimit({ windowMs: 50, max: 2 })
  const ip = '10.0.1.6'

  // Fill the window
  middleware({ ip }, makeRes(), () => {})
  middleware({ ip }, makeRes(), () => {})

  // Blocked
  const blocked = makeRes()
  middleware({ ip, path: '/api/test' }, blocked, () => {})
  assert.equal(blocked.statusCode, 429)

  // Wait for window to expire
  await new Promise(resolve => setTimeout(resolve, 60))

  // Should be allowed again
  let allowed = false
  middleware({ ip }, makeRes(), () => { allowed = true })
  assert.ok(allowed)
})

// ── Per-IP isolation ──────────────────────────────────────────────

test('rateLimit tracks each IP independently', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 1 })

  middleware({ ip: '10.0.1.7' }, makeRes(), () => {})
  middleware({ ip: '10.0.1.8' }, makeRes(), () => {})

  // Both IPs used their single request; next for each should be blocked
  const res7 = makeRes()
  const res8 = makeRes()
  middleware({ ip: '10.0.1.7', path: '/api/test' }, res7, () => {})
  middleware({ ip: '10.0.1.8', path: '/api/test' }, res8, () => {})

  assert.equal(res7.statusCode, 429)
  assert.equal(res8.statusCode, 429)
})

// ── IP fallback ───────────────────────────────────────────────────

test('rateLimit falls back to req.connection.remoteAddress when req.ip is absent', () => {
  const middleware = rateLimit({ windowMs: 60000, max: 1 })

  let called = false
  middleware(
    { connection: { remoteAddress: '10.0.1.9' } },
    makeRes(),
    () => { called = true }
  )
  assert.ok(called)
})
