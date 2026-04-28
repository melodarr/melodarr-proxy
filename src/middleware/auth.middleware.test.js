const { test, after } = require('node:test')
const assert = require('node:assert/strict')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }
  }
}

function loadMiddleware () {
  const middlewarePath = require.resolve('./auth.middleware')
  const loggerPath = require.resolve('../utils/logger')

  delete require.cache[middlewarePath]
  delete require.cache[loggerPath]

  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: { warn () {}, error () {}, info () {} }
  }

  return require('./auth.middleware')
}

// ── AUTH_ENABLED not set ──────────────────────────────────────────

test('auth middleware calls next when AUTH_ENABLED is not true', async () => {
  delete process.env.AUTH_ENABLED
  const middleware = loadMiddleware()
  let nextCalled = false
  await middleware({ headers: {} }, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
})

test('auth middleware calls next when AUTH_ENABLED is "false"', async () => {
  process.env.AUTH_ENABLED = 'false'
  const middleware = loadMiddleware()
  let nextCalled = false
  await middleware({ headers: {} }, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
  delete process.env.AUTH_ENABLED
})

// ── AUTH_ENABLED=true: missing header ─────────────────────────────

test('auth middleware returns 401 when authorization header is missing', async () => {
  process.env.AUTH_ENABLED = 'true'
  const middleware = loadMiddleware()
  const res = makeRes()
  await middleware({ headers: {} }, res, () => {
    throw new Error('next should not be called')
  })
  assert.equal(res.statusCode, 401)
  process.env.AUTH_ENABLED = 'false'
})

test('auth middleware returns 401 when authorization header does not start with Bearer', async () => {
  process.env.AUTH_ENABLED = 'true'
  const middleware = loadMiddleware()
  const res = makeRes()
  await middleware({ headers: { authorization: 'Basic abc123' } }, res, () => {
    throw new Error('next should not be called')
  })
  assert.equal(res.statusCode, 401)
  process.env.AUTH_ENABLED = 'false'
})

// ── AUTH_ENABLED=true: upstream responses ─────────────────────────

test('auth middleware returns 401 when upstream auth returns non-ok response', async () => {
  process.env.AUTH_ENABLED = 'true'
  globalThis.fetch = async () => ({ ok: false })
  const middleware = loadMiddleware()
  const res = makeRes()
  await middleware({ headers: { authorization: 'Bearer token' } }, res, () => {
    throw new Error('next should not be called')
  })
  assert.equal(res.statusCode, 401)
  delete globalThis.fetch
  process.env.AUTH_ENABLED = 'false'
})

test('auth middleware sets req.user and calls next when token is valid', async () => {
  process.env.AUTH_ENABLED = 'true'
  const fakeUser = { id: 1, name: 'Admin' }
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ valid: true, user: fakeUser })
  })
  const middleware = loadMiddleware()
  const req = { headers: { authorization: 'Bearer valid-token' } }
  let nextCalled = false
  await middleware(req, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
  assert.deepEqual(req.user, fakeUser)
  delete globalThis.fetch
  process.env.AUTH_ENABLED = 'false'
})

test('auth middleware returns 401 when token validation returns valid=false', async () => {
  process.env.AUTH_ENABLED = 'true'
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ valid: false })
  })
  const middleware = loadMiddleware()
  const res = makeRes()
  await middleware({ headers: { authorization: 'Bearer bad-token' } }, res, () => {
    throw new Error('next should not be called')
  })
  assert.equal(res.statusCode, 401)
  delete globalThis.fetch
  process.env.AUTH_ENABLED = 'false'
})

test('auth middleware returns 503 when auth service is unreachable', async () => {
  process.env.AUTH_ENABLED = 'true'
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  const middleware = loadMiddleware()
  const res = makeRes()
  await middleware({ headers: { authorization: 'Bearer token' } }, res, () => {
    throw new Error('next should not be called')
  })
  assert.equal(res.statusCode, 503)
  delete globalThis.fetch
  process.env.AUTH_ENABLED = 'false'
})

after(() => {
  delete process.env.AUTH_ENABLED
  delete globalThis.fetch
})
