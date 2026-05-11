const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { structuralDiff } = require('../utils/structuralDiff')
const skyhookController = require('../controllers/proxy.controller')
const cache = require('../cache')
const providers = require('../providers')
const artistDiscovery = require('../providers/artist-discovery')
const rankingEngine = require('../ranking/engine')
const enrichment = require('../enrichment/pipeline')
const musicbrainzProvider = require('../providers/musicbrainz.provider')
const theAudioDbProvider = require('../providers/theaudiodb.provider')
const {
  toSkyhookAlbumResource,
  toSkyhookArtistResource,
  withArtistLookupDefaults,
  normalizeAlbum,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_OPTIONAL_ARTIST_KEYS
} = require('../utils/lidarrArtist')

const RAW_FIXTURES_DIR = path.join(__dirname, '../fixtures/skyhook-raw')
const GOLDEN_FIXTURES_DIR = path.join(__dirname, '../fixtures/lidarr')

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

function stripArtistLookupInternalKeys (response) {
  const allowedKeys = new Set([
    ...LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
    ...LIDARR_OPTIONAL_ARTIST_KEYS
  ])
  const stripped = {}
  for (const [key, value] of Object.entries(response)) {
    if (allowedKeys.has(key)) stripped[key] = value
  }
  return stripped
}

function expectedShapeForFixture (file, expected) {
  if (file.includes('lookup')) {
    return expected.map(item => {
      const normalized = withArtistLookupDefaults({
        ...item,
        genres: item.genres || [],
        albums: (item.albums || []).map(album => normalizeAlbum({
          ...album,
          artistId: album.artistId || item.id,
          artists: album.artists || [{
            id: item.id,
            foreignArtistId: item.foreignArtistId || item.id,
            artistName: item.artistName,
            disambiguation: item.disambiguation || '',
            overview: item.overview || '',
            type: item.type || 'Group',
            status: item.status || 'active',
            oldIds: item.oldIds || [],
            aliases: item.aliases || item.artistAliases || [],
            artistAliases: item.artistAliases || item.aliases || [],
            links: item.links || [],
            images: item.images || [],
            albums: [],
            genres: item.genres || [],
            ratings: item.ratings || { votes: 0, value: 0 },
            rating: item.rating || { count: 0, value: 0 }
          }]
        }))
      })
      return stripArtistLookupInternalKeys(normalized)
    })
  }

  if (file.includes('artist')) {
    return toSkyhookArtistResource(expected)
  }

  if (file.includes('album') && !file.includes('release')) {
    return toSkyhookAlbumResource(expected)
  }

  return expected
}

test('Replay Raw Fixtures vs Proxy Controller (Structural)', async (t) => {
  // Use golden fixtures by default so test expectations are deterministic across environments.
  // Raw fixture replay must be explicitly enabled, e.g. `LIDARR_REPLAY_RAW=1`.
  const useRawFixtures = process.env.LIDARR_REPLAY_RAW === '1'
  const fixturesDir = useRawFixtures ? RAW_FIXTURES_DIR : GOLDEN_FIXTURES_DIR

  if (!fs.existsSync(fixturesDir)) {
    console.warn('No fixtures directory found to run replay tests against.')
    return
  }

  const files = fs.readdirSync(fixturesDir).filter(f => f.endsWith('.json'))
  assert.ok(files.length > 0, `No JSON fixtures found in ${fixturesDir}`)

  for (const file of files) {
    const fixturePath = path.join(fixturesDir, file)
    const expected = JSON.parse(fs.readFileSync(fixturePath, 'utf8'))

    await t.test(`Replay ${file}`, async (subT) => {
      subT.mock.method(cache, 'get', async () => null)
      subT.mock.method(cache, 'set', async () => {})
      subT.mock.method(cache, 'acquireLock', async () => 'fixture-replay-lock')
      subT.mock.method(cache, 'releaseLock', async () => {})
      subT.mock.method(rankingEngine, 'rankResults', (input) => ({
        results: input.results,
        debug: {}
      }))
      subT.mock.method(enrichment, 'enrichResult', async (result) => result)
      subT.mock.method(theAudioDbProvider, 'searchArtistProfile', async () => null)

      const { req, res } = mockReqRes()
      // Match fixture names explicitly so similarly named endpoints with different
      // response shapes are replayed against the correct controller.
      if (file.includes('skyhook-search') || file.startsWith('search-') || file.includes('-search.')) {
        req.query.term = 'Radiohead'
        const artistCandidate = expected.find(item => item.artist)?.artist
        const albumCandidate = expected.find(item => item.album)?.album
        subT.mock.method(artistDiscovery, 'discoverArtists', async () => ([
          artistCandidate && {
            type: 'artist',
            id: artistCandidate.id || 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
            artistName: artistCandidate.artistName || 'Radiohead',
            aliases: artistCandidate.artistAliases || artistCandidate.aliases || [],
            disambiguation: artistCandidate.disambiguation || '',
            images: artistCandidate.images || [],
            score: expected.find(item => item.artist)?.score || 0
          },
          albumCandidate && {
            type: 'album',
            artistName: albumCandidate.artists?.[0]?.artistName || artistCandidate?.artistName || 'Radiohead',
            match: albumCandidate.title || 'Unknown Album',
            disambiguation: albumCandidate.disambiguation || '',
            overview: albumCandidate.overview || '',
            releaseDate: albumCandidate.releaseDate,
            genres: albumCandidate.genres || [],
            secondaryTypes: albumCandidate.secondaryTypes || [],
            releaseStatuses: albumCandidate.releaseStatuses || ['Official'],
            images: albumCandidate.images || [],
            score: expected.find(item => item.album)?.score || 0,
            ids: {
              musicbrainzArtistId: albumCandidate.artistId || artistCandidate?.id || 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
              musicbrainzReleaseGroupId: albumCandidate.id || 'test-album'
            }
          }
        ].filter(Boolean)))
        await skyhookController.handleSearch(req, res)
      } else if (file.includes('lookup')) {
        req.query.term = 'Radiohead'
        subT.mock.method(providers, 'aggregateArtist', async () => expected[0])
        await skyhookController.handleArtistLookup(req, res)
      } else if (file.includes('artist')) {
        req.params.foreignArtistId = expected.id || 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
        subT.mock.method(musicbrainzProvider, 'lookupArtistById', async () => expected)
        await skyhookController.handleArtistById(req, res)
      } else if (file.includes('album') && !file.includes('release')) {
        req.params.foreignAlbumId = expected.id || 'test-album'
        subT.mock.method(musicbrainzProvider, 'lookupAlbumById', async () => expected)
        await skyhookController.handleAlbumById(req, res)
      } else {
        subT.skip(`Unhandled fixture type for ${file}`)
        return
      }

      const responseBody = JSON.parse(JSON.stringify(res.body))
      const diff = structuralDiff(expectedShapeForFixture(file, expected), responseBody)
      assert.equal(
        diff.length,
        0,
        `Structural diffs for ${file}:\n${JSON.stringify(diff, null, 2)}`
      )

      assert.equal(res.statusCode, 200)
    })
  }
})
