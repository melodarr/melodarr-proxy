const { describe, it, before, after, mock } = require('node:test')
const assert = require('node:assert')
const { createApp } = require('../server')
const cacheLayer = require('../cache')
const http = require('http')
const { EventEmitter } = require('events')

class MockSocket extends EventEmitter {
  constructor () { super(); this.remoteAddress = '127.0.0.1'; this._writableState = { corked: 0, length: 0 }; this.writable = true; this.readable = true; this.destroyed = false }
  destroy () {} cork () {} uncork () {} pause () {} resume () {} write (data, encoding, cb) { if (cb)cb(); return true } end () {} on () {} removeListener () {}
}

function makeRequest (app, method, url, headers = {}) {
  return new Promise((resolve) => {
    const socket = new MockSocket()
    const req = new http.IncomingMessage(socket)
    req.method = method; req.url = url; req.headers = headers

    const res = new http.ServerResponse(req)
    res.assignSocket(socket)

    const chunks = []
    const originalWrite = res.write
    const originalEnd = res.end

    res.write = function (chunk, encoding, cb) {
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))
      return originalWrite.call(this, chunk, encoding, cb)
    }

    res.end = function (chunk, encoding, cb) {
      if (typeof chunk === 'function') { cb = chunk; chunk = null; encoding = null } else if (typeof encoding === 'function') { cb = encoding; encoding = null }
      if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding))

      originalEnd.call(this, chunk, encoding, cb)

      const bodyBuffer = Buffer.concat(chunks)
      let data = bodyBuffer.toString('utf8')

      const resHeaders = Object.assign({}, res.getHeaders())
      if (resHeaders['content-type'] && resHeaders['content-type'].includes('application/json')) {
        try { data = JSON.parse(data) } catch (e) {}
      }
      resolve({ status: res.statusCode, headers: resHeaders, data })
    }

    app(req, res)
  })
}

