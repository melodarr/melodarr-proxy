const assert = require('node:assert/strict')
const test = require('node:test')

const {
  LIDARR_LOOKUP_ARTIST_DEFAULTS,
  LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS,
  LIDARR_SKYHOOK_ARTIST_DEFAULTS,
  LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS,
  normalizeStringArray,
  withArtistLookupDefaults,
  withSkyhookArtistDefaults
} = require('./lidarrArtist')

test('withArtistLookupDefaults supplies Lidarr-safe lookup fields', () => {
  const artist = withArtistLookupDefaults({ artistName: ' Lorde ', aliases: [' ', 'Ella'] })

  for (const key of LIDARR_LOOKUP_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `lookup artist missing ${key}`)
  }

  assert.equal(artist.artistName, ' Lorde ')
  assert.equal(artist.id, '')
  assert.equal(artist.foreignArtistId, '')
  assert.equal(artist.status, LIDARR_LOOKUP_ARTIST_DEFAULTS.status)
  assert.deepEqual(artist.aliases, ['Ella'])
  assert.deepEqual(artist.links, [])
  assert.deepEqual(artist.images, [])
  assert.deepEqual(artist.albums, [])
})

test('withArtistLookupDefaults falls back foreignArtistId from id for legacy/cached payloads', () => {
  const artist = withArtistLookupDefaults({ artistName: 'Lorde', id: 'mb-legacy-1' })
  assert.equal(artist.id, 'mb-legacy-1')
  assert.equal(artist.foreignArtistId, 'mb-legacy-1')
})

test('withArtistLookupDefaults does not override an explicit foreignArtistId with id', () => {
  const artist = withArtistLookupDefaults({ artistName: 'Lorde', id: 'id-value', foreignArtistId: 'faid-value' })
  assert.equal(artist.id, 'id-value')
  assert.equal(artist.foreignArtistId, 'faid-value')
})

test('withSkyhookArtistDefaults supplies SkyHook artist fields', () => {
  const artist = withSkyhookArtistDefaults({ artistName: 'Radiohead', aliases: ['On a Friday'] })

  for (const key of LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `SkyHook artist missing ${key}`)
  }

  assert.equal(artist.id, '')
  assert.equal(artist.artistName, 'Radiohead')
  assert.equal(artist.disambiguation, '')
  assert.equal(artist.overview, '')
  assert.equal(artist.type, LIDARR_SKYHOOK_ARTIST_DEFAULTS.type)
  assert.equal(artist.status, LIDARR_SKYHOOK_ARTIST_DEFAULTS.status)
  assert.deepEqual(artist.aliases, ['On a Friday'])
  assert.deepEqual(artist.links, [])
  assert.deepEqual(artist.images, [])
  assert.deepEqual(artist.albums, [])
})

test('normalizeStringArray trims values and drops blanks', () => {
  assert.deepEqual(normalizeStringArray([' One ', '', null, 42]), ['One', '42'])
  assert.deepEqual(normalizeStringArray('not-array'), [])
})
