const test = require('node:test')
const assert = require('node:assert/strict')

let cacheStore
const aggregateArtist = async () => ({
  artistName: 'Test Artist',
  confidence: 1,
  providers: [{ name: 'musicbrainz', albumCount: 1 }],
  albums: [{
    name: 'Rated Album',
    year: 2001,
    releaseDate: '2001-02-03',
    imageUrl: 'https://example.test/rated.jpg',
    provider: 'musicbrainz',
    rating: { count: 42, value: 4.5 },
    ratings: { votes: 42, value: 4.5 },
    ids: { musicbrainzReleaseGroupId: 'rg-rated' }
  }],
  partial: false,
  warning: null
})

const heavyStubs = {
  '../tracer': { createTrace: () => ({}), addStep () {}, finalizeTrace: async () => {} },
  '../cache': {
    isReady: async () => false,
    getHealth: () => 'ok',
    getStats: () => ({}),
    isRedisHealthy: false,
    get: async (key) => cacheStore.get(key) || null,
    set: async (key, data) => { cacheStore.set(key, { data, generatedAt: '2026-05-06T00:00:00.000Z' }) },
    ttlSeconds: async () => 3600
  },
  '../metrics': { state: { isRunning: true }, providerStats: new Map() },
  '../providers': { aggregateArtist },
  '../providers/artist-discovery': { discoverArtists: async () => [], findSongAlbums: async () => ({}) },
  '../enrichment/pipeline': { enrichResult: async (r) => r },
  '../snapshots': { getSnapshots: async () => [] },
  './health.controller': { buildHealthPayload: () => ({ status: 'ok' }) },
  '../providers/custom.provider': { testCustomProvider: async () => ({}) },
  '../settings/store': { getConfigValue: (key) => key === 'cacheTtlSeconds' ? 7200 : null },
  '../services/diagnose.service': { diagnoseMusicBrainz: async () => ({}) },
  '../diagnostics/upstream-buffer': { query: () => ({ entries: [], filteredCount: 0, totalCount: 0, maxSize: 100 }) },
  '../utils/logger': { error () {}, warn () {}, info () {}, debug () {} }
}

for (const [path, exports] of Object.entries(heavyStubs)) {
  require.cache[require.resolve(path, { paths: [require('path').dirname(require.resolve('./debug.controller'))] })] = { exports }
}

delete require.cache[require.resolve('./debug.controller')]
const { handleDebugSearch } = require('./debug.controller')

function makeRes () {
  return {
    statusCode: 200,
    body: undefined,
    status (s) { this.statusCode = s; return this },
    json (b) { this.body = b; return this }
  }
}

test('handleDebugSearch preserves album ratings on miss and cache hit', async () => {
  cacheStore = new Map()

  const miss = makeRes()
  await handleDebugSearch({ query: { q: 'Test Artist' } }, miss)

  assert.equal(miss.statusCode, 200)
  assert.equal(miss.body.cache.status, 'MISS')
  assert.deepEqual(miss.body.normalizedResults[0].albums[0].rating, { count: 42, value: 4.5 })
  assert.deepEqual(miss.body.normalizedResults[0].albums[0].ratings, { votes: 42, value: 4.5 })

  const hit = makeRes()
  await handleDebugSearch({ query: { q: 'Test Artist' } }, hit)

  assert.equal(hit.statusCode, 200)
  assert.equal(hit.body.cache.status, 'HIT')
  assert.deepEqual(hit.body.normalizedResults[0].albums[0].rating, { count: 42, value: 4.5 })
  assert.deepEqual(hit.body.normalizedResults[0].albums[0].ratings, { votes: 42, value: 4.5 })
})
