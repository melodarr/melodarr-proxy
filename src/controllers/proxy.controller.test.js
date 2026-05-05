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
  const musicbrainzProviderPath = require.resolve('../providers/musicbrainz.provider')
  const theAudioDbProviderPath = require.resolve('../providers/theaudiodb.provider')
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
  delete require.cache[musicbrainzProviderPath]
  delete require.cache[theAudioDbProviderPath]
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

  const lockCalls = []
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
    async acquireLock (key, ttlMs) {
      lockCalls.push({ method: 'acquireLock', key, ttlMs })
      return cacheStore.get('_lock_fail') ? false : 'test-lock'
    },
    async releaseLock (key, token) {
      lockCalls.push({ method: 'releaseLock', key, token })
      return true
    }
  }

  const noopMetrics = {
    recordArtistLookup () {},
    recordCache () {},
    recordEnrichment () {},
    recordRanking () {},
    recordLockWait () {}
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

  require.cache[musicbrainzProviderPath] = {
    id: musicbrainzProviderPath,
    filename: musicbrainzProviderPath,
    loaded: true,
    exports: {
      lookupArtistById: arguments[0]?.lookupArtistById || (async () => {
        throw new Error('lookupArtistById stub was not configured')
      })
    }
  }

  require.cache[theAudioDbProviderPath] = {
    id: theAudioDbProviderPath,
    filename: theAudioDbProviderPath,
    loaded: true,
    exports: {
      searchArtistProfile: arguments[0]?.searchArtistProfile || (async () => {
        throw new Error('searchArtistProfile stub was not configured')
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
      findSongAlbums: arguments[0]?.findSongAlbums || (async () => ({})),
      getEnabledProviders: arguments[0]?.getEnabledProviders || (() => new Set(['musicbrainz', 'itunes', 'theaudiodb', 'discogs']))
    }
  }

  return {
    cacheStore,
    lockCalls,
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
  const { controller, cacheStore, lockCalls } = loadController({
    aggregateArtist: async (term) => {
      upstreamCalls++
      return {
        artistName: term.toUpperCase(),
        id: 'mock-mbid',
        foreignArtistId: 'mock-mbid',
        oldIds: ['old-mock-mbid'],
        aliases: ['Provider Alias'],
        artistAliases: ['Provider Alias'],
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
  assert.equal(res.body[0].artistName, 'TEST ARTIST')
  assert.equal(res.body[0].id, 'mock-mbid')
  assert.deepEqual(res.body[0].oldIds, ['old-mock-mbid'])
  assert.deepEqual(res.body[0].aliases, ['Provider Alias'])
  assert.deepEqual(res.body[0].artistAliases, ['Provider Alias'])
  assert.equal(res.body[0].albums[0].title, 'First Album')
  assert.equal(res.body[0].albums[0].id, 'rg-1')
  // v0.3.36: year-only is now padded to ISO 8601 (Skyhook-compatible).
  assert.equal(res.body[0].albums[0].firstReleaseDate, '2001-01-01T00:00:00Z')
  assert.equal(res.body[0].albums[0].images[0].url, 'https://example.test/cover.jpg')
  assert.equal(res.body[0].albums[0].remoteCover, 'https://example.test/cover.jpg')
  assert.equal(res.body[0].partial, false)
  assert.ok(cacheStore.has('artist:test artist'))
  assert.deepEqual(lockCalls.at(-1), {
    method: 'releaseLock',
    key: 'lock:artist:test artist',
    token: 'test-lock'
  })
})

test('artist lookup preserves ISO 8601 firstReleaseDate from provider (v0.3.36)', async () => {
  // Regression: pre-v0.3.36 we truncated provider dates to year-only by going
  // through `String(album.year)`. Lidarr's date parser rejects "1997". This
  // test asserts iTunes-style full ISO timestamps flow through unchanged.
  const { controller } = loadController({
    aggregateArtist: async (term) => ({
      artistName: term,
      id: 'mock-mbid',
      foreignArtistId: 'mock-mbid',
      albums: [{
        name: 'OK Computer',
        year: 1997,
        releaseDate: '1997-05-21T07:00:00Z',
        provider: 'itunes',
        ids: { itunesCollectionId: '1097861387' }
      }],
      providers: [{ name: 'itunes', score: 1, albumCount: 1 }],
      providerErrors: [],
      partial: false,
      warning: null,
      providerCount: 1,
      confidence: 1
    })
  })
  const res = makeResponse()
  await controller.handleArtistLookup({ query: { term: 'Radiohead' } }, res)

  assert.equal(res.statusCode, 200)
  const date = res.body[0].albums[0].firstReleaseDate
  assert.equal(date, '1997-05-21T07:00:00Z', 'iTunes ISO date must pass through unchanged')
})

test('artist lookup returns cached response without debug data by default', async () => {
  const cacheStore = new Map([
    ['artist:cached artist', {
      data: {
        artistName: 'Cached Artist',
        id: 'mock-foreign-id',
        foreignArtistId: 'mock-foreign-id',
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
  assert.equal(res.body[0].artistName, 'Cached Artist')
  assert.deepEqual(res.body[0].aliases, [])
  assert.deepEqual(res.body[0].links, [])
  assert.equal(res.body[0].debug, undefined)
})

test('artist lookup normalizes foreignArtistId from id for legacy cached payloads', async () => {
  // Older cached entries may only have `id` and lack `foreignArtistId`.
  // withArtistLookupDefaults should backfill foreignArtistId from id so
  // isValidArtist accepts the entry rather than returning [].
  const cacheStore = new Map([
    ['artist:legacy artist', {
      data: {
        artistName: 'Legacy Artist',
        id: 'legacy-id',
        // no foreignArtistId — simulates a pre-fix cache entry
        providers: [{ name: 'musicbrainz', albumCount: 2 }],
        albums: [{ title: 'Old Album', id: '1' }]
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

  await controller.handleArtistLookup({ query: { term: 'legacy artist' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'HIT')
  assert.equal(res.body[0].artistName, 'Legacy Artist')
  assert.equal(res.body[0].foreignArtistId, 'legacy-id')
})

test('artist lookup returns partial error response when all providers fail', async () => {
  const { controller, lockCalls } = loadController({
    aggregateArtist: async () => {
      throw new Error('All metadata providers failed')
    }
  })
  const res = makeResponse()

  await controller.handleArtistLookup({ query: { term: 'Broken Artist' } }, res)

  assert.equal(res.statusCode, 502)
  assert.equal(res.body[0].artistName, 'Broken Artist')
  assert.equal(res.body[0].id, '')
  assert.deepEqual(res.body[0].aliases, [])
  assert.deepEqual(res.body[0].albums, [])
  assert.equal(res.body[0].partial, true)
  assert.equal(res.body[0].warning, 'All metadata providers failed')
  assert.deepEqual(lockCalls.at(-1), {
    method: 'releaseLock',
    key: 'lock:artist:broken artist',
    token: 'test-lock'
  })
})

test('artist by id returns full artist payload for Lidarr path-segment lookup', async () => {
  const { controller } = loadController({
    lookupArtistById: async (id) => ({
      artistName: 'Radiohead',
      id,
      disambiguation: '',
      overview: '',
      aliases: ['On a Friday'],
      artistAliases: ['On a Friday'],
      images: [],
      albums: [{
        name: 'OK Computer',
        releaseDate: '1997-05-21',
        imageUrl: 'https://example.test/ok.jpg',
        provider: 'musicbrainz',
        ids: { musicbrainzReleaseGroupId: 'rg-ok' }
      }],
      providers: [{ name: 'musicbrainz', score: 100, albumCount: 1 }],
      providerErrors: [],
      partial: false,
      warning: null,
      providerCount: 1,
      confidence: 100
    })
  })
  const res = makeResponse()

  await controller.handleArtistById({ params: { foreignArtistId: 'a74b1b7f' }, query: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body.artistName, 'Radiohead')
  assert.equal(res.body.id, 'a74b1b7f')
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'foreignArtistId'), false)
  assert.equal(res.body.status, 'continuing')
  assert.deepEqual(res.body.oldIds, [])
  assert.equal(Object.prototype.hasOwnProperty.call(res.body, 'aliases'), false)
  assert.deepEqual(res.body.artistAliases, ['On a Friday'])
  assert.deepEqual(res.body.links, [])
  assert.equal(res.body.albums[0].id, 'rg-ok')
  assert.equal(res.body.albums[0].releaseDate, '1997-05-21T00:00:00Z')
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.albums[0], 'firstReleaseDate'), false)
})

test('artist by id enriches missing artist images and preserves MusicBrainz album ratings before returning SkyHook metadata', async () => {
  const { controller } = loadController({
    lookupArtistById: async (id) => ({
      artistName: 'Akon',
      id,
      disambiguation: '',
      overview: '',
      aliases: [],
      artistAliases: [],
      images: [],
      albums: [{
        name: 'Freedom',
        releaseDate: '2008-11-30',
        imageUrl: '',
        provider: 'musicbrainz',
        ids: { musicbrainzReleaseGroupId: 'rg-freedom' },
        rating: { count: 42, value: 4.5 },
        ratings: { votes: 42, value: 4.5 }
      }],
      providers: [{ name: 'musicbrainz', score: 100, albumCount: 1 }],
      providerErrors: [],
      partial: false,
      warning: null,
      providerCount: 1,
      confidence: 100
    }),
    searchArtistProfile: async () => ({
      artistName: 'Akon',
      images: [
        { coverType: 'poster', url: 'https://example.test/akon-thumb.jpg', remoteUrl: 'https://example.test/akon-thumb.jpg' },
        { coverType: 'fanart', url: 'https://example.test/akon-fanart.jpg', remoteUrl: 'https://example.test/akon-fanart.jpg' },
        { coverType: 'clearlogo', url: 'https://example.test/akon-logo.png', remoteUrl: 'https://example.test/akon-logo.png' }
      ]
    })
  })
  const res = makeResponse()

  await controller.handleArtistById({ params: { foreignArtistId: 'akon-id' }, query: {} }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.images.map(image => image.coverType), ['poster', 'fanart', 'clearlogo'])
  assert.deepEqual(res.body.albums[0].rating, { count: 42, value: 4.5 })
})

test('recent feed returns empty array for unsupported update feed', async () => {
  const { controller } = loadController()
  const res = makeResponse()

  await controller.handleRecentFeed({}, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [])
})

test('release search returns empty candidate list when no indexer backend is configured', async () => {
  const { controller } = loadController()
  const res = makeResponse()

  await controller.handleReleaseSearch({ query: { artistId: '700' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [])
})

test('queue details returns empty queue list when no runtime queue backend is configured', async () => {
  const { controller } = loadController()
  const res = makeResponse()

  await controller.handleQueueDetails({ query: { artistId: '700' } }, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [])
})

// handleSearch tests
test('handleSearch requires a query parameter', async () => {
  const { controller } = loadController()
  const res = makeResponse()
  await controller.handleSearch({ query: {} }, res)
  assert.equal(res.statusCode, 400)
  assert.equal(res.body.error, 'Missing query parameter "q" or "query"')
})

test('handleSearch returns cached response in source-derived SkyHook type=all shape', async () => {
  const cacheStore = new Map([
    ['search:test song', {
      data: [{ artistName: 'Cached Artist', type: 'artist', source: 'musicbrainz', ids: { musicbrainzArtistId: 'mb-cache-1' } }],
      generatedAt: '2026-04-28T00:00:00.000Z'
    }]
  ])
  const { controller } = loadController({ cacheStore })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: ' Test Song ' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache-Generated-At'], '2026-04-28T00:00:00.000Z')
  // SkyHook SearchForNewEntity contract: each item is EntityResource.
  assert.ok(Array.isArray(res.body))
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['album', 'artist', 'score'])
  assert.ok(res.body[0].artist)
  assert.equal(res.body[0].album, null)
  assert.equal(res.body[0].artist.id, 'mb-cache-1')
})

test('handleSearch fetches upstream, caches, and returns source-derived SkyHook candidates', async () => {
  let discoverCalled = false
  const { controller, cacheStore, lockCalls } = loadController({
    discoverArtists: async () => {
      discoverCalled = true
      return [{
        artistName: 'Test Artist',
        type: 'artist',
        source: 'musicbrainz',
        id: 'mb-fresh-1',
        ids: { musicbrainzArtistId: 'mb-fresh-1' }
      }]
    }
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'Test Song' } }, res)
  assert.equal(res.statusCode, 200)
  assert.ok(discoverCalled)
  // Response is the SkyHook EntityResource array Lidarr expects for type=all.
  assert.ok(Array.isArray(res.body))
  assert.deepEqual(Object.keys(res.body[0]).sort(), ['album', 'artist', 'score'])
  assert.ok(res.body[0].artist, 'must populate EntityResource.artist')
  assert.equal(res.body[0].album, null)
  assert.equal(res.body[0].artist.artistName, 'Test Artist')
  assert.equal(res.body[0].artist.id, 'mb-fresh-1')
  // Cache stores the raw candidates (transformation happens at response time).
  assert.ok(cacheStore.has('search:test song'))
  assert.deepEqual(lockCalls.at(-1), {
    method: 'releaseLock',
    key: 'lock:search:test song',
    token: 'test-lock'
  })
})

test('handleSearch with type=artist returns ArtistResource[]', async () => {
  const { controller } = loadController({
    discoverArtists: async () => [{
      artistName: 'Test Artist',
      type: 'artist',
      source: 'musicbrainz',
      id: 'mb-fresh-1',
      ids: { musicbrainzArtistId: 'mb-fresh-1' }
    }]
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'Test Artist', type: 'artist' } }, res)

  assert.equal(res.statusCode, 200)
  assert.equal(res.body[0].id, 'mb-fresh-1')
  assert.equal(res.body[0].artistName, 'Test Artist')
  assert.equal(Object.prototype.hasOwnProperty.call(res.body[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(res.body[0], 'album'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(res.body[0], 'score'), false)
})

test('handleSearch handles upstream error', async () => {
  const { controller, lockCalls } = loadController({
    discoverArtists: async () => { throw new Error('Upstream failed') }
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'fail' }, headers: {} }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Failed to fetch from upstream API')
  assert.equal(res.body.details.message, 'Upstream failed')
  assert.deepEqual(lockCalls.at(-1), {
    method: 'releaseLock',
    key: 'lock:search:fail',
    token: 'test-lock'
  })
})

test('handleSearch error body MUST NOT leak axios err.config (URL, headers, params, User-Agent)', async () => {
  // v0.3.35 regression: prior versions echoed the full axios err.config back
  // to the client, including the User-Agent header which carries the
  // operator's contact email. The client-facing body must contain only
  // { message, code } in details.
  const { controller } = loadController({
    discoverArtists: async () => {
      const err = new Error('Client network socket disconnected before secure TLS connection was established')
      err.code = 'ECONNRESET'
      err.config = {
        url: 'https://musicbrainz.org/ws/2/artist',
        method: 'get',
        headers: {
          'User-Agent': 'Lunar Bridge 233/latest (operator@example.com)',
          Accept: 'application/json'
        },
        params: { fmt: 'json', query: 'artist:"junkyards"', limit: 10 }
      }
      throw err
    }
  })
  const res = makeResponse()
  await controller.handleSearch({ query: { q: 'junkyards' }, headers: { 'user-agent': 'lidarr/2.3' } }, res)

  assert.equal(res.statusCode, 502)
  const serialized = JSON.stringify(res.body)
  assert.ok(!serialized.includes('musicbrainz.org'), 'must not leak upstream URL')
  assert.ok(!serialized.includes('operator@example.com'), 'must not leak operator email from User-Agent')
  assert.ok(!serialized.includes('Lunar Bridge'), 'must not leak User-Agent header')
  assert.ok(!serialized.includes('junkyards"'), 'must not leak upstream query params')
  assert.ok(!serialized.includes('"fmt"'), 'must not leak upstream params')
  assert.equal(res.body.details.message, 'Client network socket disconnected before secure TLS connection was established')
  assert.equal(res.body.details.code, 'ECONNRESET')
  assert.equal(res.body.details.config, undefined)
  assert.equal(res.body.details.headers, undefined)
  assert.equal(res.body.details.url, undefined)
})

test('handleArtistDiscover error body MUST NOT leak axios err.config', async () => {
  const { controller } = loadController({
    discoverArtists: async () => {
      const err = new Error('TLS reset')
      err.code = 'ECONNRESET'
      err.config = {
        url: 'https://musicbrainz.org/ws/2/artist',
        headers: { 'User-Agent': 'Lunar Bridge 233/latest (operator@example.com)' },
        params: { query: 'foo' }
      }
      err.response = { status: 502, headers: { 'x-leak': 'should-not-appear' } }
      throw err
    }
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'foo' } }, res)

  const serialized = JSON.stringify(res.body)
  assert.ok(!serialized.includes('musicbrainz.org'), 'must not leak upstream URL')
  assert.ok(!serialized.includes('operator@example.com'), 'must not leak operator email')
  assert.ok(!serialized.includes('Lunar Bridge'), 'must not leak User-Agent')
  assert.ok(!serialized.includes('x-leak'), 'must not leak upstream response headers')
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
  assert.equal(res.body[0].warning, 'Upstream request failed during coalescing (lock timeout)')
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
        // v0.3.42: cached payload must include artistName so the
        // validateArtist filter doesn't drop it as malformed.
        // We also now require foreignArtistId.
        return { data: { artistName: 'Coalesce', foreignArtistId: 'mock-id', albums: [] }, generatedAt: '2026-04-28' }
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
        // v0.3.42: include artistName for validateArtist to pass.
        // Also require foreignArtistId.
        return { data: { artistName: 'Coalesce', foreignArtistId: 'mock-id', albums: [], debug: true }, generatedAt: '2026-04-28' }
      }
    }
    return originalGet.call(cacheStore, key)
  }

  await controller.handleArtistLookup({ query: { term: 'coalesce', debug: 'true' } }, res)
  assert.equal(res.statusCode, 200)
  assert.equal(res.headers['X-Cache'], 'HIT')
  assert.equal(res.body[0].debug, true)
})

// handleArtistDiscover tests
test('handleArtistDiscover requires query', async () => {
  const { controller } = loadController()
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: {} }, res)
  assert.equal(res.statusCode, 400)
})

test('handleArtistDiscover returns source-derived search candidates inside envelope', async () => {
  const { controller } = loadController({
    discoverArtists: async ({ query, type }) => [{
      artistName: query,
      type: type || 'artist',
      source: 'musicbrainz',
      id: 'mb-discover-1',
      ids: { musicbrainzArtistId: 'mb-discover-1' }
    }]
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'test' } }, res)
  assert.equal(res.statusCode, 200)
  // Envelope shape is preserved (query/type/providers/partial/warning) but
  // type=artist candidates follow SkyHook ArtistResource[].
  assert.equal(res.body.query, 'test')
  assert.equal(res.body.candidates[0].artistName, 'test')
  assert.equal(res.body.candidates[0].id, 'mb-discover-1')
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.candidates[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(res.body.candidates[0], 'album'), false)
})

test('handleArtistDiscover handles errors', async () => {
  const { controller } = loadController({
    discoverArtists: async () => {
      const err = new Error('Discovery timeout')
      err.code = 'ERR'
      throw err
    }
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'test' } }, res)
  assert.equal(res.statusCode, 502)
  assert.equal(res.body.error, 'Discovery failed')
  assert.equal(res.body.details.message, 'Discovery timeout')
  assert.equal(res.body.details.code, 'ERR')
  assert.equal(res.body.partial, true)
  // Provider list is surfaced even on failure so callers know what was tried.
  assert.ok(Array.isArray(res.body.providers))
})

test('handleArtistDiscover degrades to 200 with empty candidates when discovery returns []', async () => {
  // v0.3.35: artist-discovery returns [] on all-providers-failed (no throw),
  // so the route must not 502 — it returns valid partial-shaped JSON.
  const { controller } = loadController({
    discoverArtists: async () => []
  })
  const res = makeResponse()
  await controller.handleArtistDiscover({ query: { q: 'nobody' } }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body.candidates, [])
  assert.equal(res.body.partial, true)
  assert.ok(res.body.warning)
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
