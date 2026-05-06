const test = require('node:test')
const assert = require('node:assert/strict')

// Heavy-stub debug.controller's transitive deps so this test file
// exits cleanly (cache.js opens timers; tracer/providers chains are
// large). Same pattern as debug.providers.test.js.
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
  '../services/diagnose.service': { diagnoseMusicBrainz: async () => ({}) },
  '../diagnostics/upstream-buffer': { query: () => ({ entries: [], filteredCount: 0, totalCount: 0, maxSize: 100 }) },
  '../utils/dates': { toIsoDate: (v) => String(v || '') },
  '../utils/logger': { error () {}, warn () {}, info () {}, debug () {} }
}

for (const [path, exports] of Object.entries(heavyStubs)) {
  require.cache[require.resolve(path, { paths: [require('path').dirname(require.resolve('./debug.controller'))] })] = { exports }
}

delete require.cache[require.resolve('../health/providerMetrics')]
const providerMetrics = require('../health/providerMetrics')
delete require.cache[require.resolve('./debug.controller')]
const { getProvidersMetricsDebug } = require('./debug.controller')

function withFrozenNow (now, fn) {
  const original = Date.now
  Date.now = () => now
  try { return fn() } finally { Date.now = original }
}

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (s) { this.statusCode = s; return this },
    json (b) { this.body = b; return this }
  }
}

test('getProvidersMetricsDebug — empty state returns 200 with empty providers array', () => {
  providerMetrics.reset()
  const res = makeRes()
  getProvidersMetricsDebug({}, res)
  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body.providers))
  assert.equal(res.body.providers.length, 0)
})

test('getProvidersMetricsDebug — surfaces raw, decayed, and score for a recorded provider', () => {
  providerMetrics.reset()
  withFrozenNow(1_000_000_000, () => {
    providerMetrics.record('mb', true, 200)
    providerMetrics.record('mb', true, 200)
  })

  const res = withFrozenNow(1_000_000_000, () => {
    const r = makeRes()
    getProvidersMetricsDebug({}, r)
    return r
  })

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.providers.length, 1)
  const p = res.body.providers[0]
  assert.equal(p.name, 'mb')
  // raw: untouched counters
  assert.equal(p.raw.success, 2)
  assert.equal(p.raw.failure, 0)
  assert.equal(p.raw.timeouts, 0)
  assert.equal(p.raw.avgLatency, 200)
  // decayed: at zero elapsed time, identical to raw
  assert.equal(p.decayed.success, 2)
  assert.equal(p.decayed.failure, 0)
  // score: pure number from the documented formula
  assert.ok(typeof p.score === 'number' && p.score > 0 && p.score <= 1)
})

test('getProvidersMetricsDebug — decayed counters shrink with elapsed time, raw stays', () => {
  providerMetrics.reset()
  withFrozenNow(1_000_000_000, () => {
    for (let i = 0; i < 100; i++) providerMetrics.record('mb', true, 100)
  })
  // 60 minutes later — factor = 0.98^60 ≈ 0.2975
  const res = withFrozenNow(1_000_000_000 + 60 * 60_000, () => {
    const r = makeRes()
    getProvidersMetricsDebug({}, r)
    return r
  })
  const p = res.body.providers[0]
  assert.equal(p.raw.success, 100, 'raw success preserved across reads')
  assert.ok(p.decayed.success < 31 && p.decayed.success > 29, `decayed success ~30: ${p.decayed.success}`)
})

test('getProvidersMetricsDebug — multiple providers each have raw/decayed/score', () => {
  providerMetrics.reset()
  providerMetrics.record('mb', true, 100)
  providerMetrics.record('itunes', false, 500)
  providerMetrics.record('discogs', true, 200)

  const res = makeRes()
  getProvidersMetricsDebug({}, res)
  assert.equal(res.body.providers.length, 3)
  const names = res.body.providers.map((p) => p.name).sort()
  assert.deepEqual(names, ['discogs', 'itunes', 'mb'])
  for (const p of res.body.providers) {
    assert.ok(p.raw, 'each provider has raw')
    assert.ok(p.decayed, 'each provider has decayed')
    assert.ok(typeof p.score === 'number')
  }
})

test('getProvidersMetricsDebug — does NOT mutate metrics state', () => {
  providerMetrics.reset()
  providerMetrics.record('mb', true, 200)

  const before = JSON.parse(JSON.stringify(providerMetrics.get('mb')))
  getProvidersMetricsDebug({}, makeRes())
  getProvidersMetricsDebug({}, makeRes())
  const after = providerMetrics.get('mb')

  assert.equal(after.success, before.success)
  assert.equal(after.failure, before.failure)
  assert.equal(after.lastDecayAt, before.lastDecayAt)
})

test('getProvidersMetricsDebug — response shape contract', () => {
  providerMetrics.reset()
  providerMetrics.record('mb', true, 100)

  const res = makeRes()
  getProvidersMetricsDebug({}, res)

  assert.deepEqual(Object.keys(res.body), ['providers'])
  const p = res.body.providers[0]
  assert.deepEqual(Object.keys(p).sort(), ['decayed', 'name', 'raw', 'score'])
  assert.deepEqual(Object.keys(p.raw).sort(), ['avgLatency', 'failure', 'lastDecayAt', 'lastSuccess', 'lastUpdated', 'success', 'timeouts'])
  assert.deepEqual(Object.keys(p.decayed).sort(), ['avgLatency', 'failure', 'success'])
})
