const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  SKYHOOK_ALBUM_REQUIRED_KEYS,
  SKYHOOK_RELEASE_REQUIRED_KEYS,
  SKYHOOK_TRACK_REQUIRED_KEYS,
  SKYHOOK_MEDIUM_REQUIRED_KEYS,
  SKYHOOK_IMAGE_REQUIRED_KEYS,
  SKYHOOK_LINK_REQUIRED_KEYS,
  SKYHOOK_RATING_REQUIRED_KEYS,
  SKYHOOK_ARTIST_RESOURCE_KEYS,
  toSkyhookAlbumResource
} = require('../utils/lidarrArtist')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertKeysExact (obj, allowedKeys, label) {
  const keys = Object.keys(obj)
  for (const key of keys) {
    assert.ok(allowedKeys.includes(key), `${label} contains unsupported key: "${key}"`)
  }
  for (const key of allowedKeys) {
    assert.ok(key in obj, `${label} missing required key: "${key}"`)
  }
}

test('Album by ID response matches SkyHook album contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assertKeysExact(album, SKYHOOK_ALBUM_REQUIRED_KEYS, 'album')
})

test('Album response contains correct primitive types', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assert.equal(typeof album.artistId, 'string')
  assert.equal(typeof album.disambiguation, 'string')
  assert.equal(typeof album.overview, 'string')
  assert.equal(typeof album.id, 'string')
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.type, 'string')
  assert.ok(Array.isArray(album.artists), 'artists must be an array')
  assert.ok(Array.isArray(album.oldIds), 'oldIds must be an array')
  assert.ok(Array.isArray(album.images), 'images must be an array')
  assert.ok(Array.isArray(album.links), 'links must be an array')
  assert.ok(Array.isArray(album.genres), 'genres must be an array')
  assert.ok(Array.isArray(album.releases), 'releases must be an array')
  assert.ok(Array.isArray(album.secondaryTypes), 'secondaryTypes must be an array')
  assert.ok(Array.isArray(album.releaseStatuses), 'releaseStatuses must be an array')
  assert.ok(typeof album.rating === 'object' && album.rating !== null, 'rating must be an object')
  assert.ok(album.releaseDate === null || typeof album.releaseDate === 'string', 'releaseDate must be string or null')
})

test('Nested release resources match release contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assert.ok(album.releases.length > 0, 'fixture must contain at least one release')

  for (const release of album.releases) {
    assertKeysExact(release, SKYHOOK_RELEASE_REQUIRED_KEYS, 'release')
  }
})

test('Nested track resources match track contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  const tracks = album.releases.flatMap(r => r.tracks)
  assert.ok(tracks.length > 0, 'fixture must contain at least one track')

  for (const track of tracks) {
    assertKeysExact(track, SKYHOOK_TRACK_REQUIRED_KEYS, 'track')
  }
})

test('Nested medium resources match medium contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  const media = album.releases.flatMap(r => r.media)
  assert.ok(media.length > 0, 'fixture must contain at least one medium')

  for (const medium of media) {
    assertKeysExact(medium, SKYHOOK_MEDIUM_REQUIRED_KEYS, 'medium')
  }
})

test('Nested image resources match image contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assert.ok(album.images.length > 0, 'fixture must contain at least one image')

  for (const image of album.images) {
    assertKeysExact(image, SKYHOOK_IMAGE_REQUIRED_KEYS, 'image')
  }
})

test('Nested link resources match link contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assert.ok(album.links.length > 0, 'fixture must contain at least one link')

  for (const link of album.links) {
    assertKeysExact(link, SKYHOOK_LINK_REQUIRED_KEYS, 'link')
  }
})

test('Album rating matches rating contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assertKeysExact(album.rating, SKYHOOK_RATING_REQUIRED_KEYS, 'rating')
  assert.equal(typeof album.rating.count, 'number')
  assert.equal(typeof album.rating.value, 'number')
})

test('Nested artist resources match SkyHook artist contract exactly', () => {
  const fixture = readFixture('album-by-id.golden.json')
  const album = toSkyhookAlbumResource(fixture)

  assert.ok(album.artists.length > 0, 'fixture must contain at least one artist')

  for (const artist of album.artists) {
    assertKeysExact(artist, SKYHOOK_ARTIST_RESOURCE_KEYS, 'nested artist')
  }
})

test('toSkyhookAlbumResource strips unknown fields from upstream data', () => {
  const dirty = {
    id: 'test-album-id',
    title: 'Test Album',
    type: 'Album',
    _upstreamSource: 'musicbrainz',
    internalScore: 99,
    garbage: true,
    releases: [],
    images: [],
    links: [],
    genres: [],
    oldIds: [],
    secondaryTypes: [],
    releaseStatuses: ['Official']
  }

  const cleaned = toSkyhookAlbumResource(dirty)

  assert.equal(cleaned._upstreamSource, undefined)
  assert.equal(cleaned.internalScore, undefined)
  assert.equal(cleaned.garbage, undefined)
  assert.equal(cleaned.id, 'test-album-id')
  assert.equal(cleaned.title, 'Test Album')
})

test('toSkyhookAlbumResource applies defaults for missing fields', () => {
  const minimal = {
    id: 'minimal-album',
    title: 'Minimal'
  }

  const album = toSkyhookAlbumResource(minimal)

  assert.equal(album.id, 'minimal-album')
  assert.equal(album.title, 'Minimal')
  assert.equal(album.type, 'Album')
  assert.deepEqual(album.releases, [])
  assert.deepEqual(album.images, [])
  assert.deepEqual(album.links, [])
  assert.deepEqual(album.genres, [])
  assert.deepEqual(album.oldIds, [])
  assert.deepEqual(album.secondaryTypes, [])
  assert.deepEqual(album.releaseStatuses, ['Official'])
  assert.deepEqual(album.artists, [])
  assert.equal(album.releaseDate, null)
  assertKeysExact(album, SKYHOOK_ALBUM_REQUIRED_KEYS, 'minimal album')
})
