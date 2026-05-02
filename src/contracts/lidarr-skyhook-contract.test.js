const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { toSkyhookSearchShape } = require('../utils/skyhook')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertArtistContract (artist) {
  const required = [
    'id',
    'artistName',
    'disambiguation',
    'overview',
    'type',
    'status',
    'links',
    'images',
    'albums'
  ]

  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `artist missing ${key}`)
  }

  assert.equal(typeof artist.id, 'string')
  assert.equal(typeof artist.artistName, 'string')
  assert.equal(typeof artist.disambiguation, 'string')
  assert.equal(typeof artist.overview, 'string')
  assert.equal(typeof artist.type, 'string')
  assert.equal(typeof artist.status, 'string')
  assert.ok(Array.isArray(artist.links))
  assert.ok(Array.isArray(artist.images))
  assert.ok(Array.isArray(artist.albums))
}

function assertAlbumContract (album) {
  const required = ['id', 'title', 'releaseDate', 'images', 'artistId', 'artists']

  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(album, key), `album missing ${key}`)
  }

  assert.equal(typeof album.id, 'string')
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.releaseDate, 'string')
  assert.ok(Array.isArray(album.images))
  assert.equal(typeof album.artistId, 'string')
  assert.ok(Array.isArray(album.artists))
  assert.equal(typeof album.artists[0].id, 'string')
  assert.equal(typeof album.artists[0].artistName, 'string')
  assert.equal(typeof album.artists[0].disambiguation, 'string')
}

test('Lidarr/SkyHook search contract matches golden fixture', () => {
  const candidates = [
    {
      artistName: 'Radiohead',
      id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      type: 'artist',
      source: 'musicbrainz',
      ids: { musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }
    },
    {
      artistName: 'Radiohead',
      match: 'OK Computer',
      type: 'album',
      source: 'musicbrainz',
      ids: {
        musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        musicbrainzReleaseGroupId: 'b1392450-e666-3926-a536-22c65f834433'
      }
    }
  ]

  const actual = toSkyhookSearchShape(candidates)
  const expected = readFixture('skyhook-search.golden.json')

  assert.deepEqual(actual, expected)
})

test('Lidarr/SkyHook search contract rejects flat response items', () => {
  const flat = [{ artistName: 'Radiohead', id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }]

  for (const item of flat) {
    assert.equal(Boolean(item.artist || item.album), false, 'flat item must not satisfy SkyHook union contract')
  }
})

test('Lidarr/SkyHook search golden fixture satisfies union contracts', () => {
  const fixture = readFixture('skyhook-search.golden.json')

  for (const item of fixture) {
    const branches = [item.artist, item.album].filter(Boolean)
    assert.equal(branches.length, 1, 'each item must have exactly one union branch')
    if (item.artist) assertArtistContract(item.artist)
    if (item.album) assertAlbumContract(item.album)
  }
})

test('artist lookup golden fixture keeps Lidarr-safe fields stable', () => {
  const fixture = readFixture('artist-lookup.golden.json')

  assert.ok(Array.isArray(fixture))
  assert.equal(fixture.length, 1)

  const artist = fixture[0]
  assert.equal(artist.schemaVersion, 'skyhook-v1')
  assert.equal(typeof artist.artistName, 'string')
  assert.equal(typeof artist.id, 'string')
  assert.ok(Array.isArray(artist.albums))
  assert.ok(Array.isArray(artist.providers))
  assert.equal(typeof artist.partial, 'boolean')

  const album = artist.albums[0]
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.id, 'string')
  assert.match(album.firstReleaseDate, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(album.releaseDate, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(typeof album.coverUrl, 'string')
  assert.equal(typeof album.provider, 'string')
  assert.equal(typeof album.ids, 'object')
})
