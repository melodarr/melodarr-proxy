const assert = require('node:assert/strict')
const test = require('node:test')

function makeResponse () {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    set (key, value) {
      this.headers[key] = value
      return this
    },
    status (statusCode) {
      this.statusCode = statusCode
      return this
    },
    json (body) {
      this.body = body
      return this
    }
  }
}

function loadController ({ aggregateArtist, cacheStore = new Map() } = {}) {
  const controllerPath = require.resolve('./proxy.controller')
  const providersPath = require.resolve('../providers')
  const cachePath = require.resolve('../cache')
  const metricsPath = require.resolve('../metrics')
  const tracerPath = require.resolve('../tracer')
  const rankingPath = require.resolve('../ranking/engine')
  const enrichmentPath = require.resolve('../enrichment/pipeline')
  const settingsPath = require.resolve('../settings/store')
  const snapshotsPath = require.resolve('../snapshots')
  const loggerPath = require.resolve('../utils/logger')
  const upstreamPath = require.resolve('../services/upstream.service')
  const artistDiscoveryPath = require.resolve('../providers/artist-discovery')

  delete require.cache[controllerPath]
  delete require.cache[providersPath]
  delete require.cache[cachePath]
  delete require.cache[metricsPath]
  delete require.cache[tracerPath]
  delete require.cache[rankingPath]
  delete require.cache[enrichmentPath]
  delete require.cache[settingsPath]
  delete require.cache[snapshotsPath]
  delete require.cache[loggerPath]
  delete require.cache[upstreamPath]
  delete require.cache[artistDiscoveryPath]

  const fakeCache = {
    async get (key) {
      return cacheStore.get(key) || null
    },
    async set (key, value, ttlSeconds = 86400) {
      cacheStore.set(key, {
        data: value,
        generatedAt: new Date('2026-04-28T00:00:00.000Z').toISOString(),
        ttlSeconds
      })
    },
    async acquireLock () {
      return cacheStore.get('_lock_fail') ? false : 'test-lock'
    },
    async releaseLock () {
      return true
    }
  }

  const noopMetrics = {
    recordArtistLookup () {},
    recordCache () {},
    recordEnrichment () {},
    recordRanking () {}
  }

  require.cache[providersPath] = {
    id: providersPath,
    filename: providersPath,
    loaded: true,
    exports: {
      aggregateArtist: aggregateArtist || (async () => {
        throw new Error('aggregateArtist stub was not configured')
      })
    }
  }

  require.cache[cachePath] = {
    id: cachePath,
    filename: cachePath,
    loaded: true,
    exports: fakeCache
  }

  require.cache[metricsPath] = {
    id: metricsPath,
    filename: metricsPath,
    loaded: true,
    exports: noopMetrics
  }

  require.cache[tracerPath] = {
    id: tracerPath,
    filename: tracerPath,
    loaded: true,
    exports: {
      createTrace: (query) => ({ id: 'trace-1', query, steps: [], startTime: Date.now() }),
      addStep () {},
      async finalizeTrace () {}
    }
  }

  require.cache[rankingPath] = {
    id: rankingPath,
    filename: rankingPath,
    loaded: true,
    exports: {
      rankResults: (input) => ({
        results: input.results.map((result) => ({ ...result, score: 100, confidence: result.confidence || 1 })),
        debug: { strategy: 'test' }
      })
    }
  }

  require.cache[enrichmentPath] = {
    id: enrichmentPath,
    filename: enrichmentPath,
    loaded: true,
    exports: {
      enrichResult: async (result) => result
    }
  }

  require.cache[settingsPath] = {
    id: settingsPath,
    filename: settingsPath,
    loaded: true,
    exports: {
      getConfigValue: () => 86400
    }
  }

  require.cache[snapshotsPath] = {
    id: snapshotsPath,
    filename: snapshotsPath,
    loaded: true,
    exports: {
      async saveSnapshot () {}
    }
  }

  require.cache[loggerPath] = {
    id: loggerPath,
    filename: loggerPath,
    loaded: true,
    exports: {
      error () {},
      warn () {},
      info () {}
    }
  }

  require.cache[upstreamPath] = {
    id: upstreamPath,
    filename: upstreamPath,
    loaded: true,
    exports: {
      search: arguments[0]?.search || (async () => {
        throw new Error('search stub was not configured')
      })
    }
  }

  require.cache[artistDiscoveryPath] = {
    id: artistDiscoveryPath,
    filename: artistDiscoveryPath,
    loaded: true,
    exports: {
      discoverArtists: arguments[0]?.discoverArtists || (async () => []),
      findSongAlbums: arguments[0]?.findSongAlbums || (async () => ({}))
    }
  }

  return {
    cacheStore,
    controller: require('./proxy.controller')
  }
}

