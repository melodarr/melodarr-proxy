const { describe, it, before, after, mock } = require('node:test')
const assert = require('node:assert')
const request = require('./supertest-shim')
const axios = require('axios')
const { createApp } = require('../server')
const cacheLayer = require('../cache')
const metrics = require('../metrics')

describe('Failure Handling E2E', () => {
  let app

  before(() => {
    process.env.REQUIRE_API_KEY = 'false'
    app = createApp()
    metrics.state.isRunning = true
  })

  after(() => {
    mock.restoreAll()
  })

  it('should handle provider failure gracefully without crashing', async () => {
    // Mock axios.get to simulate provider failure
    const axiosMock = mock.method(axios, 'get', async () => {
      const err = new Error('Simulated upstream failure')
      err.response = { status: 500 }
      err.code = 'ECONNREFUSED'
      throw err
    })

    const res = await request(app).get('/api/search?q=failuretest')

    // We expect 502 Bad Gateway
    assert.strictEqual(res.status, 502)
    assert.strictEqual(res.body.error, 'Failed to fetch from upstream API')

    // Check if the mock was called
    assert.strictEqual(axiosMock.mock.callCount() > 0, true)
  })

  it('should handle Redis unavailability (lock failure) gracefully', async () => {
    // Mock cache.acquireLock to always return false
    const lockMock = mock.method(cacheLayer, 'acquireLock', async () => false)

    const res = await request(app).get('/api/search?q=lockfailuretest')

    // Expect 502 Bad Gateway for lock acquisition failure
    assert.strictEqual(res.status, 502)
    assert.strictEqual(res.body.error, 'Failed to acquire distributed lock for upstream fetch')

    assert.strictEqual(lockMock.mock.callCount() > 0, true)
  })
})
