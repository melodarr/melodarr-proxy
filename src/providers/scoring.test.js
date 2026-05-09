const { after, test } = require('node:test')
const assert = require('node:assert')
const { getProviderScore } = require('./scoring')
const metrics = require('../metrics')

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

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('musicbrainz', resultData)
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(0.975)*0.2 => 0.4 + 0.4 + 0.195 = 0.995 => 100
  assert.strictEqual(score, 100)

  metrics.providerStats.delete('musicbrainz')
})

test('getProviderScore applies penalty for high latency', (t) => {
  metrics.providerStats.set('lastfm', {
    calls: 5,
    errors: 0,
    totalLatency: 10000 // 2000ms average
  })

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('lastfm', resultData)
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(0)*0.2 => 0.4 + 0.4 + 0 = 0.80 => 80
  assert.strictEqual(score, 80)

  metrics.providerStats.delete('lastfm')
})

test('getProviderScore applies penalty for errors', (t) => {
  metrics.providerStats.set('discogs', {
    calls: 10,
    errors: 5, // 50% success rate
    totalLatency: 1000 // 100ms average
  })

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }] // 100% data completeness
  }

  const score = getProviderScore('discogs', resultData)
  // successRate(0.5)*0.4 + dataCompleteness(1)*0.4 + latency(0.95)*0.2 => 0.2 + 0.4 + 0.19 = 0.79 => 79
  assert.strictEqual(score, 79)

  metrics.providerStats.delete('discogs')
})

test('getProviderScore applies penalty for incomplete data', (t) => {
  metrics.providerStats.set('test-provider', {
    calls: 10,
    errors: 0,
    totalLatency: 500
  })

  const resultData = {
    albums: [{ year: '2023' }, { year: null }, { title: 'No Year' }, { title: 'Missing Year' }] // 25% data completeness
  }

  const score = getProviderScore('test-provider', resultData)
  // successRate(1)*0.4 + dataCompleteness(0.25)*0.4 + latency(0.975)*0.2 => 0.4 + 0.10 + 0.195 = 0.695 => 70
  assert.strictEqual(score, 70)

  metrics.providerStats.delete('test-provider')
})

test('getProviderScore ignores provider priority configuration', (t) => {
  metrics.providerStats.set('musicbrainz', {
    calls: 10,
    errors: 0,
    totalLatency: 500 // 50ms
  })

  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }]
  }

  const score = getProviderScore('musicbrainz', resultData)
  assert.strictEqual(score, 100)

  metrics.providerStats.delete('musicbrainz')
})

test('getProviderScore handles missing metrics gracefully', (t) => {
  const resultData = {
    albums: [{ year: '2023' }, { year: '2022' }]
  }

  // No metrics set for 'unknown'
  const score = getProviderScore('unknown', resultData)
  // Default values: successRate(1), latencyMs(0) -> max score
  // successRate(1)*0.4 + dataCompleteness(1)*0.4 + latency(1)*0.2 = 1.0 -> 100
  assert.strictEqual(score, 100)
})
