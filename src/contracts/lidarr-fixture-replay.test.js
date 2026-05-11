const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { structuralDiff } = require('../utils/structuralDiff')
const skyhookController = require('../controllers/proxy.controller')
const providers = require('../providers')
const musicbrainzProvider = require('../providers/musicbrainz.provider')

const RAW_FIXTURES_DIR = path.join(__dirname, '../fixtures/skyhook-raw')
const GOLDEN_FIXTURES_DIR = path.join(__dirname, '../fixtures/lidarr')

function mockReqRes(query = {}, params = {}) {
  const req = { query, params, headers: {} }
  const res = {
    headers: {},
    statusCode: 200,
    set(key, val) { this.headers[key] = val },
    status(code) { this.statusCode = code; return this },
    json(data) { this.body = data; return this }
  }
  return { req, res }
}

test('Replay Raw Fixtures vs Proxy Controller (Structural)', async (t) => {
  // If we don't have raw fixtures yet, we can skip or use golden fixtures.
  const fixturesDir = fs.existsSync(RAW_FIXTURES_DIR) ? RAW_FIXTURES_DIR : GOLDEN_FIXTURES_DIR
  
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
      const { req, res } = mockReqRes()
      
      // Match fixture names explicitly so similarly named endpoints with different
      // response shapes are replayed against the correct controller.
      if (file.includes('skyhook-search') || file.startsWith('search-') || file.includes('-search.')) {
        req.query.term = 'Radiohead'
        subT.mock.method(providers, 'aggregateArtist', async () => ({
          id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          artistName: 'Radiohead',
          albums: [],
          providers: [],
          confidence: 100,
          score: 100
        }))
        await skyhookController.handleSearch(req, res)
      } else if (file.includes('lookup')) {
        req.query.term = 'Radiohead'
        // We'd mock upstream to return something that gets processed
        subT.mock.method(providers, 'aggregateArtist', async () => ({
           id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
           artistName: 'Radiohead',
           albums: [],
           providers: [],
           confidence: 100,
           score: 100
        }))
        await skyhookController.handleArtistLookup(req, res)
      } else if (file.includes('artist')) {
        req.params.foreignArtistId = 'a74b1b7f-71a5-4011-9441-d0b5e4122711'
        subT.mock.method(musicbrainzProvider, 'lookupArtistById', async () => ({
          id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
          artistName: 'Radiohead',
          albums: []
        }))
        await skyhookController.handleArtistById(req, res)
      } else if (file.includes('album') && !file.includes('release')) {
        req.params.foreignAlbumId = 'test-album'
        subT.mock.method(musicbrainzProvider, 'lookupAlbumById', async () => ({
           id: 'test-album',
           title: 'Test Album',
           releases: []
        }))
        await skyhookController.handleAlbumById(req, res)
      } else {
        // Skip for unhandled fixture types
        return
      }

      const diff = structuralDiff(expected, res.body)
      
      assert.equal(
        diff.length,
        0,
        `Structural diffs for ${file}:\n${JSON.stringify(diff, null, 2)}`
      )
      
      assert.equal(res.statusCode, 200)
    })
  }
})
