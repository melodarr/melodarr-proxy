const { after, test } = require('node:test')
const assert = require('node:assert')
const { getProviderScore } = require('./scoring')
const metrics = require('../metrics')
const store = require('../settings/store')

after(() => {
  metrics.shutdown()
})

test('getProviderScore calculates correct score for perfect provider', (t) => {
  // Mock metrics
  metrics.providerStats.set('musicbrainz', {
    calls: 10,
    errors: 0,
    totalLatency: 500 // 50ms average
  })

  // Mock settings
  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = (key) => {
    if (key === 'providerPriority') return ''
    return undefined
  }

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('musicbrainz', resultData)
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(0.975)*0.2 => 0.4 + 0.4 + 0.195 = 0.995 => 100
  assert.strictEqual(score, 100)

  // Restore
  store.getConfigValue = originalGetConfigValue
  metrics.providerStats.delete('musicbrainz')
})

test('getProviderScore applies penalty for high latency', (t) => {
  metrics.providerStats.set('lastfm', {
    calls: 5,
    errors: 0,
    totalLatency: 10000 // 2000ms average
  })

  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = () => ''

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('lastfm', resultData)
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(0)*0.2 => 0.4 + 0.4 + 0 = 0.80 => 80
  assert.strictEqual(score, 80)

  store.getConfigValue = originalGetConfigValue
  metrics.providerStats.delete('lastfm')
})

test('getProviderScore applies penalty for errors', (t) => {
  metrics.providerStats.set('discogs', {
    calls: 10,
    errors: 5, // 50% success rate
    totalLatency: 1000 // 100ms average
  })

  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = () => ''

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('discogs', resultData)
  // successRate(0.5)*0.4 + dataCompleteness(1)*0.4 + latency(0.95)*0.2 => 0.2 + 0.4 + 0.19 = 0.79 => 79
  assert.strictEqual(score, 79)

  store.getConfigValue = originalGetConfigValue
  metrics.providerStats.delete('discogs')
})

test('getProviderScore applies penalty for incomplete data', (t) => {
  metrics.providerStats.set('test-provider', {
    calls: 10,
    errors: 0,
    totalLatency: 500
  })

  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = () => ''

  const resultData = {
    albums: [{ year: '2023' }, { year: null }, { title: 'No Year' }, { title: 'Missing Year' }] // 25% data completeness
  }

  const score = getProviderScore('test-provider', resultData)
  // successRate(1)*0.4 + dataCompleteness(0.25)*0.4 + latency(0.975)*0.2 => 0.4 + 0.10 + 0.195 = 0.695 => 70
  assert.strictEqual(score, 70)

  store.getConfigValue = originalGetConfigValue
  metrics.providerStats.delete('test-provider')
})

test('getProviderScore applies priority boost', (t) => {
  metrics.providerStats.set('musicbrainz', {
    calls: 10,
    errors: 0,
    totalLatency: 500 // 50ms
  })

  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = (key) => {
    if (key === 'providerPriority') return 'musicbrainz,lastfm'
    return undefined
  }

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }]
  }

  const score = getProviderScore('musicbrainz', resultData)
  // base score is ~100.
  // priorities: length=2, index=0
  // boost = 1 + ((2 - 0) * 0.1) = 1.2
  // 100 * 1.2 = 120 -> capped at 100
  assert.strictEqual(score, 100)

  store.getConfigValue = originalGetConfigValue
  metrics.providerStats.delete('musicbrainz')
})

test('getProviderScore handles missing metrics gracefully', (t) => {
  const originalGetConfigValue = store.getConfigValue
  store.getConfigValue = () => ''

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }]
  }

  // No metrics set for 'unknown'
  const score = getProviderScore('unknown', resultData)
  // Default values: successRate(1), latencyMs(0) -> max score
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(1)*0.2 = 1.0 -> 100
  assert.strictEqual(score, 100)

  store.getConfigValue = originalGetConfigValue
})
