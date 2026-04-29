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

  let axiosMock = require('axios')
  if (configValues.mockAxios) {
    axiosMock = { get: configValues.mockAxios }
  }

  require.cache[axiosPath] = {
    id: axiosPath,
    filename: axiosPath,
    loaded: true,
    exports: axiosMock
  }

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
    './pipeline', '../cache', '../settings/store', '../utils/logger', '../metrics', 'axios'
  ].map(p => {
    try { return require.resolve(p) } catch (_) { return null }
  }).filter(Boolean)

  for (const p of paths) {
    delete require.cache[p]
  }
})

// ── Enrichment APIs (LastFM & Discogs) ──────────────────────────

test('enrichArtistData calls Last.fm and Discogs and handles success', async () => {
  const cacheStore = new Map()
  const mockAxios = async (url, options) => {
    if (url.includes('audioscrobbler.com')) {
      return {
        data: {
          artist: {
            stats: { listeners: '123', playcount: '456' },
            tags: { tag: [{ name: 'pop' }, { name: 'indie' }] }
          }
        }
      }
    }
    if (url.includes('api.discogs.com')) {
      return {
        data: {
          results: [
            { title: 'The Band', genre: ['Rock', 'Folk'] }
          ]
        }
      }
    }
    return { data: {} }
  }

  const { enrichResult } = loadPipeline({
    cacheStore,
    configValues: {
      lastfmApiKey: 'fake-lastfm-key',
      discogsToken: 'fake-discogs-token',
      appName: 'TestApp',
      appVersion: '1.0.0',
      mockAxios
    }
  })

  const result = await enrichResult({ artistName: 'The Band', albums: [] })
  assert.equal(result.popularity.listeners, 123)
  assert.equal(result.popularity.playcount, 456)
  assert.deepEqual(result.tags, ['pop', 'indie'])
  assert.deepEqual(result.genres, ['pop', 'indie', 'Rock', 'Folk'])
})

test('enrichArtistData handles Last.fm single tag and Discogs empty results', async () => {
  const cacheStore = new Map()
  const mockAxios = async (url, options) => {
    // Also tests the dns.lookup logic inside the https agent because it is instantiated at module level
    // Wait, dns.lookup doesn't get called in mocks but we can't easily test it.
    if (url.includes('audioscrobbler.com')) {
      return {
        data: {
          artist: {
            tags: { tag: { name: 'single-tag' } }
          }
        }
      }
    }
    if (url.includes('api.discogs.com')) {
      return {
        data: { results: [] }
      }
    }
  }

  const { enrichResult } = loadPipeline({
    cacheStore,
    configValues: {
      lastfmApiKey: 'fake-key',
      discogsToken: 'fake-token',
      mockAxios
    }
  })

  const result = await enrichResult({ artistName: 'Single Tag Artist', albums: [] })
  assert.deepEqual(result.tags, ['single-tag'])
  assert.deepEqual(result.genres, ['single-tag'])
})

test('enrichArtistData handles Last.fm and Discogs errors gracefully', async () => {
  const cacheStore = new Map()
  const mockAxios = async (url) => {
    throw new Error('Network error')
  }

  const { enrichResult } = loadPipeline({
    cacheStore,
    configValues: {
      lastfmApiKey: 'fake-key',
      discogsToken: 'fake-token',
      mockAxios
    }
  })

  const result = await enrichResult({ artistName: 'Error Artist', albums: [] })
  // Should return defaults without failing the whole process
  assert.deepEqual(result.tags, [])
  assert.deepEqual(result.genres, [])
  assert.equal(result.popularity.listeners, 0)
})

test('enrichResult handles general errors correctly (e.g. cache failing or mockAxios throwing outside Promise.all)', async () => {
  // To test the catch block around `await enrichArtistData`, we'll make getConfigValue throw.
  const pipelinePath = require.resolve('./pipeline')
  const storePath = require.resolve('../settings/store')
  delete require.cache[pipelinePath]
  require.cache[storePath] = {
    id: storePath,
    filename: storePath,
    loaded: true,
    exports: {
      getConfigValue () { throw new Error('Simulated config error') }
    }
  }

  const pipeline = require('./pipeline')
  const result = await pipeline.enrichResult({ artistName: 'Throws Artist', albums: [] }, true)

  assert.equal(result._enrichmentDebug.error, 'Simulated config error')
  assert.equal(result._enrichmentDebug.cached, false)
})
