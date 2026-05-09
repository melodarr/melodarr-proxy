const test = require('node:test')
const assert = require('node:assert/strict')

// debug.controller transitively pulls cache (Redis timers), tracer, the
// providers index (HTTP agents), and other modules that hold the event
// loop open after tests finish. Stub everything debug.controller imports
// so this test file can complete cleanly without leaving open handles.
//
// Only stub deps that aren't relevant to getProvidersDebug — providerHealth
// and providerMetrics are loaded for real since they ARE the unit under test.

const heavyStubs = {
  '../tracer': { createTrace: () => ({}), addStep () {}, finalizeTrace: async () => {} },
  '../cache': {
    isReady: async () => false,
    getHealth: () => 'ok',
    getStats: () => ({}),
    isRedisHealthy: false,
    get: async () => null,
    set: async () => {}
  },
  '../metrics': { state: { isRunning: true }, providerStats: new Map(), getStats: () => ({ providers: {} }) },
  '../providers': { aggregateArtist: async () => ({}) },
  '../providers/artist-discovery': { discoverArtists: async () => [], findSongAlbums: async () => ({}) },
  '../ranking/engine': { rankResults: () => ({ results: [], debug: {} }) },
  '../enrichment/pipeline': { enrichResult: async (r) => r },
  '../snapshots': { getSnapshots: async () => [] },
  './health.controller': { buildHealthPayload: () => ({ status: 'ok' }) },
  '../providers/custom.provider': { testCustomProvider: async () => ({}) },
  '../settings/store': { getConfigValue: () => null },
  '../services/diagnose.service': { diagnoseMusicBrainz: async () => ({}), diagnoseGenericProvider: async () => ({}) },
  '../diagnostics/upstream-buffer': { query: () => ({ entries: [], filteredCount: 0, totalCount: 0, maxSize: 100 }) },
  '../utils/dates': { toIsoDate: (v) => String(v || '') },
  '../utils/logger': { error () {}, warn () {}, info () {}, debug () {} }
}

for (const [path, exports] of Object.entries(heavyStubs)) {
  require.cache[require.resolve(path, { paths: [require('path').dirname(require.resolve('./debug.controller'))] })] = { exports }
}

// Force-reload health/metrics so each test gets a clean state map and
// the controller binds to the same instances we drive in test setup.
delete require.cache[require.resolve('../health/providerHealth')]
delete require.cache[require.resolve('../health/providerMetrics')]
const providerHealth = require('../health/providerHealth')
const providerMetrics = require('../health/providerMetrics')
delete require.cache[require.resolve('./debug.controller')]
const { getProvidersDebug } = require('./debug.controller')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (s) { this.statusCode = s; return this },
    json (b) { this.body = b; return this }
  }
}

test('getProvidersDebug — empty state returns 200 with empty providers array', () => {
  providerHealth.reset()
  providerMetrics.reset()

  const res = makeRes()
  getProvidersDebug({}, res)

  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body.providers))
  assert.equal(res.body.providers.length, 0)
})

test('getProvidersDebug — surfaces a healthy provider with score and counters', () => {
  providerHealth.reset()
  providerMetrics.reset()

  providerHealth.recordSuccess('musicbrainz')
  providerMetrics.record('musicbrainz', true, 200)

  const res = makeRes()
  getProvidersDebug({}, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.providers.length, 1)
  const p = res.body.providers[0]
  assert.equal(p.name, 'musicbrainz')
  assert.equal(p.status, 'healthy')
  assert.equal(p.success, 1)
  assert.equal(p.failure, 0)
  assert.equal(p.failures, 0)
  assert.equal(p.timeouts, 0)
  assert.equal(p.avgLatency, 200)
  assert.ok(typeof p.score === 'number' && p.score > 0 && p.score <= 1)
  assert.ok(typeof p.lastSuccess === 'number')
  assert.equal(p.lastFailure, null)
})

test('getProvidersDebug — surfaces a disabled provider after 3 failures', () => {
  providerHealth.reset()
  providerMetrics.reset()

  providerHealth.recordFailure('discogs', 'boom')
  providerHealth.recordFailure('discogs', 'boom')
  providerHealth.recordFailure('discogs', 'boom')
  providerMetrics.record('discogs', false, 500)
  providerMetrics.record('discogs', false, 500)
  providerMetrics.record('discogs', false, 500)

  const res = makeRes()
  getProvidersDebug({}, res)

  const p = res.body.providers.find((x) => x.name === 'discogs')
  assert.ok(p)
  assert.equal(p.status, 'disabled')
  assert.equal(p.failures, 3)
  assert.equal(p.failure, 3)
  assert.equal(p.success, 0)
})

test('getProvidersDebug — unions names from health and metrics maps', () => {
  providerHealth.reset()
  providerMetrics.reset()

  providerMetrics.record('only-metrics', true, 100)
  providerHealth.recordSuccess('only-health')
  providerHealth.recordSuccess('both')
  providerMetrics.record('both', true, 100)

  const res = makeRes()
  getProvidersDebug({}, res)

  const names = res.body.providers.map((p) => p.name).sort()
  assert.deepEqual(names, ['both', 'only-health', 'only-metrics'])
})

test('getProvidersDebug — response shape is the documented contract', () => {
  providerHealth.reset()
  providerMetrics.reset()

  providerHealth.recordSuccess('musicbrainz')
  providerMetrics.record('musicbrainz', true, 100)

  const res = makeRes()
  getProvidersDebug({}, res)

  assert.deepEqual(Object.keys(res.body), ['providers'])

  const required = ['name', 'status', 'failures', 'timeouts', 'success', 'failure', 'avgLatency', 'score', 'lastSuccess', 'lastFailure']
  for (const key of required) {
    assert.ok(key in res.body.providers[0], `missing key: ${key}`)
  }
})

test('getProvidersDebug — does NOT mutate health or metrics state', () => {
  providerHealth.reset()
  providerMetrics.reset()

  providerHealth.recordSuccess('musicbrainz')
  providerMetrics.record('musicbrainz', true, 200)

  const beforeHealth = JSON.stringify(providerHealth.get('musicbrainz'))
  const beforeMetrics = JSON.stringify(providerMetrics.get('musicbrainz'))

  getProvidersDebug({}, makeRes())
  getProvidersDebug({}, makeRes())
  getProvidersDebug({}, makeRes())

  assert.equal(JSON.stringify(providerHealth.get('musicbrainz')), beforeHealth)
  assert.equal(JSON.stringify(providerMetrics.get('musicbrainz')), beforeMetrics)
})
