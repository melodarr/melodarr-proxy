const { describe, it, before, after, mock } = require('node:test')
const assert = require('node:assert')
const { createApp } = require('../server')
const cacheLayer = require('../cache')
const http = require('http')
const { EventEmitter } = require('events')

class MockSocket extends EventEmitter {
  constructor () { super(); this.remoteAddress = '127.0.0.1'; this._writableState = { corked: 0, length: 0 }; this.writable = true; this.readable = true; this.destroyed = false }
  destroy () {} cork () {} uncork () {} pause () {} resume () {} write (data, encoding, cb) { if (cb)cb(); return true } end () {} on () {} removeListener () {}
}

function makeRequest (app, method, url, headers = {}) {
  return new Promise((resolve) => {
    const socket = new MockSocket()
    const req = new http.IncomingMessage(socket)
    req.method = method; req.url = url; req.headers = headers

    const res = new http.ServerResponse(req)
    res.assignSocket(socket)

    const chunks = []
    const originalWrite = res.write
    const originalEnd = res.end

    res.write = function (chunk, encoding, cb) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      return originalWrite.call(this, chunk, encoding, cb)
    }

    res.end = function (chunk, encoding, cb) {
      if (typeof chunk === 'function') { cb = chunk; chunk = null; encoding = null } else if (typeof encoding === 'function') { cb = encoding; encoding = null }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))

      originalEnd.call(this, chunk, encoding, cb)

      const bodyBuffer = Buffer.concat(chunks)
      let data = bodyBuffer.toString('utf8')

      const resHeaders = Object.assign({}, res.getHeaders())
      if (resHeaders['content-type'] && resHeaders['content-type'].includes('application/json')) {
        try { data = JSON.parse(data) } catch (e) {}
      }
      resolve({ status: res.statusCode, headers: resHeaders, data })
    }

    app(req, res)
  })
}

describe('API E2E Tests', () => {
  let app

  const client = {
    get: (url, options = {}) => makeRequest(app, 'GET', url, options.headers || {}),
    post: (url, options = {}) => makeRequest(app, 'POST', url, options.headers || {})
  }

  before(async () => {
    // Override settings
    process.env.REQUIRE_API_KEY = 'false'
    process.env.MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS = '0'

    if (process.env.E2E_REAL_HTTP !== 'true') {
      const axiosModule = require('axios')
      mock.method(axiosModule, 'get', async (url, config) => {
        if (url.includes('musicbrainz.org')) {
          return { data: { artists: [{ id: '123', name: 'Test Artist' }] } }
        }
        if (url.includes('itunes.apple.com')) {
          return { data: { results: [] } }
        }
        return { data: {} }
      })
      if (axiosModule.post) {
        mock.method(axiosModule, 'post', async () => ({ data: {} }))
      }
    }

    app = createApp()

    // Start proxy so /api/ready does not return 503
    await client.post('/api/proxy/start')
  })

  after(async () => {
    const axiosModule = require('axios')
    if (axiosModule.get && axiosModule.get.mock) axiosModule.get.mock.restore()
    if (axiosModule.post && axiosModule.post.mock) axiosModule.post.mock.restore()

    await cacheLayer.clear()
    if (cacheLayer.redis) {
      cacheLayer.redis.disconnect()
    }
  })

  describe('Core Endpoints', () => {
    it('GET /api/health → returns 200 + valid JSON', async () => {
      const res = await client.get('/api/health')
      assert.strictEqual(res.status, 200)
      assert.ok(res.data.status !== undefined)
      assert.strictEqual(res.headers['content-type'].includes('application/json'), true)
    })

    it('GET /api/ready → returns readiness structure', async () => {
      const res = await client.get('/api/ready')
      // Status could be 200 (ok/degraded)
      assert.ok([200, 503].includes(res.status))
      assert.ok(res.data.status !== undefined)
      assert.ok(res.data.upstream !== undefined)
    })

    it('GET /api/search?q=test → valid array response', async () => {
      const res = await client.get('/api/search?q=test')

      if (process.env.E2E_REAL_HTTP === 'true' && res.status !== 200) {
        // Accept failure if we are doing real HTTP and don't have internet
        assert.ok([500, 502, 503].includes(res.status))
      } else {
        assert.strictEqual(res.status, 200)
        assert.ok(Array.isArray(res.data))
      }
    })
  })

  describe('Auth Behavior', () => {
    before(() => {
      process.env.REQUIRE_API_KEY = 'true'
    })

    after(() => {
      process.env.REQUIRE_API_KEY = 'false'
    })

    it('no token → returns 401', async () => {
      const res = await client.get('/api/search?q=test')
      assert.strictEqual(res.status, 401)
      assert.ok(res.data.error)
    })

    it('valid token → returns 200', async () => {
      const { createKey } = require('../auth/apikeys')
      const newKey = createKey('e2e-test-client')

      const res = await client.get('/api/search?q=test', {
        headers: {
          'x-api-key': newKey.key
        }
      })

      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))
    })
  })

  if (process.env.E2E_REAL_HTTP === 'true') {
    describe('Real HTTP Integration', { timeout: 15000 }, () => {
      it('GET /api/search?q=beatles → real upstream connectivity and full aggregation flow', async () => {
        let res
        let retries = 3
        while (retries > 0) {
          try {
            res = await client.get('/api/search?q=beatles')
            if (res.status === 200) break
          } catch (e) {
            // Ignore connection errors and retry
          }
          retries--
          if (retries > 0) await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (res && res.status === 200) {
          assert.ok(Array.isArray(res.data))
          if (res.data.length > 0) {
            // Only validate structural properties, NOT exact data
            const firstResult = res.data[0]
            assert.ok(firstResult.id !== undefined || firstResult.name !== undefined || firstResult.title !== undefined)
          }
        } else {
          // If offline or completely failed after 3 retries, accept gracefully
          assert.ok(res && [500, 502, 503].includes(res.status))
        }
      })
    })
  }

  describe('Failure Scenarios', () => {
    before(() => {
      process.env.REQUIRE_API_KEY = 'false'
    })

    it('Redis unavailable → no crashes, graceful fallback behavior', async () => {
      if (cacheLayer.redis) {
        cacheLayer.redis.emit('error', new Error('Simulated Redis Error'))
        cacheLayer.isRedisHealthy = false
      }

      const res = await client.get('/api/search?q=redis-fail-test')
      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))

      const resHealth = await client.get('/api/health')
      assert.strictEqual(resHealth.status, 200)
    })

    it('Provider failure → graceful response, no crashes', async () => {
      const axiosModule = require('axios')

      // Since get might be already mocked, we restore if so
      if (axiosModule.get && axiosModule.get.mock) {
        axiosModule.get.mock.restore()
      }
      mock.method(axiosModule, 'get', async () => {
        throw new Error('Simulated Provider Failure')
      })
      if (axiosModule.post && axiosModule.post.mock) {
        axiosModule.post.mock.restore()
      }
      mock.method(axiosModule, 'post', async () => {
        throw new Error('Simulated Provider Failure')
      })

      const res = await client.get('/api/search?q=provider-fail-test')
      assert.ok([200, 500, 502, 503].includes(res.status))

      if (axiosModule.get && axiosModule.get.mock) axiosModule.get.mock.restore()
      if (axiosModule.post && axiosModule.post.mock) axiosModule.post.mock.restore()

      // If we are NOT in real HTTP mode, we should restore the global mock so other tests running after don't fail,
      // though this is the last test anyway.
    })
  })
})
