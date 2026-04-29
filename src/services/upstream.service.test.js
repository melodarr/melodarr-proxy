const test = require('node:test')
const assert = require('node:assert')

function setupMocks () {
  delete require.cache[require.resolve('./upstream.service')]

  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => {
        if (key === 'musicbrainzBaseUrl') return 'http://mb.test'
        if (key === 'upstreamTimeoutMs') return 1000
        if (key === 'musicbrainzIpFamily') return 'auto'
        if (key === 'minRequestIntervalMs') return 0
        return 'dummy'
      }
    }
  }

  const axiosRequests = []
  const axiosMock = {
    get: async (url, options) => {
      axiosRequests.push({ url, options })

      if (url.includes('timeout')) {
        const err = new Error('timeout')
        err.code = 'ECONNABORTED'
        throw err
      }
      if (url.includes('error500')) {
        const err = new Error('error500')
        err.response = { status: 500 }
        throw err
      }
      if (url.includes('rate429')) {
        return { status: 429 }
      }
      if (url.includes('retry-success')) {
        if (axiosRequests.length < 2) {
          const err = new Error('temp error')
          err.response = { status: 502 }
          throw err
        }
        return { status: 200, data: { success: true } }
      }
      if (url.includes('retry-fail')) {
        const err = new Error('permanent error')
        err.response = { status: 502 }
        throw err
      }

      return { status: 200, data: { ok: true } }
    }
  }
  require.cache[require.resolve('axios')] = { exports: axiosMock }

  // mock logger to prevent console noise
  require.cache[require.resolve('../utils/logger')] = {
    exports: { error: () => {}, info: () => {} }
  }

  const upstreamService = require('./upstream.service')
  return { upstreamService, axiosRequests, axiosMock }
}

test('Upstream Service', async (t) => {
  await t.test('probe - returns healthy on 200', async () => {
    const { upstreamService } = setupMocks()
    const result = await upstreamService.probe()
    assert.strictEqual(result.status, 'healthy')
  })

  await t.test('probe - returns rate_limited on 429', async () => {
    const { upstreamService, axiosMock } = setupMocks()
    axiosMock.get = async () => ({ status: 429 })
    const result = await upstreamService.probe()
    assert.strictEqual(result.status, 'rate_limited')
  })

  await t.test('probe - returns degraded on 500', async () => {
    const { upstreamService, axiosMock } = setupMocks()
    axiosMock.get = async () => ({ status: 502 })
    const result = await upstreamService.probe()
    assert.strictEqual(result.status, 'degraded')
  })

  await t.test('probe - returns timeout on ECONNABORTED', async () => {
    const { upstreamService, axiosMock } = setupMocks()
    axiosMock.get = async () => {
      const e = new Error('timeout')
      e.code = 'ECONNABORTED'
      throw e
    }
    const result = await upstreamService.probe()
    assert.strictEqual(result.status, 'timeout')
  })

  await t.test('checkHealth - returns reachable or unreachable', async () => {
    const { upstreamService, axiosMock } = setupMocks()

    // healthy
    axiosMock.get = async () => ({ status: 200 })
    assert.strictEqual(await upstreamService.checkHealth(), 'reachable')

    // unhealthy
    axiosMock.get = async () => ({ status: 500 })
    assert.strictEqual(await upstreamService.checkHealth(), 'unreachable')
  })

  await t.test('search - enqueues request and returns data', async () => {
    const { upstreamService, axiosRequests } = setupMocks()
    const result = await upstreamService.search('test')
    assert.strictEqual(result.ok, true)
    assert.strictEqual(axiosRequests.length, 1)
  })

  await t.test('musicBrainzGet - retries on 5xx errors and succeeds', async () => {
    const { upstreamService, axiosRequests } = setupMocks()
    const result = await upstreamService.musicBrainzGet('/retry-success')
    assert.strictEqual(result.success, true)
    assert.strictEqual(axiosRequests.length, 2)
  })

  await t.test('musicBrainzGet - throws after 3 retries', async () => {
    const { upstreamService, axiosRequests } = setupMocks()
    await assert.rejects(
      async () => upstreamService.musicBrainzGet('/retry-fail'),
      /permanent error/
    )
    assert.strictEqual(axiosRequests.length, 3)
  })

  await t.test('musicBrainzGet - throws immediately on 4xx', async () => {
    const { upstreamService, axiosMock, axiosRequests } = setupMocks()
    axiosMock.get = async () => {
      axiosRequests.push({})
      const e = new Error('auth failed')
      e.response = { status: 401 }
      throw e
    }
    await assert.rejects(
      async () => upstreamService.musicBrainzGet('/401'),
      /auth failed/
    )
    assert.strictEqual(axiosRequests.length, 1)
  })
})
