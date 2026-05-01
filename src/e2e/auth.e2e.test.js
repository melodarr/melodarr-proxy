const { describe, it, before } = require('node:test')
const assert = require('node:assert')
const request = require('./supertest-shim')
const { createApp } = require('../server')
const metrics = require('../metrics')

describe('Auth E2E', () => {
  let app

  before(() => {
    app = createApp()
    metrics.state.isRunning = true
  })

  it('should return 401 when REQUIRE_API_KEY is true and no token provided', async () => {
    process.env.REQUIRE_API_KEY = 'true'
    const res = await request(app).get('/api/search?q=test')
    assert.strictEqual(res.status, 401)
  })

  it('should return 200 or 502 when REQUIRE_API_KEY is true and valid token provided', async () => {
    process.env.REQUIRE_API_KEY = 'true'
    const { createKey } = require('../auth/apikeys')
    const keyInfo = createKey('E2E Test Key')
    const res = await request(app)
      .get('/api/search?q=test')
      .set('x-api-key', keyInfo.key)

    assert.ok(res.status === 200 || res.status === 502)
  })

  it('should return 200 or 502 when REQUIRE_API_KEY is false and no token provided', async () => {
    process.env.REQUIRE_API_KEY = 'false'
    const res = await request(app).get('/api/search?q=test')
    assert.ok(res.status === 200 || res.status === 502)
  })
})