test('artist lookup requires a term', async () => {
  const { controller } = loadController()
  const res = makeResponse()

  await controller.handleArtistLookup({ query: {} }, res)

  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Missing required query parameter: term')
})

test('artist lookup normalizes provider data and caches the response', async () => {
  let upstreamCalls = 0
  const { controller, cacheStore } = loadController({
    aggregateArtist: async (term) => {
      upstreamCalls++
      return {
        artistName: term.toUpperCase(),
        albums: [
          {
            name: 'First Album',
            year: 2001,
            imageUrl: 'https://example.test/cover.jpg',
            provider: 'musicbrainz',
            ids: { musicbrainzReleaseGroupId: 'rg-1' }
          }
        ],
        providers: [{ name: 'musicbrainz', score: 0.9, albumCount: 1 }],
        providerErrors: [],
        partial: false,
        warning: null,
        providerCount: 1,
        confidence: 0.9
      }
    }
  })
  const res = makeResponse()

  await controller.handleArtistLookup({ query: { term: 'test artist' } }, res)

  assert.equal(upstreamCalls, 1)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'MISS')
  assert.equal(res.headers['X-Upstream-Calls'], '1')
  assert.equal(res.headers['X-Providers'], 'musicbrainz')
  assert.equal(res.body.artistName, 'TEST ARTIST')
  assert.equal(res.body.foreignArtistId, '')
  assert.equal(res.body.albums[0].title, 'First Album')
  assert.equal(res.body.albums[0].id, 'rg-1')
  assert.equal(res.body.albums[0].firstReleaseDate, '2001')
  assert.equal(res.body.albums[0].coverUrl, 'https://example.test/cover.jpg')
  assert.equal(res.body.partial, false)
  assert.ok(cacheStore.has('artist:test artist'))
})

