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

  delete require.cache[controllerPath]
  delete require.cache[providersPath]
  delete require.cache[cachePath]
  delete require.cache[metricsPath]

  const fakeCache = {
    async get (key) {
      return cacheStore.get(key) || null
    },
    async set (key, value) {
      cacheStore.set(key, value)
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
      artistName: 'Cached Artist',
      foreignArtistId: '',
      providers: [{ name: 'itunes', albumCount: 1 }],
      albums: [{ title: 'Cached Album', id: '1', firstReleaseDate: '2020' }],
      debug: { ranking: true }
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
