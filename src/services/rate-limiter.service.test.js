const test = require('node:test')
const assert = require('node:assert/strict')

function loadRateLimiter (settings = {}) {
  delete require.cache[require.resolve('./rate-limiter.service')]
  require.cache[require.resolve('../settings/store')] = {
    exports: {
      getConfigValue: (key) => settings[key]
    }
  }
  return require('./rate-limiter.service')
}

test('getProviderMinRequestIntervalMs uses provider-specific settings', () => {
  const limiter = loadRateLimiter({
    minRequestIntervalMs: 1100,
    itunesMinRequestIntervalMs: 100,
    lastfmMinRequestIntervalMs: 200,
    discogsMinRequestIntervalMs: 1000,
    theAudioDbMinRequestIntervalMs: 1200,
    customProviderMinRequestIntervalMs: 500
  })

  assert.equal(limiter.getProviderMinRequestIntervalMs('musicbrainz'), 1100)
  assert.equal(limiter.getProviderMinRequestIntervalMs('itunes'), 100)
  assert.equal(limiter.getProviderMinRequestIntervalMs('lastfm'), 200)
  assert.equal(limiter.getProviderMinRequestIntervalMs('discogs'), 1000)
  assert.equal(limiter.getProviderMinRequestIntervalMs('theaudiodb'), 1200)
  assert.equal(limiter.getProviderMinRequestIntervalMs('custom'), 500)
})

test('getProviderMinRequestIntervalMs falls back safely for invalid values', () => {
  const limiter = loadRateLimiter({
    providerMinRequestIntervalMs: 750,
    itunesMinRequestIntervalMs: -1
  })

  assert.equal(limiter.getProviderMinRequestIntervalMs('itunes'), 750)
  assert.equal(limiter.getProviderMinRequestIntervalMs('unknown'), 750)
})

test('enqueueProviderRequest rejects when provider queue is full', async () => {
  const limiter = loadRateLimiter({
    upstreamQueueMax: 1,
    maxConcurrentRequests: 1,
    customProviderMinRequestIntervalMs: 1000
  })

  const never = limiter.enqueueProviderRequest('custom-provider', () => new Promise(() => {}))
  const queued = limiter.enqueueProviderRequest('custom-provider', async () => 'queued')

  await assert.rejects(
    limiter.enqueueProviderRequest('custom-provider', async () => 'blocked'),
    (err) => err.code === 'PROVIDER_QUEUE_FULL' && err.status === 503
  )

  never.catch(() => {})
  queued.catch(() => {})
})

test('enqueueProviderRequest executes queued provider work', async () => {
  const limiter = loadRateLimiter({
    upstreamQueueMax: 5,
    maxConcurrentRequests: 2,
    providerMinRequestIntervalMs: 500,
    itunesMinRequestIntervalMs: 0
  })

  const results = await Promise.all([
    limiter.enqueueProviderRequest('itunes', async () => 'a'),
    limiter.enqueueProviderRequest('itunes', async () => 'b')
  ])

  assert.deepEqual(results.sort(), ['a', 'b'])
})

test('enqueueProviderRequest respects Retry-After cooling period on 429', async () => {
  const limiter = loadRateLimiter({
    upstreamQueueMax: 5,
    maxConcurrentRequests: 1,
    itunesMinRequestIntervalMs: 0
  })

  const err429 = new Error('Rate limited')
  err429.response = { status: 429, headers: { 'retry-after': '1' } }

  await assert.rejects(
    limiter.enqueueProviderRequest('itunes', async () => { throw err429 }),
    (err) => err.message === 'Rate limited'
  )

  const start = Date.now()
  let executed = false

  await limiter.enqueueProviderRequest('itunes', async () => {
    executed = true
    return 'success'
  })

  const duration = Date.now() - start
  assert.equal(executed, true)
  assert.ok(duration >= 900, `Expected duration >= 900ms but was ${duration}ms`)
})