test('artist lookup returns cached response without debug data by default', async () => {
  const cacheStore = new Map([
    ['artist:cached artist', {
      data: {
        artistName: 'Cached Artist',
        foreignArtistId: '',
        providers: [{ name: 'itunes', albumCount: 1 }],
        albums: [{ title: 'Cached Album', id: '1', firstReleaseDate: '2020' }],
        debug: { ranking: true }
      },
      generatedAt: '2026-04-28T00:00:00.000Z'
    }]
  ])
  const { controller } = loadController({
    cacheStore,
    aggregateArtist: async () => {
      throw new Error('cache hit should not call upstream')
    }
  })
  const res = makeResponse()

  await controller.handleArtistLookup({ query: { term: ' cached   artist ' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'HIT')
  assert.equal(res.headers['X-Providers'], 'itunes')
  assert.equal(res.body.artistName, 'Cached Artist')
  assert.equal(res.body.debug, undefined)
})

test('artist lookup returns partial error response when all providers fail', async () => {
  const { controller } = loadController({
    aggregateArtist: async () => {
      throw new Error('All metadata providers failed')
    }
  })
  const res = makeResponse()

  await controller.handleArtistLookup({ query: { term: 'Broken Artist' } }, res)

  assert.equal(res.statusCode, 502)
  assert.equal(res.body.artistName, 'Broken Artist')
  assert.equal(res.body.foreignArtistId, '')
  assert.deepEqual(res.body.albums, [])
  assert.equal(res.body.partial, true)
  assert.equal(res.body.warning, 'All metadata providers failed')
})

// handleSearch tests
test('handleSearch requires a query parameter', async () => {
  const { controller } = loadController()
  const res = makeResponse()
  await controller.handleSearch({ query: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Missing query parameter "q" or "query"')
})

test('handleSearch returns cached response', async () => {
  const cacheStore = new Map([
    ['search:test song', {
      data: { albums: [] },
      generatedAt: '2026-04-28T00:00:00.000Z'
    }]
  ])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: ' Test Song ' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache-Generated-At'], '2026-04-28T00:00:00.000Z')
})

test('handleSearch fetches upstream, caches, and returns', async () => {
  let discoverCalled = false
  const { controller, cacheStore } = loadController({
    discoverArtists: async () => {
      discoverCalled = true
      return { albums: [{ provider: 'test', name: 'Hit' }] }
    }
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'Test Song' } }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(discoverCalled)
  assert.equal(res.body.albums[0].name, 'Hit')
  assert.ok(cacheStore.has('search:test song'))
})

test('handleSearch handles upstream error', async () => {
  const { controller } = loadController({
    discoverArtists: async () => { throw new Error('Upstream failed') }
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'fail' }, headers: {} }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Failed to fetch from upstream API')
  assert.equal(res.body.details.message, 'Upstream failed')
})

test('handleSearch handles lock timeout', async () => {
  const cacheStore = new Map([['_lock_fail', true]])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()
  const originalNow = Date.now
  let calls = 0
  Date.now = () => originalNow() + (calls++ * 5000)
  await controller.handleSearch({ query: { q: 'locked' } }, res)
  Date.now = originalNow
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Failed to acquire distributed lock for upstream fetch')
})

test('handleSearch coalescing returns cached data', async () => {
  const cacheStore = new Map([['_lock_fail', true]])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()

  const originalGet = cacheStore.get
  let attempts = 0
  cacheStore.get = function (key) {
    if (key === 'search:coalesce') {
      attempts++
      if (attempts > 1) {
        return { data: { albums: [] }, generatedAt: '2026-04-28' }
      }
    }
    return originalGet.call(cacheStore, key)
  }

  await controller.handleSearch({ query: { q: 'coalesce' } }, res)
  assert.equal(res.statusCode, 200)
})

// handleArtistLookup branches
test('artist lookup handles lock timeout', async () => {
  const cacheStore = new Map([['_lock_fail', true]])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()
  const originalNow = Date.now
  let calls = 0
  Date.now = () => originalNow() + (calls++ * 5000)
  await controller.handleArtistLookup({ query: { term: 'locked' } }, res)
  Date.now = originalNow
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.warning, 'Upstream request failed during coalescing (lock timeout)')
})

test('artist lookup coalescing returns cached data', async () => {
  const cacheStore = new Map([['_lock_fail', true]])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()

  const originalGet = cacheStore.get
  let attempts = 0
  cacheStore.get = function (key) {
    if (key === 'artist:coalesce') {
      attempts++
      if (attempts > 1) {
        return { data: { albums: [] }, generatedAt: '2026-04-28' }
      }
    }
    return originalGet.call(cacheStore, key)
  }

  await controller.handleArtistLookup({ query: { term: 'coalesce' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'HIT')
})

test('artist lookup coalescing returns cached data with debug', async () => {
  const cacheStore = new Map([['_lock_fail', true]])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()

  const originalGet = cacheStore.get
  let attempts = 0
  cacheStore.get = function (key) {
    if (key === 'artist:coalesce') {
      attempts++
      if (attempts > 1) {
        return { data: { albums: [], debug: true }, generatedAt: '2026-04-28' }
      }
    }
    return originalGet.call(cacheStore, key)
  }

  await controller.handleArtistLookup({ query: { term: 'coalesce', debug: 'true' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'HIT')
  assert.equal(res.body.debug, true)
})

// handleArtistDiscover tests
test('handleArtistDiscover requires query', async () => {
  const { controller } = loadController()
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('handleArtistDiscover returns candidates', async () => {
  const { controller } = loadController({
    discoverArtists: async ({ query, type }) => [{ id: 1, name: query, type }]
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'test' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.candidates[0].name, 'test')
})

test('handleArtistDiscover handles errors', async () => {
  const { controller } = loadController({
    discoverArtists: async () => {
      const err = new Error('Discovery failed')
      err.code = 'ERR'
      err.response = { status: 404 }
      throw err
    }
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'test' } }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Discovery failed')
  assert.equal(res.body.details.status, 404)
})

// handleSongAlbums tests
test('handleSongAlbums requires artist and song', async () => {
  const { controller } = loadController()
  const res = makeResponse()
  await controller.handleSongAlbums({ query: { artist: 'a' } }, res)
  assert.equal(res.statusCode, 400)
})

test('handleSongAlbums returns albums', async () => {
  const { controller } = loadController({
    findSongAlbums: async ({ artist, song }) => ({ source: 'test', albums: [] })
  })
  const res = makeResponse()
  await controller.handleSongAlbums({ query: { artist: 'a', song: 's' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.source, 'test')
})

test('handleSongAlbums handles errors', async () => {
  const { controller } = loadController({
    findSongAlbums: async () => { throw new Error('Albums failed') }
  })
  const res = makeResponse()
  await controller.handleSongAlbums({ query: { artist: 'a', song: 's' } }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Albums failed')
})
