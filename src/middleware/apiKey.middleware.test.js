const assert = require('node:assert/strict')
const test = require('node:test')

function makeResponse () {
  return {
    statusCode: 200,
    body: undefined,
    listeners: {},
    status (statusCode) {
      this.statusCode = statusCode
      return this
    },
    json (body) {
      this.body = body
      return this
    },
    on (event, callback) {
      this.listeners[event] = callback
      return this
    },
    finish () {
      if (this.listeners.finish) {
        this.listeners.finish()
      }
    }
  }
}

function loadMiddleware ({ checkRateLimit, hasKeys = () => true }) {
  const middlewarePath = require.resolve('./apiKey.middleware')
  const apiKeysPath = require.resolve('../auth/apikeys')
  const metricsPath = require.resolve('../metrics')

  delete require.cache[middlewarePath]
  delete require.cache[apiKeysPath]
  delete require.cache[metricsPath]

  const calls = {
    apiRequests: [],
    apiKeyErrors: []
  }

  require.cache[apiKeysPath] = {
    id: apiKeysPath,
    filename: apiKeysPath,
    loaded: true,
    exports: { checkRateLimit, hasKeys }
  }

  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: {
      recordApiRequest (...args) {
        calls.apiRequests.push(args)
      },
      recordApiKeyError (...args) {
        calls.apiKeyErrors.push(args)
      }
    }
  }

  return {
    calls,
    middleware: require('./apiKey.middleware')
  }
}

test('api key middleware allows unauthenticated requests when no API keys are configured', () => {
  const { middleware, calls } = loadMiddleware({
    hasKeys: () => false,
    checkRateLimit: () => {
      throw new Error('checkRateLimit should not be called')
    }
  })
  const req = { headers: {}, query: {} }
  const res = makeResponse()
  let nextCalled = false

  middleware(req, res, () => {
    nextCalled = true
  })
  res.finish()

  assert.equal(nextCalled, true)
  assert.equal(req.apiClient, 'Local Client (No API Key Configured)')
  assert.equal(req.apiKeyId, 'no-key-configured')
  assert.equal(req.apiKeyMasked, 'no-key-configured')
  assert.equal(calls.apiRequests.length, 1)
  assert.equal(calls.apiRequests[0][0], 'no-key-configured')
  assert.equal(calls.apiRequests[0][1], true)
  assert.equal(typeof calls.apiRequests[0][2], 'number')
})

test('api key middleware rejects missing keys', () => {
  const { middleware, calls } = loadMiddleware({
    checkRateLimit: () => ({ valid: true, id: 'unused', name: 'unused' })
  })
  const res = makeResponse()

  middleware({ headers: {}, query: {} }, res, () => {
    throw new Error('next should not be called')
  })

  assert.equal(res.statusCode, 401)
  assert.match(res.body.error, /Missing API key/)
  assert.deepEqual(calls.apiRequests[0], ['unknown', false, 0])
})

test('api key middleware rejects invalid keys', () => {
  const { middleware, calls } = loadMiddleware({
    checkRateLimit: () => ({ valid: false, reason: 'invalid_key' })
  })
  const res = makeResponse()

  middleware({ headers: { 'x-api-key': 'mp_invalid' }, query: {} }, res, () => {
    throw new Error('next should not be called')
  })

  assert.equal(res.statusCode, 403)
  assert.equal(res.body.error, 'Invalid API key')
  assert.deepEqual(calls.apiKeyErrors[0], ['mp_inval***'])
})

test('api key middleware rejects keys over quota', () => {
  const { middleware } = loadMiddleware({
    checkRateLimit: () => ({ valid: false, reason: 'quota_exceeded' })
  })
  const res = makeResponse()

  middleware({ headers: {}, query: { api_key: 'mp_quota' } }, res, () => {
    throw new Error('next should not be called')
  })

  assert.equal(res.statusCode, 429)
  assert.equal(res.body.error, 'Rate limit exceeded')
})

test('api key middleware accepts valid keys and records completion metrics', () => {
  const { middleware, calls } = loadMiddleware({
    checkRateLimit: () => ({ valid: true, id: 'key-id', name: 'Lidarr' })
  })
  const req = { headers: { 'x-api-key': 'mp_valid' }, query: {} }
  const res = makeResponse()
  let nextCalled = false

  middleware(req, res, () => {
    nextCalled = true
  })
  res.finish()

  assert.equal(nextCalled, true)
  assert.equal(req.apiClient, 'Lidarr')
  assert.equal(req.apiKeyId, 'key-id')
  assert.equal(req.apiKeyMasked, 'key-id:Lidarr')
  assert.equal(calls.apiRequests.length, 1)
  assert.equal(calls.apiRequests[0][0], 'key-id:Lidarr')
  assert.equal(calls.apiRequests[0][1], true)
  assert.equal(typeof calls.apiRequests[0][2], 'number')
})

test('api key middleware accepts path API key from Lidarr-compatible routes', () => {
  const seenKeys = []
  const { middleware, calls } = loadMiddleware({
    checkRateLimit: (key) => {
      seenKeys.push(key)
      return { valid: true, id: 'path-key-id', name: 'Lidarr Path' }
    }
  })
  const req = { headers: {}, query: {}, pathApiKey: 'mp_path_valid' }
  const res = makeResponse()
  let nextCalled = false

  middleware(req, res, () => {
    nextCalled = true
  })
  res.finish()

  assert.equal(nextCalled, true)
  assert.deepEqual(seenKeys, ['mp_path_valid'])
  assert.equal(req.apiClient, 'Lidarr Path')
  assert.equal(req.apiKeyId, 'path-key-id')
  assert.equal(req.apiKeyMasked, 'path-key-id:Lidarr Path')
  assert.equal(calls.apiRequests[0][0], 'path-key-id:Lidarr Path')
})