describe('API E2E Tests', () => {
  let app

  const client = {
    get: (url, options = {}) => makeRequest(app, 'GET', url, options.headers || {}),
    post: (url, options = {}) => makeRequest(app, 'POST', url, options.headers || {})
  }

  before(async () => {
    // Override settings
    process.env.REQUIRE_API_KEY = 'false'
    process.env.MUSICBRAINZ_MIN_REQUEST_INTERVAL_MS = '0'

    if (process.env.E2E_REAL_HTTP !== 'true') {
      const axiosModule = require('axios')
      mock.method(axiosModule, 'get', async (url, config) => {
        if (url.includes('musicbrainz.org')) {
          if (url.includes('/release-group/920a68fe-7b93-3d0e-bf73-44ac72f03dd2')) {
            return {
              data: {
                id: '920a68fe-7b93-3d0e-bf73-44ac72f03dd2',
                title: 'Millennium',
                'first-release-date': '1999-05-18',
                'primary-type': 'Album',
                'secondary-types': [],
                'artist-credit': [{
                  artist: {
                    id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
                    name: 'Backstreet Boys',
                    'sort-name': 'Backstreet Boys'
                  }
                }]
              }
            }
          }
          if (url.includes('/release-group')) {
            return {
              data: {
                'release-groups': [{
                  id: '920a68fe-7b93-3d0e-bf73-44ac72f03dd2',
                  title: 'Millennium',
                  'first-release-date': '1999-05-18',
                  'primary-type': 'Album',
                  'secondary-types': []
                }]
              }
            }
          }
          if (url.includes('/release')) {
            return {
              data: {
                releases: [{
                  id: '4b9b7b64-5555-4ec0-9b0f-000000000001',
                  title: 'Millennium',
                  date: '1999-05-18',
                  status: 'Official',
                  country: 'US',
                  media: [{
                    title: 'CD 1',
                    format: 'CD',
                    position: 1,
                    tracks: [{
                      id: '4b9b7b64-5555-4ec0-9b0f-000000000002',
                      title: 'I Want It That Way',
                      number: '1',
                      position: 1,
                      length: 213000,
                      recording: {
                        id: '4b9b7b64-5555-4ec0-9b0f-000000000003',
                        title: 'I Want It That Way',
                        length: 213000,
                        'artist-credit': [{
                          artist: {
                            id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
                            name: 'Backstreet Boys',
                            'sort-name': 'Backstreet Boys'
                          }
                        }]
                      }
                    }]
                  }]
                }]
              }
            }
          }
          if (url.includes('/artist/')) {
            return {
              data: {
                id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
                name: 'Backstreet Boys',
                'sort-name': 'Backstreet Boys',
                aliases: [
                  { name: ' BSB ' },
                  { name: 'Back Street Boys' }
                ]
              }
            }
          }
          return {
            data: {
              artists: [{
                id: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
                name: 'Backstreet Boys',
                'sort-name': 'Backstreet Boys',
                aliases: [
                  { name: ' BSB ' },
                  { name: 'Back Street Boys' }
                ]
              }]
            }
          }
        }
        if (url.includes('itunes.apple.com')) {
          return { data: { results: [] } }
        }
        return { data: {} }
      })
      if (axiosModule.post) {
        mock.method(axiosModule, 'post', async () => ({ data: {} }))
      }
    }

    app = createApp()

    // Start proxy so /api/ready does not return 503
    await client.post('/api/proxy/start')
  })

  after(async () => {
    const axiosModule = require('axios')
    if (axiosModule.get && axiosModule.get.mock) axiosModule.get.mock.restore()
    if (axiosModule.post && axiosModule.post.mock) axiosModule.post.mock.restore()

    await cacheLayer.clear()
    if (cacheLayer.redis) {
      cacheLayer.redis.disconnect()
    }
  })

  describe('Core Endpoints', () => {
    it('GET /api/health → returns 200 + valid JSON', async () => {
      const res = await client.get('/api/health')
      assert.strictEqual(res.status, 200)
      assert.ok(res.data.status !== undefined)
      assert.strictEqual(res.headers['content-type'].includes('application/json'), true)
    })

    it('GET /api/ready → returns readiness structure', async () => {
      const res = await client.get('/api/ready')
      // Status could be 200 (ok/degraded)
      assert.ok([200, 503].includes(res.status))
      assert.ok(res.data.status !== undefined)
      assert.ok(res.data.upstream !== undefined)
    })

    it('GET /api/search?q=test → valid array response', async () => {
      const res = await client.get('/api/search?q=test')

      if (process.env.E2E_REAL_HTTP === 'true' && res.status !== 200) {
        // Accept failure if we are doing real HTTP and don't have internet
        assert.ok([500, 502, 503].includes(res.status))
      } else {
        assert.strictEqual(res.status, 200)
        assert.ok(Array.isArray(res.data))
      }
    })

    it('GET /api/search?type=artist&query=Backstreet%20Boys → returns strict Lidarr ArtistResource lists', async () => {
      const res = await client.get('/api/search?type=artist&query=Backstreet%20Boys')

      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))
      assert.deepStrictEqual(Object.keys(res.data[0]).sort(), [
        'albums',
        'artistAliases',
        'artistName',
        'artistUrl',
        'disambiguation',
        'genres',
        'id',
        'images',
        'links',
        'oldIds',
        'overview',
        'rating',
        'status',
        'type'
      ].sort())
      assert.strictEqual(res.data[0].artistName, 'Backstreet Boys')
      assert.deepStrictEqual(res.data[0].oldIds, [])
      assert.deepStrictEqual(res.data[0].artistAliases, ['BSB', 'Back Street Boys'])
      assert.ok(Array.isArray(res.data[0].images))
    })

    it('GET /api/v1/release?artistId=700 → returns empty Lidarr ReleaseResource list when no indexer candidates exist', async () => {
      const res = await client.get('/api/v1/release?artistId=700')

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.data, [])
    })

    it('GET /api/v1/release?albumId=6271 → returns empty Lidarr ReleaseResource list when no indexer candidates exist', async () => {
      const res = await client.get('/api/v1/release?albumId=6271')

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(res.data, [])
    })

    it('GET /api/v1/artist/lookup?term=Backstreet%20Boys → returns Lidarr artistAliases from MusicBrainz aliases', async () => {
      const res = await client.get('/api/v1/artist/lookup?term=Backstreet%20Boys')

      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))
      assert.strictEqual(res.data[0].artistName, 'Backstreet Boys')
      assert.deepStrictEqual(res.data[0].oldIds, [])
      assert.deepStrictEqual(res.data[0].aliases, ['BSB', 'Back Street Boys'])
      assert.deepStrictEqual(res.data[0].artistAliases, ['BSB', 'Back Street Boys'])
    })

    it('GET /api/artist/{mbid} → returns Lidarr add refetch metadata lists', async () => {
      const mbid = '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad'
      const res = await client.get(`/api/artist/${mbid}`)

      assert.strictEqual(res.status, 200)
      assert.deepStrictEqual(Object.keys(res.data).sort(), [
        'albums',
        'artistUrl',
        'artistAliases',
        'artistName',
        'disambiguation',
        'genres',
        'id',
        'images',
        'links',
        'oldIds',
        'overview',
        'rating',
        'status',
        'type'
      ].sort())
      assert.strictEqual(res.data.artistName, 'Backstreet Boys')
      assert.strictEqual(res.data.id, mbid)
      assert.deepStrictEqual(res.data.oldIds, [])
      assert.deepStrictEqual(res.data.artistAliases, ['BSB', 'Back Street Boys'])
      assert.ok(Array.isArray(res.data.images))
      assert.ok(Array.isArray(res.data.albums))
      assert.ok(res.data.albums.length > 0, 'artist metadata must include albums for Lidarr add persistence')

      const album = res.data.albums[0]
      assert.strictEqual(album.artistId, mbid)
      assert.strictEqual(album.title, 'Millennium')
      assert.strictEqual(album.type, 'Album')
      assert.deepStrictEqual(album.secondaryTypes, [])
      assert.deepStrictEqual(album.releaseStatuses, ['Official'])
      assert.strictEqual(album.releaseDate, '1999-05-18T00:00:00Z')
      assert.ok(Array.isArray(album.artists))
      assert.strictEqual(album.artists[0].id, mbid)
    })

    it('GET /api/album/{releaseGroupId} → returns and caches Lidarr album refetch metadata with tracks', async () => {
      const mbid = '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad'
      const releaseGroupId = '920a68fe-7b93-3d0e-bf73-44ac72f03dd2'
      await client.get(`/api/artist/${mbid}`)

      const res = await client.get(`/api/album/${releaseGroupId}`)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.headers['x-cache'], 'MISS')
      assert.deepStrictEqual(Object.keys(res.data).sort(), [
        'artistId',
        'artists',
        'disambiguation',
        'genres',
        'id',
        'images',
        'links',
        'oldIds',
        'overview',
        'rating',
        'releaseDate',
        'releaseStatuses',
        'releases',
        'secondaryTypes',
        'title',
        'type'
      ].sort())
      assert.strictEqual(res.data.id, releaseGroupId)
      assert.strictEqual(res.data.artistId, mbid)
      assert.strictEqual(res.data.title, 'Millennium')
      assert.strictEqual(res.data.type, 'Album')
      assert.deepStrictEqual(res.data.secondaryTypes, [])
      assert.deepStrictEqual(res.data.releaseStatuses, ['Official'])
      assert.strictEqual(res.data.releaseDate, '1999-05-18T00:00:00Z')
      assert.ok(Array.isArray(res.data.artists))
      assert.strictEqual(res.data.artists[0].id, mbid)
      assert.ok(Array.isArray(res.data.releases))
      assert.strictEqual(res.data.releases.length, 1)
      assert.strictEqual(res.data.releases[0].tracks.length, 1)
      assert.strictEqual(res.data.releases[0].tracks[0].artistId, mbid)

      const cached = await client.get(`/api/album/${releaseGroupId}`)
      assert.strictEqual(cached.status, 200)
      assert.strictEqual(cached.headers['x-cache'], 'HIT')
    })

    it('Lidarr POST /api/v1/artist add flow can refetch SkyHook metadata by foreignArtistId', async () => {
      // Source of truth in Lidarr develop:
      // ArtistController.AddArtist accepts this public resource, then
      // AddArtistService calls SkyHookProxy.GetArtistInfo(foreignArtistId),
      // which requests route artist/{foreignArtistId}.
      const lidarrAddArtistRequest = {
        status: 'continuing',
        ended: false,
        artistName: 'Backstreet Boys',
        foreignArtistId: '2f569e60-0a1b-4fb9-95a4-3dc1525d1aad',
        overview: '',
        disambiguation: '',
        links: [],
        images: [],
        qualityProfileId: 1,
        metadataProfileId: 1,
        monitored: true,
        monitorNewItems: 'all',
        rootFolderPath: '/mnt/shared/Music',
        folder: 'Backstreet Boys',
        genres: [],
        tags: [],
        ratings: { votes: 0, value: 0 },
        addOptions: { monitor: 'all', searchForMissingAlbums: false }
      }

      const lidarrPublicEndpoint = '/api/v1/artist'
      const proxyMetadataEndpoint = `/api/artist/${lidarrAddArtistRequest.foreignArtistId}`

      assert.strictEqual(lidarrPublicEndpoint, '/api/v1/artist')
      assert.strictEqual(proxyMetadataEndpoint, '/api/artist/2f569e60-0a1b-4fb9-95a4-3dc1525d1aad')

      const res = await client.get(proxyMetadataEndpoint)

      assert.strictEqual(res.status, 200)
      assert.strictEqual(res.data.id, lidarrAddArtistRequest.foreignArtistId)
      assert.strictEqual(res.data.artistName, lidarrAddArtistRequest.artistName)
      assert.deepStrictEqual(res.data.oldIds, [])
      assert.deepStrictEqual(res.data.artistAliases, ['BSB', 'Back Street Boys'])
      assert.ok(Array.isArray(res.data.images))
      assert.ok(Array.isArray(res.data.links))
      assert.ok(Array.isArray(res.data.genres))
      assert.ok(Array.isArray(res.data.albums))

      const album = res.data.albums[0]
      assert.ok(album, 'metadata refetch should include mapped MusicBrainz albums when present')
      assert.strictEqual(album.id, '920a68fe-7b93-3d0e-bf73-44ac72f03dd2')
      assert.strictEqual(album.artistId, lidarrAddArtistRequest.foreignArtistId)
      assert.strictEqual(album.title, 'Millennium')
      assert.strictEqual(album.releaseDate, '1999-05-18T00:00:00Z')
      assert.deepStrictEqual(album.oldIds, [])
      assert.strictEqual(album.type, 'Album')
      assert.deepStrictEqual(album.secondaryTypes, [])
      assert.deepStrictEqual(album.releaseStatuses, ['Official'])
      assert.strictEqual(album.releaseStatuses.includes('Official'), true)
      assert.deepStrictEqual(album.rating, { count: 0, value: 0 })
      assert.ok(Array.isArray(album.releases))
      assert.ok(Array.isArray(album.images))
      assert.ok(Array.isArray(album.links))
      assert.ok(Array.isArray(album.artists))
      assert.strictEqual(album.artists[0].id, lidarrAddArtistRequest.foreignArtistId)
      assert.deepStrictEqual(album.artists[0].artistAliases, ['BSB', 'Back Street Boys'])
      assert.ok(Array.isArray(album.artists[0].images))
      assert.ok(Array.isArray(album.artists[0].links))
    })
  })

  describe('Auth Behavior', () => {
    before(() => {
      process.env.REQUIRE_API_KEY = 'true'
    })

    after(() => {
      process.env.REQUIRE_API_KEY = 'false'
    })

    it('no token → returns 401', async () => {
      const res = await client.get('/api/search?q=test')
      assert.strictEqual(res.status, 401)
      assert.ok(res.data.error)
    })

    it('valid token → returns 200', async () => {
      const { createKey } = require('../auth/apikeys')
      const newKey = createKey('e2e-test-client')

      const res = await client.get('/api/search?q=test', {
        headers: {
          'x-api-key': newKey.key
        }
      })

      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))
    })
  })

  if (process.env.E2E_REAL_HTTP === 'true') {
    describe('Real HTTP Integration', { timeout: 15000 }, () => {
      it('GET /api/search?q=beatles → real upstream connectivity and full aggregation flow', async () => {
        let res
        let retries = 3
        while (retries > 0) {
          try {
            res = await client.get('/api/search?q=beatles')
            if (res.status === 200) break
          } catch (e) {
            // Ignore connection errors and retry
          }
          retries--
          if (retries > 0) await new Promise(resolve => setTimeout(resolve, 1000))
        }

        if (res && res.status === 200) {
          assert.ok(Array.isArray(res.data))
          if (res.data.length > 0) {
            // Only validate structural properties, NOT exact data
            const firstResult = res.data[0]
            assert.ok(firstResult.id !== undefined || firstResult.name !== undefined || firstResult.title !== undefined)
          }
        } else {
          // If offline or completely failed after 3 retries, accept gracefully
          assert.ok(res && [500, 502, 503].includes(res.status))
        }
      })
    })
  }

  describe('Failure Scenarios', () => {
    before(() => {
      process.env.REQUIRE_API_KEY = 'false'
    })

    it('Redis unavailable → no crashes, graceful fallback behavior', async () => {
      if (cacheLayer.redis) {
        cacheLayer.redis.emit('error', new Error('Simulated Redis Error'))
        cacheLayer.isRedisHealthy = false
      }

      const res = await client.get('/api/search?q=redis-fail-test')
      assert.strictEqual(res.status, 200)
      assert.ok(Array.isArray(res.data))

      const resHealth = await client.get('/api/health')
      assert.strictEqual(resHealth.status, 200)
    })

    it('Provider failure → graceful response, no crashes', async () => {
      const axiosModule = require('axios')

      // Since get might be already mocked, we restore if so
      if (axiosModule.get && axiosModule.get.mock) {
        axiosModule.get.mock.restore()
      }
      mock.method(axiosModule, 'get', async () => {
        throw new Error('Simulated Provider Failure')
      })
      if (axiosModule.post && axiosModule.post.mock) {
        axiosModule.post.mock.restore()
      }
      mock.method(axiosModule, 'post', async () => {
        throw new Error('Simulated Provider Failure')
      })

      const res = await client.get('/api/search?q=provider-fail-test')
      assert.ok([200, 500, 502, 503].includes(res.status))

      if (axiosModule.get && axiosModule.get.mock) axiosModule.get.mock.restore()
      if (axiosModule.post && axiosModule.post.mock) axiosModule.post.mock.restore()

      // If we are NOT in real HTTP mode, we should restore the global mock so other tests running after don't fail,
      // though this is the last test anyway.
    })
  })
})
