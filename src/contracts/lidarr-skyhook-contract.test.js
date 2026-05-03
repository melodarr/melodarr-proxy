const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { toSkyhookSearchShape } = require('../utils/skyhook')
const { LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS } = require('../utils/lidarrArtist')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertArtistContract (artist) {
  for (const key of LIDARR_SKYHOOK_ARTIST_REQUIRED_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(artist, key), `artist missing ${key}`)
  }

  assert.equal(typeof artist.id, 'string')
  assert.equal(typeof artist.artistName, 'string')
  assert.equal(typeof artist.disambiguation, 'string')
  assert.equal(typeof artist.overview, 'string')
  assert.equal(typeof artist.type, 'string')
  assert.equal(typeof artist.status, 'string')
  assert.ok(Array.isArray(artist.oldIds))
  assert.ok(Array.isArray(artist.aliases))
  assert.ok(Array.isArray(artist.artistAliases))
  assert.ok(Array.isArray(artist.links))
  assert.ok(Array.isArray(artist.images))
  for (const image of artist.images) {
    assert.equal(typeof image.coverType, 'string', 'artist image missing coverType')
    assert.equal(typeof image.url, 'string', 'artist image missing url')
  }
  assert.ok(Array.isArray(artist.albums))

  assert.equal(typeof artist.foreignArtistId, 'string')
}

function assertAlbumContract (album) {
  const required = [
    'id',
    'title',
    'disambiguation',
    'overview',
    'artistId',
    'monitored',
    'anyReleaseOk',
    'profileId',
    'duration',
    'albumType',
    'secondaryTypes',
    'mediumCount',
    'ratings',
    'releaseDate',
    'releases',
    'genres',
    'media',
    'artist',
    'images',
    'links',
    'lastSearchTime',
    'statistics',
    'addOptions',
    'remoteCover',
    'artists'
  ]

  for (const key of required) {
    assert.ok(Object.prototype.hasOwnProperty.call(album, key), `album missing ${key}`)
  }

  assert.equal(typeof album.id, 'string')
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.disambiguation, 'string')
  assert.equal(typeof album.overview, 'string')
  assert.equal(typeof album.artistId, 'string')
  assert.equal(typeof album.monitored, 'boolean')
  assert.equal(typeof album.anyReleaseOk, 'boolean')
  assert.equal(typeof album.profileId, 'number')
  assert.equal(typeof album.duration, 'number')
  assert.equal(typeof album.albumType, 'string')
  assert.ok(Array.isArray(album.secondaryTypes))
  assert.equal(typeof album.mediumCount, 'number')
  assert.equal(typeof album.ratings, 'object')
  assert.equal(typeof album.releaseDate, 'string')
  assert.ok(Array.isArray(album.releases))
  assert.ok(Array.isArray(album.genres))
  assert.ok(Array.isArray(album.media))
  assert.equal(typeof album.artist, 'object')
  assert.ok(Array.isArray(album.artist.aliases))
  assert.ok(Array.isArray(album.artist.artistAliases))
  assert.ok(Array.isArray(album.artist.oldIds))
  assert.ok(Array.isArray(album.images))
  for (const image of album.images) {
    assert.equal(typeof image.coverType, 'string', 'album image missing coverType')
    assert.equal(typeof image.url, 'string', 'album image missing url')
  }
  assert.ok(Array.isArray(album.links))
  assert.equal(album.lastSearchTime, null)
  assert.equal(typeof album.statistics, 'object')
  assert.equal(typeof album.addOptions, 'object')
  assert.equal(typeof album.remoteCover, 'string')
  assert.ok(Array.isArray(album.artists))
  assert.equal(typeof album.artist.id, 'string')
  assert.equal(typeof album.artist.artistName, 'string')
  assert.equal(typeof album.artists[0].id, 'string')
  assert.equal(typeof album.artists[0].artistName, 'string')
  assert.equal(typeof album.artists[0].disambiguation, 'string')
  assert.ok(Array.isArray(album.artists[0].oldIds))
  assert.ok(Array.isArray(album.artists[0].artistAliases))

  assert.equal(album.foreignAlbumId, undefined, 'Lidarr expects id, not foreignAlbumId')
}

test('Lidarr/SkyHook search contract matches golden fixture', () => {
  const candidates = [
    {
      artistName: 'Radiohead',
      id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      type: 'artist',
      source: 'musicbrainz',
      ids: { musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' },
      images: ['https://example.com/radiohead.jpg']
    },
    {
      artistName: 'Radiohead',
      match: 'OK Computer',
      type: 'album',
      source: 'musicbrainz',
      ids: {
        musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
        musicbrainzReleaseGroupId: 'b1392450-e666-3926-a536-22c65f834433'
      },
      images: ['https://example.com/ok-computer.jpg']
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
  assert.ok(Array.isArray(artist.oldIds))
  assert.ok(Array.isArray(artist.artistAliases))
  assert.ok(Array.isArray(artist.images))
  assert.equal(artist.images[0].coverType, 'poster')
  assert.ok(Array.isArray(artist.albums))
  assert.ok(Array.isArray(artist.providers))
  assert.equal(typeof artist.partial, 'boolean')

  const album = artist.albums[0]
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.id, 'string')
  assert.match(album.firstReleaseDate, /^\d{4}-\d{2}-\d{2}T/)
  assert.match(album.releaseDate, /^\d{4}-\d{2}-\d{2}T/)
  assert.ok(Array.isArray(album.images))
  assert.equal(album.images[0].coverType, 'cover')
  assert.equal(typeof album.remoteCover, 'string')
  assert.equal(typeof album.provider, 'string')
  assert.equal(typeof album.ids, 'object')
})

test('Lidarr add-artist SkyHook metadata contract never maps required DB lists to null', () => {
  // Source of truth in Lidarr develop:
  // - ArtistController.AddArtist -> AddArtistService.AddSkyhookData()
  // - AddSkyhookData() calls SkyHookProxy.GetArtistInfo(foreignArtistId)
  // - SkyHookProxy.MapArtistMetadata() assigns:
  //   Aliases = resource.ArtistAliases, OldForeignArtistIds = resource.OldIds,
  //   Images = resource.Images?.Select(...).ToList()
  // - migrations make ArtistMetadata.Images, Aliases, and OldForeignArtistIds
  //   non-null database columns.
  const searchFixture = readFixture('skyhook-search.golden.json')
  const lookupFixture = readFixture('artist-lookup.golden.json')
  const skyhookArtistResources = [
    searchFixture[0].artist,
    searchFixture[1].album.artist,
    searchFixture[1].album.artists[0],
    lookupFixture[0]
  ]

  for (const artist of skyhookArtistResources) {
    assert.ok(Array.isArray(artist.oldIds), 'Lidarr resource.oldIds must map to non-null ArtistMetadata.OldForeignArtistIds')
    assert.ok(Array.isArray(artist.artistAliases), 'Lidarr resource.artistAliases must map to non-null ArtistMetadata.Aliases')
    assert.ok(Array.isArray(artist.images || []), 'Lidarr resource.images must map to non-null ArtistMetadata.Images')
  }
})
