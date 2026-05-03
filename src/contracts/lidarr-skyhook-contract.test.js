const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { toSkyhookSearchShape } = require('../utils/skyhook')

const fixturesDir = path.join(__dirname, '../fixtures/lidarr')

const SKYHOOK_ENTITY_KEYS = ['album', 'artist', 'score']
const SKYHOOK_ARTIST_KEYS = [
  'albums',
  'aristUrl',
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
]
const SKYHOOK_ALBUM_KEYS = [
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
]
const SKYHOOK_IMAGE_KEYS = ['coverType', 'height', 'url', 'width']
const SKYHOOK_LINK_KEYS = ['target', 'type']
const SKYHOOK_RATING_KEYS = ['count', 'value']

function readFixture (name) {
  return JSON.parse(fs.readFileSync(path.join(fixturesDir, name), 'utf8'))
}

function assertExactKeys (value, keys, label) {
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} keys drifted from Lidarr source`)
}

function assertArtistContract (artist) {
  assertExactKeys(artist, SKYHOOK_ARTIST_KEYS, 'SkyHook ArtistResource')

  assert.equal(typeof artist.id, 'string')
  assert.equal(typeof artist.artistName, 'string')
  assert.equal(typeof artist.disambiguation, 'string')
  assert.equal(typeof artist.overview, 'string')
  assert.equal(typeof artist.type, 'string')
  assert.equal(typeof artist.status, 'string')
  assert.ok(Array.isArray(artist.oldIds))
  assert.ok(Array.isArray(artist.artistAliases))
  assert.ok(Array.isArray(artist.links))
  for (const link of artist.links) {
    assertExactKeys(link, SKYHOOK_LINK_KEYS, 'SkyHook LinkResource')
    assert.equal(typeof link.target, 'string')
    assert.equal(typeof link.type, 'string')
  }
  assert.ok(Array.isArray(artist.images))
  for (const image of artist.images) {
    assertExactKeys(image, SKYHOOK_IMAGE_KEYS, 'SkyHook ImageResource')
    assert.equal(typeof image.coverType, 'string', 'artist image missing coverType')
    assert.equal(typeof image.url, 'string', 'artist image missing url')
    assert.equal(typeof image.height, 'number', 'artist image missing height')
    assert.equal(typeof image.width, 'number', 'artist image missing width')
  }
  assert.ok(Array.isArray(artist.albums))
  assertExactKeys(artist.rating, SKYHOOK_RATING_KEYS, 'SkyHook RatingResource')
  assert.equal(typeof artist.rating.count, 'number')
  assert.equal(typeof artist.rating.value, 'number')
  assert.equal(Object.prototype.hasOwnProperty.call(artist, 'foreignArtistId'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(artist, 'aliases'), false)
}

function assertAlbumContract (album) {
  assertExactKeys(album, SKYHOOK_ALBUM_KEYS, 'SkyHook AlbumResource')

  assert.equal(typeof album.id, 'string')
  assert.ok(Array.isArray(album.oldIds))
  assert.equal(typeof album.title, 'string')
  assert.equal(typeof album.disambiguation, 'string')
  assert.equal(typeof album.overview, 'string')
  assert.equal(typeof album.artistId, 'string')
  assert.equal(typeof album.type, 'string')
  assert.ok(Array.isArray(album.secondaryTypes))
  assert.ok(Array.isArray(album.releaseStatuses))
  assert.equal(typeof album.rating, 'object')
  assertExactKeys(album.rating, SKYHOOK_RATING_KEYS, 'SkyHook RatingResource')
  assert.ok(typeof album.releaseDate === 'string' || album.releaseDate === null)
  assert.ok(Array.isArray(album.releases))
  assert.ok(Array.isArray(album.genres))
  assert.ok(Array.isArray(album.images))
  for (const image of album.images) {
    assertExactKeys(image, SKYHOOK_IMAGE_KEYS, 'SkyHook ImageResource')
    assert.equal(typeof image.coverType, 'string', 'album image missing coverType')
    assert.equal(typeof image.url, 'string', 'album image missing url')
    assert.equal(typeof image.height, 'number', 'album image missing height')
    assert.equal(typeof image.width, 'number', 'album image missing width')
  }
  assert.ok(Array.isArray(album.links))
  assert.ok(Array.isArray(album.artists))
  assert.equal(typeof album.artists[0].id, 'string')
  assert.equal(typeof album.artists[0].artistName, 'string')
  assert.equal(typeof album.artists[0].disambiguation, 'string')
  assert.ok(Array.isArray(album.artists[0].oldIds))
  assert.ok(Array.isArray(album.artists[0].artistAliases))
  assert.ok(Array.isArray(album.artists[0].images))
  assert.ok(Array.isArray(album.artists[0].links))

  assert.equal(album.foreignAlbumId, undefined, 'Lidarr expects id, not foreignAlbumId')
  assert.equal(album.firstReleaseDate, undefined, 'SkyHook AlbumResource expects releaseDate, not firstReleaseDate')
}

test('Lidarr/SkyHook type=all search contract matches golden EntityResource fixture', () => {
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

test('Lidarr/SkyHook type=all search contract rejects flat response items', () => {
  const flat = [{ artistName: 'Radiohead', id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }]

  for (const item of flat) {
    assert.equal(Boolean(item.artist || item.album), false, 'flat item must not satisfy SkyHook union contract')
  }
})

test('Lidarr/SkyHook type=all search golden fixture satisfies EntityResource contracts', () => {
  const fixture = readFixture('skyhook-search.golden.json')

  for (const item of fixture) {
    assertExactKeys(item, SKYHOOK_ENTITY_KEYS, 'SkyHook EntityResource')
    assert.equal(typeof item.score, 'number')
    const branches = [item.artist, item.album].filter(Boolean)
    assert.equal(branches.length, 1, 'each item must have exactly one union branch')
    if (item.artist) assertArtistContract(item.artist)
    if (item.album) assertAlbumContract(item.album)
  }
})

test('Lidarr/SkyHook type=artist search returns ArtistResource[] from source contract', () => {
  // Source of truth:
  // SkyHookProxy.SearchForNewArtist() calls route=search&type=artist and
  // deserializes it as List<NzbDrone.Core.MetadataSource.SkyHook.Resource.ArtistResource>.
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    id: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
    type: 'artist',
    ids: { musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711' }
  }], 'artist')

  assert.equal(out.length, 1)
  assertArtistContract(out[0])
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'album'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'score'), false)
})

test('Lidarr/SkyHook type=album search returns AlbumResource[] from source contract', () => {
  // Source of truth:
  // SkyHookProxy.SearchForNewAlbum() calls route=search&type=album and
  // deserializes it as List<NzbDrone.Core.MetadataSource.SkyHook.Resource.AlbumResource>.
  const out = toSkyhookSearchShape([{
    artistName: 'Radiohead',
    match: 'OK Computer',
    type: 'album',
    ids: {
      musicbrainzArtistId: 'a74b1b7f-71a5-4011-9441-d0b5e4122711',
      musicbrainzReleaseGroupId: 'b1392450-e666-3926-a536-22c65f834433'
    }
  }], 'album')

  assert.equal(out.length, 1)
  assertAlbumContract(out[0])
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'artist'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'album'), false)
  assert.equal(Object.prototype.hasOwnProperty.call(out[0], 'score'), false)
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
    searchFixture[1].album.artists[0],
    lookupFixture[0]
  ]

  for (const artist of skyhookArtistResources) {
    assert.ok(Array.isArray(artist.oldIds), 'Lidarr resource.oldIds must map to non-null ArtistMetadata.OldForeignArtistIds')
    assert.ok(Array.isArray(artist.artistAliases), 'Lidarr resource.artistAliases must map to non-null ArtistMetadata.Aliases')
    assert.ok(Array.isArray(artist.images || []), 'Lidarr resource.images must map to non-null ArtistMetadata.Images')
  }
})

test('Lidarr album SkyHook contract includes fields read by FilterAlbums and MapAlbum', () => {
  const fixture = readFixture('skyhook-search.golden.json')
  const album = fixture[1].album

  assert.ok(Array.isArray(album.oldIds), 'AlbumResource.OldIds must be an array')
  assert.equal(typeof album.type, 'string', 'AlbumResource.Type must be populated for metadata profile filtering')
  assert.ok(Array.isArray(album.secondaryTypes), 'AlbumResource.SecondaryTypes is dereferenced with .Any()')
  assert.ok(Array.isArray(album.releaseStatuses), 'AlbumResource.ReleaseStatuses is dereferenced with .Any()')
  assert.ok(album.releaseDate === null || typeof album.releaseDate === 'string', 'AlbumResource.ReleaseDate must be null or date-like')
  assert.ok(Array.isArray(album.releases), 'AlbumResource.Releases must be an array for MapAlbum')

  for (const artist of album.artists) {
    assert.ok(Array.isArray(artist.oldIds), 'AlbumResource.Artists[].OldIds must be an array')
    assert.ok(Array.isArray(artist.artistAliases), 'AlbumResource.Artists[].ArtistAliases must be an array')
    assert.ok(Array.isArray(artist.images), 'AlbumResource.Artists[].Images must be an array')
    assert.ok(Array.isArray(artist.links), 'AlbumResource.Artists[].Links must be an array')
  }
})
