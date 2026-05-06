const { describe, it, mock, beforeEach, afterEach } = require('node:test')
const assert = require('node:assert/strict')
const { validateStartup } = require('./startupValidator')
const store = require('../settings/store')
const logger = require('./logger')

describe('Startup Validator', () => {
  let exitSpy
  let getConfigValueMock
  let loggerInfoMock
  let loggerErrorMock

  beforeEach(() => {
    getConfigValueMock = mock.method(store, 'getConfigValue', () => undefined)
    loggerInfoMock = mock.method(logger, 'info', () => {})
    loggerErrorMock = mock.method(logger, 'error', () => {})

    exitSpy = mock.method(process, 'exit', (code) => {
      throw new Error(`process.exit() was called with ${code}`)
    })
  })

  afterEach(() => {
    mock.restoreAll()
  })

  it('validates correct configuration successfully', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    assert.doesNotThrow(() => validateStartup())
    assert.strictEqual(loggerInfoMock.mock.calls.length, 1)
    assert.strictEqual(loggerInfoMock.mock.calls[0].arguments[0], 'Startup configuration validated successfully.')
    assert.strictEqual(exitSpy.mock.calls.length, 0)
  })

  it('fails if cacheTtlSeconds is missing or invalid', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return -1 // invalid
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
    assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Invalid cacheTtlSeconds configuration (must be a positive number).')
    assert.strictEqual(exitSpy.mock.calls.length, 1)
  })

  it('fails if upstreamTimeoutMs is missing or invalid', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 'not_a_number'
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
    assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Invalid upstreamTimeoutMs configuration (must be a positive number).')
    assert.strictEqual(exitSpy.mock.calls.length, 1)
  })

  it('fails if musicbrainzBaseUrl is invalid URL', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'not_a_url'
      return undefined
    })

    assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
    assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Invalid musicbrainzBaseUrl configuration (must be a valid HTTP URL).')
    assert.strictEqual(exitSpy.mock.calls.length, 1)
  })

  it('fails if minRequestIntervalMs is invalid', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return -500
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
    assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Invalid minRequestIntervalMs configuration (must be a non-negative number).')
    assert.strictEqual(exitSpy.mock.calls.length, 1)
  })

  it('fails if upstreamQueueMax is missing or invalid', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return -1
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
    assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Invalid upstreamQueueMax configuration (must be a positive number).')
    assert.strictEqual(exitSpy.mock.calls.length, 1)
  })

  it('fails if REDIS_ENABLED=true but REDIS_URL is missing', () => {
    getConfigValueMock.mock.mockImplementation((key) => {
      if (key === 'cacheTtlSeconds') return 3600
      if (key === 'upstreamTimeoutMs') return 5000
      if (key === 'serverTimeoutMs') return 15000
      if (key === 'minRequestIntervalMs') return 1100
      if (key === 'globalRateLimitMax') return 500
      if (key === 'maxConcurrentRequests') return 20
      if (key === 'upstreamQueueMax') return 50
      if (key === 'musicbrainzBaseUrl') return 'https://musicbrainz.org/ws/2'
      return undefined
    })

    const originalRedisEnabled = process.env.REDIS_ENABLED
    const originalRedisUrl = process.env.REDIS_URL
    process.env.REDIS_ENABLED = 'true'
    delete process.env.REDIS_URL

    try {
      assert.throws(() => validateStartup(), /process\.exit\(\) was called with 1/)
      assert.strictEqual(loggerErrorMock.mock.calls[0].arguments[0], 'Startup Validation Failed: Redis is enabled (REDIS_ENABLED=true) but REDIS_URL is missing.')
      assert.strictEqual(exitSpy.mock.calls.length, 1)
    } finally {
      if (originalRedisEnabled !== undefined) process.env.REDIS_ENABLED = originalRedisEnabled
      else delete process.env.REDIS_ENABLED

      if (originalRedisUrl !== undefined) process.env.REDIS_URL = originalRedisUrl
      else delete process.env.REDIS_URL
    }
  })
})
