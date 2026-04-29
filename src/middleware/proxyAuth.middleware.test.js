const { test } = require('node:test')
const assert = require('node:assert/strict')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (code) { this.statusCode = code; return this },
    json (body) { this.body = body; return this }
  }
}

function loadMiddleware ({ isAuthenticated, apiKeyResult } = {}) {
  const middlewarePath = require.resolve('./proxyAuth.middleware')
  const apiKeyPath = require.resolve('./apiKey.middleware')
  const settingsPath = require.resolve('../controllers/settings.controller')

  delete require.cache[middlewarePath]
  delete require.cache[apiKeyPath]
  delete require.cache[settingsPath]

  require.cache[settingsPath] = {
    id: settingsPath,
    filename: settingsPath,
    loaded: true,
    exports: {
      isAuthenticated: () => isAuthenticated || false
    }
  }

  require.cache[apiKeyPath] = {
    id: apiKeyPath,
    filename: apiKeyPath,
    loaded: true,
    exports: (req, res, next) => {
      if (apiKeyResult) {
        res.status(apiKeyResult.status).json(apiKeyResult.body)
      } else {
        next()
      }
    }
  }

  return require('./proxyAuth.middleware')
}


// ── Settings-authenticated session → calls next directly ─────────

test('proxyAuth calls next directly when session is authenticated', () => {
  delete process.env.AUTH_ENABLED
  const middleware = loadMiddleware({ isAuthenticated: true })
  let nextCalled = false
  middleware({}, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
})

// ── Unauthenticated → delegates to API-key middleware ─────────────

test('proxyAuth delegates to apiKey middleware when not authenticated', () => {
  delete process.env.AUTH_ENABLED
  const middleware = loadMiddleware({
    isAuthenticated: false,
    apiKeyResult: { status: 401, body: { error: 'Missing API key' } }
  })
  const res = makeRes()
  let nextCalled = false
  middleware({}, res, () => { nextCalled = true })
  assert.equal(nextCalled, false)
  assert.equal(res.statusCode, 401)
})

test('proxyAuth calls next when apiKey middleware accepts the request', () => {
  delete process.env.AUTH_ENABLED
  const middleware = loadMiddleware({ isAuthenticated: false, apiKeyResult: null })
  let nextCalled = false
  middleware({}, makeRes(), () => { nextCalled = true })
  assert.ok(nextCalled)
})
