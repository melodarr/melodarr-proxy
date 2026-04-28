const { after, test } = require('node:test')
const assert = require('node:assert/strict')

function makeNoop () {
  return { warn () {}, error () {}, info () {} }
}

function loadPipeline ({ cacheStore = new Map(), configValues = {}, metricsRecords = [] } = {}) {
  const pipelinePath = require.resolve('./pipeline')
  const cachePath = require.resolve('../cache')
  const storePath = require.resolve('../settings/store')
  const loggerPath = require.resolve('../utils/logger')
  const metricsPath = require.resolve('../metrics')
  const axiosPath = require.resolve('axios')

  delete require.cache[pipelinePath]
  delete require.cache[cachePath]
  delete require.cache[storePath]
  delete require.cache[loggerPath]
  delete require.cache[metricsPath]

  const fakeCache = {
    async get (key) { return cacheStore.get(key) || null },
    async set (key, value) { cacheStore.set(key, value) }
  }

  require.cache[cachePath] = {
    id: cachePath,
    filename: cachePath,
    loaded: true,
    exports: fakeCache
  }

  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getConfigValue (key) { return configValues[key] !== undefined ? configValues[key] : '' }
    }
  }

  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: makeNoop()
  }

  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: {
      recordEnrichment (data) { metricsRecords.push(data) }
    }
  }

  // Keep real axios in cache so no network call is triggered –
  // enrichArtistData only calls axios when an API key is configured.
  // Since configValues will have empty keys, no axios calls happen.
  require.cache[axiosPath] = require.cache[axiosPath] || { exports: require('axios') }

  return require('./pipeline')
}

// ── No artistName ─────────────────────────────────────────────────

test('enrichResult returns the original result unchanged when artistName is absent', async () => {
  const { enrichResult } = loadPipeline()
  const result = await enrichResult(null)
  assert.equal(result, null)
})

test('enrichResult returns the original result unchanged when artistName is empty', async () => {
  const { enrichResult } = loadPipeline()
  const input = { albums: [] }
  const result = await enrichResult(input)
  assert.strictEqual(result, input)
})

// ── Cache hit ─────────────────────────────────────────────────────

test('enrichResult uses cached enrichment data when available', async () => {
  const cachedEnrichment = {
    tags: ['rock', 'alternative'],
    genres: ['rock'],
    popularity: { listeners: 5000, playcount: 100000 }
  }
  // Cache key pattern: enrichment:<artistName.toLowerCase()>
  const cacheStore = new Map([['enrichment:radiohead', cachedEnrichment]])
  const metricsRecords = []

  const { enrichResult } = loadPipeline({ cacheStore, metricsRecords })
  const result = await enrichResult({ artistName: 'Radiohead', albums: [] })

  assert.deepEqual(result.tags, cachedEnrichment.tags)
  assert.deepEqual(result.genres, cachedEnrichment.genres)
  assert.deepEqual(result.popularity, cachedEnrichment.popularity)

  // Metrics should record a cache hit
  assert.equal(metricsRecords.length, 1)
  assert.equal(metricsRecords[0].cached, true)
  assert.equal(metricsRecords[0].success, true)
  assert.equal(metricsRecords[0].hasTags, true)
  assert.equal(metricsRecords[0].hasPopularity, true)
})

// ── Cache miss (no API keys configured → enrichArtistData returns defaults) ──

test('enrichResult fetches and caches enrichment on cache miss', async () => {
  const cacheStore = new Map()
  const metricsRecords = []

  const { enrichResult } = loadPipeline({ cacheStore, metricsRecords })
  const result = await enrichResult({ artistName: 'New Artist', albums: [{ title: 'Album 1' }] })

  // Result should have the enrichment fields (defaults from enrichArtistData)
  assert.ok(Array.isArray(result.tags))
  assert.ok(Array.isArray(result.genres))
  assert.ok(typeof result.popularity === 'object')

  // Original fields should be preserved
  assert.equal(result.artistName, 'New Artist')
  assert.equal(result.albums.length, 1)

  // Enrichment should be cached
  assert.ok(cacheStore.has('enrichment:new artist'))

  // Metrics should record a cache miss
  assert.equal(metricsRecords.length, 1)
  assert.equal(metricsRecords[0].cached, false)
  assert.equal(metricsRecords[0].success, true)
})

test('enrichResult normalises cache key (lowercases)', async () => {
  const cacheStore = new Map()
  const { enrichResult } = loadPipeline({ cacheStore })

  await enrichResult({ artistName: 'My Artist', albums: [] })

  assert.ok(cacheStore.has('enrichment:my artist'))
})

// ── Debug mode ────────────────────────────────────────────────────

test('enrichResult includes _enrichmentDebug when isDebug is true', async () => {
  const cacheStore = new Map()
  const { enrichResult } = loadPipeline({ cacheStore })

  const result = await enrichResult({ artistName: 'Debug Artist', albums: [] }, true)

  assert.ok(result._enrichmentDebug)
  assert.equal(typeof result._enrichmentDebug.latencyMs, 'number')
  assert.ok(result._enrichmentDebug.latencyMs >= 0)
  assert.equal(typeof result._enrichmentDebug.cached, 'boolean')
})

test('enrichResult does not include _enrichmentDebug by default', async () => {
  const cacheStore = new Map()
  const { enrichResult } = loadPipeline({ cacheStore })

  const result = await enrichResult({ artistName: 'Normal Artist', albums: [] })

  assert.equal(result._enrichmentDebug, undefined)
})

test('enrichResult _enrichmentDebug marks cached=true on cache hit', async () => {
  const cachedEnrichment = { tags: [], genres: [], popularity: { listeners: 0, playcount: 0 } }
  const cacheStore = new Map([['enrichment:cached artist', cachedEnrichment]])

  const { enrichResult } = loadPipeline({ cacheStore })
  const result = await enrichResult({ artistName: 'Cached Artist', albums: [] }, true)

  assert.equal(result._enrichmentDebug.cached, true)
})

// ── Metrics recording ─────────────────────────────────────────────

test('enrichResult records latencyMs in metrics', async () => {
  const metricsRecords = []
  const { enrichResult } = loadPipeline({ metricsRecords })

  await enrichResult({ artistName: 'Timed Artist', albums: [] })

  assert.equal(metricsRecords.length, 1)
  assert.equal(typeof metricsRecords[0].latencyMs, 'number')
})

after(() => {
  // Clean up require.cache entries introduced by the tests
  const paths = [
    './pipeline', '../cache', '../settings/store', '../utils/logger', '../metrics'
  ].map(p => {
    try { return require.resolve(p) } catch (_) { return null }
  }).filter(Boolean)

  for (const p of paths) {
    delete require.cache[p]
  }
})
