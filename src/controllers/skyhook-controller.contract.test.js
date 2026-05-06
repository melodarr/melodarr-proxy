const test = require('node:test')
const assert = require('node:assert/strict')

const {
  SKYHOOK_ARTIST_RESOURCE_KEYS,
  SKYHOOK_ALBUM_REQUIRED_KEYS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_OPTIONAL_ARTIST_KEYS
} = require('../utils/lidarrArtist')

const cache = require('../cache')
const providers = require('../providers')
const rankingEngine = require('../ranking/engine')
const enrichment = require('../enrichment/pipeline')
const musicbrainzProvider = require('../providers/musicbrainz.provider')
const theAudioDbProvider = require('../providers/theaudiodb.provider')
const skyhookController = require('./proxy.controller')

function mockReqRes (query = {}, params = {}) {
  const req = { query, params, headers: {} }
  const res = {
    headers: {},
    statusCode: 200,
    set (key, val) { this.headers[key] = val },
    status (code) { this.statusCode = code; return this },
    json (data) { this.body = data; return this }
  }
  return { req, res }
}

test('Controller - /api/v1/artist/lookup - success shape', async (t) => {
  t.mock.method(cache, 'get', async () => null)
  t.mock.method(cache, 'set', async () => {})
  t.mock.method(cache, 'acquireLock', async () => 'test-lock')
  t.mock.method(cache, 'releaseLock', async () => {})

  t.mock.method(providers, 'aggregateArtist', async (term) => ({
    artistName: term,
    id: 'test-id',
    albums: [],
    providers: [],
    confidence: 100,
    score: 100
  }))
  t.mock.method(rankingEngine, 'rankResults', (input) => ({
    results: input.results,
    debug: {}
  }))
  t.mock.method(enrichment, 'enrichResult', async (result) => result)

  const { req, res } = mockReqRes({ term: 'Radiohead' })
  await skyhookController.handleArtistLookup(req, res)

  assert.equal(res.statusCode, 200)
  assert.ok(Array.isArray(res.body), 'Response should be an array')
  assert.equal(res.body.length, 1)

  const item = res.body[0]

  // Verify it contains exactly the allowed Lidarr properties, no internal fields
  const allowedKeys = [...LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS, ...LIDARR_OPTIONAL_ARTIST_KEYS]

  for (const key of Object.keys(item)) {
    assert.ok(allowedKeys.includes(key), `Extraneous key found in controller response: ${key}`)
  }

  assert.equal(item.providers, undefined, 'Internal field providers should not leak')
  assert.equal(item.partial, undefined, 'Internal field partial should not leak')
  assert.equal(item._generatedAt, undefined, 'Internal field _generatedAt should not leak')
})

test('Controller - /api/v1/artist/{id} - success shape', async (t) => {
  t.mock.method(cache, 'get', async () => null)
  t.mock.method(cache, 'set', async () => {})
  t.mock.method(cache, 'acquireLock', async () => 'test-lock')
  t.mock.method(cache, 'releaseLock', async () => {})

  t.mock.method(musicbrainzProvider, 'lookupArtistById', async (id) => ({ id, artistName: 'Test Artist', albums: [] }))
  t.mock.method(rankingEngine, 'rankResults', (input) => ({
    results: input.results,
    debug: {}
  }))
  t.mock.method(enrichment, 'enrichResult', async (result) => result)
  t.mock.method(theAudioDbProvider, 'searchArtistProfile', async () => null)

  const { req, res } = mockReqRes({}, { foreignArtistId: 'test-id' })
  await skyhookController.handleArtistById(req, res)

  assert.equal(res.statusCode, 200)
  assert.ok(!Array.isArray(res.body), 'Response should be an object')

  const item = res.body
  for (const key of Object.keys(item)) {
    assert.ok(SKYHOOK_ARTIST_RESOURCE_KEYS.includes(key), `Extraneous key found in controller response: ${key}`)
  }
})

test('Controller - /api/v1/album - success shape', async (t) => {
  t.mock.method(cache, 'get', async () => null)
  t.mock.method(cache, 'set', async () => {})
  t.mock.method(cache, 'acquireLock', async () => 'test-lock')
  t.mock.method(cache, 'releaseLock', async () => {})

  t.mock.method(musicbrainzProvider, 'lookupAlbumById', async (id) => ({ id, title: 'Test Album', releases: [] }))

  const { req, res } = mockReqRes({}, { foreignAlbumId: 'test-album' })
  await skyhookController.handleAlbumById(req, res)

  assert.equal(res.statusCode, 200)
  assert.ok(!Array.isArray(res.body), 'Response should be an object')

  const item = res.body
  for (const key of Object.keys(item)) {
    assert.ok(SKYHOOK_ALBUM_REQUIRED_KEYS.includes(key), `Extraneous key found in controller response: ${key}`)
  }
})

test('Controller - handleArtistLookup - error returns empty array instead of internal format', async (t) => {
  t.mock.method(cache, 'get', async () => null)
  t.mock.method(cache, 'set', async () => {})
  t.mock.method(cache, 'acquireLock', async () => 'test-lock')
  t.mock.method(cache, 'releaseLock', async () => {})

  t.mock.method(providers, 'aggregateArtist', async () => { throw new Error('Upstream failed') })

  const { req, res } = mockReqRes({ term: 'Radiohead' })
  await skyhookController.handleArtistLookup(req, res)

  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.body, [], 'Should return empty array on failure, matching Lidarr edge case behavior')
})

test('Controller - /api/v1/release - explicitly returns empty array', async () => {
  const { req, res } = mockReqRes()
  skyhookController.handleReleaseSearch(req, res)
  assert.deepEqual(res.body, [])
})

test('Controller - /api/v1/queue/details - explicitly returns empty array', async () => {
  const { req, res } = mockReqRes()
  skyhookController.handleQueueDetails(req, res)
  assert.deepEqual(res.body, [])
})

test('Controller - /recent/artist - explicitly returns empty array', async () => {
  const { req, res } = mockReqRes()
  skyhookController.handleRecentFeed(req, res)
  assert.deepEqual(res.body, [])
})

test('Controller - /recent/album - explicitly returns empty array', async () => {
  const { req, res } = mockReqRes()
  skyhookController.handleRecentFeed(req, res)
  assert.deepEqual(res.body, [])
})
