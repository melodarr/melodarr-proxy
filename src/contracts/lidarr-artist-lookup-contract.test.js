const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { withArtistLookupDefaults, LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS } = require('../utils/lidarrArtist')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

// Lidarr-lite-proxy internal fields that are allowed in the response to support Melodash UI and debugging.
// These are not part of the strict Lidarr contract but are preserved for the proxy's dual-purpose design.
const PROXY_EXTENSION_KEYS = [
  'providers',
  'partial',
  'warning',
  'schemaVersion',
  'debug',
  '_generatedAt'
]

test('Lidarr artist lookup resource matches contract exactly', () => {
  const fixture = readFixture('artist-lookup.golden.json')
  const out = fixture.map(a => withArtistLookupDefaults(a))

  const expectedKeys = [...LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS, ...PROXY_EXTENSION_KEYS]

  for (const artist of out) {
    const keys = Object.keys(artist)
    for (const key of keys) {
      assert.ok(expectedKeys.includes(key), `artist lookup resource contains unsupported key: ${key}`)
    }
  }
})

test('withArtistLookupDefaults strictly strips unknown fields from upstream providers', () => {
  const dirty = {
    artistName: 'Radiohead',
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    _upstreamSource: 'musicbrainz', // Should be stripped
    matchType: 'exact', // Should be stripped
    garbage: true // Should be stripped
  }

  const cleaned = withArtistLookupDefaults(dirty)

  assert.equal(cleaned.artistName, 'Radiohead')
  assert.equal(cleaned._upstreamSource, undefined)
  assert.equal(cleaned.matchType, undefined)
  assert.equal(cleaned.garbage, undefined)
})
